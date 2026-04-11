/**
 * OUROBOROS Cycle 2 — Task 3: Hive Mind Query Threshold Analysis
 *
 * Empirically measures cosine similarity distributions between
 * hash-based pseudo-embeddings to determine optimal threshold.
 */

const EMBEDDING_DIMENSIONS = 768;

function hashEmbedding(text) {
  const embedding = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().split(/\s+/);
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    for (let d = 0; d < 8; d++) {
      const idx = Math.abs((hash + d * 997) % EMBEDDING_DIMENSIONS);
      embedding[idx] += (hash > 0 ? 1 : -1) * (1 / Math.pow(w + 1, 2.0));
    }
  }
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) embedding.forEach((_, i) => embedding[i] /= norm);
  return embedding;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Simulate real Hive Mind entries from our OUROBOROS experiments
const memories = [
  { ctx: "OUROBOROS Cycle 2 Task 1: Fix fire-and-forget race condition in mcpClientManager.ts hotPlugServer onToolsChanged", tags: ["ouroboros", "mcpClientManager", "race-condition"] },
  { ctx: "OUROBOROS Protocol Phase 1: _connectionMutex starvation experiment measuring lock contention under concurrent load", tags: ["ouroboros", "mutex", "experiment"] },
  { ctx: "Autonomic Pulse hot-patch timeout guard preventing indefinite Gemini API blocking in tool dispatch pipeline", tags: ["autonomic-pulse", "timeout", "gemini"] },
  { ctx: "Hive Mind vector memory persistence and semantic search with DAG resolution for topological ancestor queries", tags: ["hive-mind", "embedding", "memory"] },
  { ctx: "CodeRunner ENOENT bug when tempDir is empty causing scandir to throw filesystem error", tags: ["coderunner", "bug", "enoent"] },
  { ctx: "SwarmTracer telemetry persistence flushing only every 50 spans risking data loss on crash", tags: ["telemetry", "tracer", "persistence"] },
];

const queries = [
  "mutex race condition fix",
  "how does the tool registry hot-patch work",
  "memory search threshold",
  "ouroboros protocol findings",
  "ENOENT filesystem error",
  "unrelated cooking recipe for pasta", // should match nothing
];

console.log('=== OUROBOROS Cycle 2 — Task 3: Hive Mind Threshold Analysis ===\n');

// Generate embeddings
const memoryEmbeddings = memories.map(m => ({
  ...m,
  embedding: hashEmbedding(m.ctx),
}));

// Test each query at different thresholds
const thresholds = [0.001, 0.005, 0.01, 0.02, 0.03, 0.05, 0.10];

console.log('| Query | 0.001 | 0.005 | 0.01 | 0.02 | 0.03 | 0.05 | 0.10 | Best Match (sim) |');
console.log('|-------|-------|-------|------|------|------|------|------|------------------|');

let totalResults = {};
thresholds.forEach(t => totalResults[t] = 0);

for (const query of queries) {
  const qEmb = hashEmbedding(query);
  const sims = memoryEmbeddings.map(m => ({
    sim: cosineSim(qEmb, m.embedding),
    ctx: m.ctx.substring(0, 30),
  }));

  const bestMatch = sims.reduce((a, b) => a.sim > b.sim ? a : b);
  const counts = {};
  thresholds.forEach(t => {
    const c = sims.filter(s => s.sim >= t).length;
    counts[t] = c;
    totalResults[t] += c;
  });

  const row = thresholds.map(t => String(counts[t]).padStart(5));
  console.log(`| ${query.padEnd(42).substring(0, 42)} | ${row.join(' | ')} | ${bestMatch.ctx}... (${bestMatch.sim.toFixed(4)}) |`);
}

console.log();
console.log('--- Total results at each threshold ---');
thresholds.forEach(t => {
  console.log(`  ${t.toString().padEnd(6)}: ${totalResults[t]} results across ${queries.length} queries`);
});

// Compute pairwise similarities between all memories
console.log('\n--- Pairwise memory similarity matrix ---');
const pairSims = [];
for (let i = 0; i < memoryEmbeddings.length; i++) {
  for (let j = i + 1; j < memoryEmbeddings.length; j++) {
    const sim = cosineSim(memoryEmbeddings[i].embedding, memoryEmbeddings[j].embedding);
    pairSims.push(sim);
  }
}
pairSims.sort((a, b) => a - b);
console.log(`Min: ${pairSims[0]?.toFixed(6)}`);
console.log(`Max: ${pairSims[pairSims.length - 1]?.toFixed(6)}`);
console.log(`Mean: ${(pairSims.reduce((s, v) => s + v, 0) / pairSims.length).toFixed(6)}`);
console.log(`Median: ${pairSims[Math.floor(pairSims.length / 2)]?.toFixed(6)}`);

// Recommendation
const optimalThreshold = 0.005;
const unrelatedResults = memoryEmbeddings.filter(m =>
  cosineSim(hashEmbedding("unrelated cooking recipe for pasta"), m.embedding) >= optimalThreshold
).length;

console.log(`\n=== RECOMMENDATION ===`);
console.log(`Optimal fallback threshold: ${optimalThreshold}`);
console.log(`Unrelated query ("cooking recipe") returns ${unrelatedResults} false positives at threshold=${optimalThreshold}`);
console.log(`This should be ${unrelatedResults === 0 ? '✅ ZERO false positives' : '⚠️ HAS false positives — needs higher threshold'}`);
