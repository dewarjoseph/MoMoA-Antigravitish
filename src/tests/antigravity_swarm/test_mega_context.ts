/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST A: Mega-Context Stress Test
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates:
 * 1. Dynamically generate a 50,000+ line payload (~5 MB)
 * 2. Bury a unique "Needle" hash deep inside (line ~37,777)
 * 3. Ingest into an MCP resource pipeline (mock)
 * 4. Prove no OOM / V8 E2BIG / truncation
 * 5. Successfully retrieve the Needle
 * 6. Report execution time and memory metrics
 *
 * Run: npx tsx src/tests/antigravity_swarm/test_mega_context.ts
 */

import * as crypto from 'node:crypto';
import { SwarmTracer } from '../../telemetry/tracer.js';

// ── Utilities ───────────────────────────────────────────────────────────────

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    SwarmTracer.getInstance().emitLog(`    ${PASS} — ${testName}`);
  } else {
    SwarmTracer.getInstance().emitLog(`    ${FAIL} — ${testName}${details ? ` (${details})` : ''}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getMemoryMB(): { heapUsed: number; rss: number; external: number } {
  const mem = process.memoryUsage();
  return {
    heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
    rss: Math.round(mem.rss / (1024 * 1024)),
    external: Math.round(mem.external / (1024 * 1024)),
  };
}

// ── Mock MCP Resource Pipeline ──────────────────────────────────────────────

/**
 * Simulates the MCP resource read pipeline:
 * 1. Server exposes a massive resource
 * 2. Client reads it via resources/read
 * 3. Agent processes the content
 */
class MockMegaResourcePipeline {
  private storage: Map<string, string> = new Map();

  /** Register a resource at the given URI */
  registerResource(uri: string, content: string): void {
    this.storage.set(uri, content);
  }

  /** Simulate resources/list */
  listResources(): Array<{ uri: string; name: string; sizeBytes: number }> {
    return Array.from(this.storage.entries()).map(([uri, content]) => ({
      uri,
      name: uri.split('/').pop() || uri,
      sizeBytes: Buffer.byteLength(content),
    }));
  }

  /** Simulate resources/read — returns the full content */
  readResource(uri: string): string {
    const content = this.storage.get(uri);
    if (!content) throw new Error(`Resource not found: ${uri}`);
    return content;
  }

  /** Chunked read — simulates streaming for large payloads */
  *readResourceChunked(uri: string, chunkSize: number = 64 * 1024): Generator<string> {
    const content = this.storage.get(uri);
    if (!content) throw new Error(`Resource not found: ${uri}`);

    for (let i = 0; i < content.length; i += chunkSize) {
      yield content.substring(i, i + chunkSize);
    }
  }
}

// ── Needle-in-Haystack Generation ───────────────────────────────────────────

interface HaystackPayload {
  content: string;
  needle: string;
  needleLine: number;
  totalLines: number;
  totalBytes: number;
}

function generateMegaPayload(options: {
  totalLines: number;
  needleLine: number;
}): HaystackPayload {
  const { totalLines, needleLine } = options;
  const needle = `NEEDLE_${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
  const lines: string[] = [];

  for (let i = 1; i <= totalLines; i++) {
    if (i === needleLine) {
      // The needle line — buried deep in the haystack
      lines.push(`{"line":${i},"level":"CRITICAL","msg":"FOUND_IT","needle":"${needle}","ts":"${new Date().toISOString()}"}`);
    } else if (i % 1000 === 0) {
      // Periodic structure variation
      lines.push(`{"line":${i},"level":"INFO","msg":"Checkpoint at line ${i}","progress":"${((i / totalLines) * 100).toFixed(1)}%"}`);
    } else if (i % 500 === 0) {
      // JSON data rows with nested objects
      lines.push(`{"line":${i},"level":"DEBUG","data":{"userId":${i * 7},"action":"process","meta":{"tags":["swarm","${i % 3 === 0 ? 'alpha' : 'beta'}"],"retries":${i % 5}}}}`);
    } else {
      // Normal log lines
      const level = ['INFO', 'DEBUG', 'WARN', 'TRACE'][i % 4];
      lines.push(`{"line":${i},"level":"${level}","msg":"Log entry for request ${i}","latency_ms":${(Math.random() * 500).toFixed(1)}}`);
    }
  }

  const content = lines.join('\n');
  return {
    content,
    needle,
    needleLine,
    totalLines,
    totalBytes: Buffer.byteLength(content),
  };
}

// ── Needle Search Strategies ────────────────────────────────────────────────

/** Strategy 1: Linear scan (simulates agent reading the full context) */
function searchLinear(content: string, needle: string): { found: boolean; lineNum: number; timeMs: number } {
  const start = performance.now();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) {
      return { found: true, lineNum: i + 1, timeMs: performance.now() - start };
    }
  }
  return { found: false, lineNum: -1, timeMs: performance.now() - start };
}

/** Strategy 2: Regex search (simulates structured extraction) */
function searchRegex(content: string, needle: string): { found: boolean; match: string | null; timeMs: number } {
  const start = performance.now();
  const regex = new RegExp(`"needle":"(${needle})"`, 'g');
  const match = regex.exec(content);
  return {
    found: match !== null,
    match: match ? match[1] : null,
    timeMs: performance.now() - start,
  };
}

/** Strategy 3: Chunked streaming search (simulates MCP resource streaming) */
function searchChunked(
  pipeline: MockMegaResourcePipeline,
  uri: string,
  needle: string,
  chunkSize: number
): { found: boolean; chunkIndex: number; totalChunks: number; timeMs: number } {
  const start = performance.now();
  let chunkIndex = 0;
  let totalChunks = 0;
  let found = false;

  for (const chunk of pipeline.readResourceChunked(uri, chunkSize)) {
    totalChunks++;
    if (!found && chunk.includes(needle)) {
      found = true;
      chunkIndex = totalChunks;
    }
  }

  return { found, chunkIndex, totalChunks, timeMs: performance.now() - start };
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog('║  TEST A: Mega-Context Stress Test                       ║');
  SwarmTracer.getInstance().emitLog('║  "50,000+ Lines / 5MB+ Needle-in-Haystack"              ║');
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  const memBefore = getMemoryMB();
  SwarmTracer.getInstance().emitLog(`  📊 Memory BEFORE: Heap=${memBefore.heapUsed}MB, RSS=${memBefore.rss}MB\n`);

  // ── Phase 1: Payload Generation ─────────────────────────────────────────
  SwarmTracer.getInstance().emitLog('── Phase 1: Mega-Payload Generation ──');
  const genStart = performance.now();

  const payload = generateMegaPayload({
    totalLines: 55_000,
    needleLine: 37_777,
  });

  const genTime = performance.now() - genStart;
  const memAfterGen = getMemoryMB();

  SwarmTracer.getInstance().emitLog(`    Lines:     ${payload.totalLines.toLocaleString()}`);
  SwarmTracer.getInstance().emitLog(`    Bytes:     ${formatBytes(payload.totalBytes)}`);
  SwarmTracer.getInstance().emitLog(`    Needle:    ${payload.needle}`);
  SwarmTracer.getInstance().emitLog(`    Needle at: line ${payload.needleLine.toLocaleString()}`);
  SwarmTracer.getInstance().emitLog(`    Gen time:  ${formatMs(genTime)}`);
  SwarmTracer.getInstance().emitLog(`    Memory:    Heap=${memAfterGen.heapUsed}MB, RSS=${memAfterGen.rss}MB`);
  SwarmTracer.getInstance().emitLog(`    Δ Heap:    +${memAfterGen.heapUsed - memBefore.heapUsed}MB\n`);

  assert(payload.totalLines >= 50_000, `Payload has 50k+ lines (got: ${payload.totalLines.toLocaleString()})`);
  assert(payload.totalBytes >= 4 * 1024 * 1024, `Payload is 4MB+ (got: ${formatBytes(payload.totalBytes)})`);
  assert(payload.needle.startsWith('NEEDLE_'), 'Needle hash generated');

  // ── Phase 2: MCP Resource Registration ──────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 2: MCP Resource Pipeline Ingestion ──');

  const pipeline = new MockMegaResourcePipeline();
  const ingestStart = performance.now();
  pipeline.registerResource('file://mega/logs', payload.content);
  const ingestTime = performance.now() - ingestStart;

  const resources = pipeline.listResources();
  SwarmTracer.getInstance().emitLog(`    Ingestion time: ${formatMs(ingestTime)}`);
  SwarmTracer.getInstance().emitLog(`    Resources: ${resources.length}`);
  SwarmTracer.getInstance().emitLog(`    Resource size: ${formatBytes(resources[0].sizeBytes)}`);

  assert(resources.length === 1, 'Resource registered in pipeline');
  assert(resources[0].sizeBytes >= 4 * 1024 * 1024, 'Resource retains full size');

  // ── Phase 3: Full-Context Read (No Truncation) ──────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 3: Full-Context Read — Truncation Check ──');

  const readStart = performance.now();
  const fullContent = pipeline.readResource('file://mega/logs');
  const readTime = performance.now() - readStart;
  const memAfterRead = getMemoryMB();

  SwarmTracer.getInstance().emitLog(`    Read time:  ${formatMs(readTime)}`);
  SwarmTracer.getInstance().emitLog(`    Content size: ${formatBytes(Buffer.byteLength(fullContent))}`);
  SwarmTracer.getInstance().emitLog(`    Memory: Heap=${memAfterRead.heapUsed}MB, RSS=${memAfterRead.rss}MB`);

  assert(fullContent.length === payload.content.length, `No truncation (original: ${payload.content.length}, read: ${fullContent.length})`);
  assert(fullContent.includes(payload.needle), 'Needle survives pipeline read');

  // ── Phase 4: Linear Needle Search ───────────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 4: Linear Needle Search ──');

  const linearResult = searchLinear(fullContent, payload.needle);
  SwarmTracer.getInstance().emitLog(`    Found:     ${linearResult.found}`);
  SwarmTracer.getInstance().emitLog(`    Line:      ${linearResult.lineNum.toLocaleString()}`);
  SwarmTracer.getInstance().emitLog(`    Scan time: ${formatMs(linearResult.timeMs)}`);

  assert(linearResult.found, 'Needle found via linear scan');
  assert(linearResult.lineNum === payload.needleLine, `Found at correct line (expected: ${payload.needleLine}, got: ${linearResult.lineNum})`);

  // ── Phase 5: Regex Extraction ───────────────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 5: Regex Extraction ──');

  const regexResult = searchRegex(fullContent, payload.needle);
  SwarmTracer.getInstance().emitLog(`    Found:      ${regexResult.found}`);
  SwarmTracer.getInstance().emitLog(`    Match:      ${regexResult.match}`);
  SwarmTracer.getInstance().emitLog(`    Regex time: ${formatMs(regexResult.timeMs)}`);

  assert(regexResult.found, 'Needle found via regex extraction');
  assert(regexResult.match === payload.needle, 'Regex match is exact');

  // ── Phase 6: Chunked Streaming Search ──────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 6: Chunked Streaming Search ──');

  const chunkSizes = [32 * 1024, 64 * 1024, 256 * 1024];
  for (const cs of chunkSizes) {
    const chunked = searchChunked(pipeline, 'file://mega/logs', payload.needle, cs);
    SwarmTracer.getInstance().emitLog(`    Chunk size: ${formatBytes(cs)} → ${chunked.totalChunks} chunks, found at chunk #${chunked.chunkIndex}, time: ${formatMs(chunked.timeMs)}`);
    assert(chunked.found, `Needle found with ${formatBytes(cs)} chunks`);
  }

  // ── Phase 7: Memory Stability ──────────────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 7: Memory Stability Check ──');

  // Force GC if available
  if (global.gc) {
    global.gc();
    await new Promise(r => setTimeout(r, 100));
  }

  const memFinal = getMemoryMB();
  const heapDelta = memFinal.heapUsed - memBefore.heapUsed;

  SwarmTracer.getInstance().emitLog(`    Final memory: Heap=${memFinal.heapUsed}MB, RSS=${memFinal.rss}MB`);
  SwarmTracer.getInstance().emitLog(`    Total Δ Heap: +${heapDelta}MB`);

  // Heap growth should be bounded — payload is ~5MB, doubling for pipeline = ~10MB
  // Allow up to 200MB to account for V8 overhead
  assert(heapDelta < 200, `Heap growth bounded (<200MB, got: +${heapDelta}MB)`);
  assert(memFinal.rss < 512, `RSS stays under 512MB (got: ${memFinal.rss}MB)`);

  // ── Phase 8: Multi-Payload Stress ──────────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 8: Multi-Payload Stress (3 × 20k lines) ──');

  const stressStart = performance.now();
  const payloads: HaystackPayload[] = [];
  for (let i = 0; i < 3; i++) {
    const p = generateMegaPayload({ totalLines: 20_000, needleLine: 10_000 + i * 3_000 });
    pipeline.registerResource(`file://stress/${i}`, p.content);
    payloads.push(p);
  }

  const stressResources = pipeline.listResources();
  SwarmTracer.getInstance().emitLog(`    Total resources: ${stressResources.length}`);
  SwarmTracer.getInstance().emitLog(`    Total bytes: ${formatBytes(stressResources.reduce((a, r) => a + r.sizeBytes, 0))}`);
  SwarmTracer.getInstance().emitLog(`    Time: ${formatMs(performance.now() - stressStart)}`);

  // Verify each needle
  for (let i = 0; i < payloads.length; i++) {
    const content = pipeline.readResource(`file://stress/${i}`);
    assert(content.includes(payloads[i].needle), `Stress payload ${i} needle found`);
  }

  const memStress = getMemoryMB();
  SwarmTracer.getInstance().emitLog(`    Final memory: Heap=${memStress.heapUsed}MB, RSS=${memStress.rss}MB`);
  assert(memStress.rss < 768, `RSS stays under 768MB after stress (got: ${memStress.rss}MB)`);

  // ── Summary ───────────────────────────────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog(`║  RESULTS: ${passedTests}/${totalTests} tests passed${' '.repeat(Math.max(0, 35 - `${passedTests}/${totalTests}`.length))}║`);
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) { process.exit(1); } else { process.exit(0); }
}

runTests().catch(err => {
  SwarmTracer.getInstance().emitLog('Fatal test error:', err);
  process.exit(1);
});
