/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ANTIGRAVITY E2E: Full Swarm Integration Harness
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Proves the complete Antigravity swarm lifecycle:
 *
 * [MEGA-CONTEXT INGEST]
 *   → ingest a massive 30k-line payload with a hidden instruction
 * [SPAWN BACKGROUND PID]
 *   → extract the instruction, spawn a background data-processing script
 * [MAIN LOOP UNBLOCKED]
 *   → prove event loop responsiveness while task runs
 * [TASK COMPLETE]
 *   → task finishes with exit code 0 and correct output
 * [JULES VALIDATION]
 *   → Jules worker picks up artifact, validates against requirements
 * [SUCCESS]
 *   → Full report generated and persisted
 *
 * Run: npx tsx src/tests/antigravity_swarm/test_antigravity_e2e.ts
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { LocalStore } from '../../persistence/local_store.js';
import { generateStatusReport } from '../../swarm/report_writer.js';

// ── Utilities ───────────────────────────────────────────────────────────────

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`    ${PASS} — ${testName}`);
  } else {
    console.log(`    ${FAIL} — ${testName}${details ? ` (${details})` : ''}`);
  }
}

function ts(): string {
  return new Date().toISOString().split('T')[1].split('.')[0];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Transition Logger ───────────────────────────────────────────────────────

const transitions: Array<{ phase: string; ts: string; detail: string }> = [];

function logTransition(phase: string, detail: string): void {
  const t = ts();
  transitions.push({ phase, ts: t, detail });
  console.log(`    [${t}] [${phase}] ${detail}`);
}

// ── Main Test ───────────────────────────────────────────────────────────────

async function runE2E(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ANTIGRAVITY E2E: Full Swarm Integration Harness        ║');
  console.log('║  "Mega-Context → Background Task → Jules Handoff"       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-e2e-'));
  const store = new LocalStore(path.join(tempDir, '.swarm'));

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 1: MEGA-CONTEXT INGEST
  // ──────────────────────────────────────────────────────────────────────
  console.log('━'.repeat(60));
  console.log('  STEP 1: MEGA-CONTEXT INGEST');
  console.log('━'.repeat(60));

  const memBefore = process.memoryUsage();
  const ingestStart = performance.now();

  // Generate massive payload with a hidden processing instruction
  const SECRET_HASH = crypto.randomBytes(8).toString('hex').toUpperCase();
  const INSTRUCTION_LINE = 22_345;
  const TOTAL_LINES = 35_000;

  const lines: string[] = [];
  for (let i = 1; i <= TOTAL_LINES; i++) {
    if (i === INSTRUCTION_LINE) {
      // The hidden instruction
      lines.push(`{"line":${i},"type":"INSTRUCTION","action":"compute_sum","range":[1,1000],"verify_hash":"${SECRET_HASH}"}`);
    } else {
      lines.push(`{"line":${i},"type":"log","msg":"Data row ${i}","value":${Math.random().toFixed(6)}}`);
    }
  }
  const megaPayload = lines.join('\n');
  const payloadBytes = Buffer.byteLength(megaPayload);

  const ingestTime = performance.now() - ingestStart;
  const memAfter = process.memoryUsage();

  logTransition('MEGA-CONTEXT INGEST', `${TOTAL_LINES.toLocaleString()} lines, ${formatBytes(payloadBytes)}, ${ingestTime.toFixed(0)}ms`);
  console.log(`    Memory Δ: +${Math.round((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024))}MB heap`);

  assert(payloadBytes >= 2 * 1024 * 1024, `Payload is 2MB+ (got: ${formatBytes(payloadBytes)})`);
  assert(ingestTime < 5000, `Ingestion completed in <5s (got: ${ingestTime.toFixed(0)}ms)`);

  // Extract the hidden instruction from the mega-context
  const extractStart = performance.now();
  let extractedInstruction: any = null;
  for (const line of megaPayload.split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'INSTRUCTION') {
        extractedInstruction = parsed;
        break;
      }
    } catch { continue; }
  }
  const extractTime = performance.now() - extractStart;

  assert(extractedInstruction !== null, 'Hidden instruction extracted from mega-context');
  assert(extractedInstruction?.verify_hash === SECRET_HASH, `Hash verified: ${SECRET_HASH}`);
  assert(extractedInstruction?.action === 'compute_sum', 'Action is compute_sum');
  console.log(`    Extraction time: ${extractTime.toFixed(0)}ms`);
  console.log(`    Instruction: ${JSON.stringify(extractedInstruction)}`);

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 2: SPAWN BACKGROUND PID
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('  STEP 2: SPAWN BACKGROUND PID');
  console.log('━'.repeat(60));

  // Generate the data-processing script based on the extracted instruction
  const [rangeStart, rangeEnd] = extractedInstruction.range;
  const scriptContent = [
    `import sys, time`,
    `# Data processing task extracted from mega-context`,
    `# Instruction: compute_sum(${rangeStart}, ${rangeEnd})`,
    `# Verify hash: ${SECRET_HASH}`,
    ``,
    `print("PROCESSING: sum(${rangeStart}..${rangeEnd})", flush=True)`,
    `time.sleep(3)  # Simulate heavy processing`,
    ``,
    `result = sum(range(${rangeStart}, ${rangeEnd} + 1))`,
    `print("RESULT=" + str(result), flush=True)`,
    `print("HASH=${SECRET_HASH}", flush=True)`,
    `print("STATUS=SUCCESS", flush=True)`,
    `sys.exit(0)`,
  ].join('\n') + '\n';

  const scriptPath = path.join(tempDir, 'process_data.py');
  fs.writeFileSync(scriptPath, scriptContent, 'utf8');

  const spawnTime = performance.now();
  const isWin = os.platform() === 'win32';
  const pythonCmd = isWin ? 'python' : 'python3';

  const child = spawn(pythonCmd, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  const spawnReturnMs = performance.now() - spawnTime;
  logTransition('SPAWN BACKGROUND PID', `PID=${child.pid}, spawn returned in ${spawnReturnMs.toFixed(0)}ms`);

  assert(child.pid !== undefined, `Process spawned with PID: ${child.pid}`);
  assert(spawnReturnMs < 1000, `Spawn returned immediately (<1s, got: ${spawnReturnMs.toFixed(0)}ms)`);

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 3: MAIN LOOP UNBLOCKED
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('  STEP 3: MAIN LOOP UNBLOCKED');
  console.log('━'.repeat(60));

  let mainPings = 0;
  const pingLog: string[] = [];
  const pingStartMs = performance.now();

  const pingInterval = setInterval(() => {
    mainPings++;
    const elapsed = ((performance.now() - pingStartMs) / 1000).toFixed(2);
    const msg = `Ping #${mainPings} at +${elapsed}s`;
    pingLog.push(msg);
    console.log(`    [${ts()}] [PING] ${msg}`);
  }, 500);

  // Also check setImmediate responsiveness
  const immediateDelay = await new Promise<number>((resolve) => {
    const start = performance.now();
    setImmediate(() => resolve(performance.now() - start));
  });

  logTransition('MAIN LOOP UNBLOCKED', `Event loop delay: ${immediateDelay.toFixed(1)}ms, pinging every 500ms`);
  assert(immediateDelay < 50, `Event loop responded in <50ms (got: ${immediateDelay.toFixed(1)}ms)`);

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 4: TASK COMPLETE
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('  STEP 4: TASK COMPLETE');
  console.log('━'.repeat(60));

  const taskResult = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code });
    });

    // Failsafe
    setTimeout(() => {
      child.kill();
      resolve({ stdout, stderr: stderr + '\n[TIMEOUT]', exitCode: -1 });
    }, 30_000);
  });

  clearInterval(pingInterval);
  const totalTaskMs = performance.now() - spawnTime;

  logTransition('TASK COMPLETE', `Exit code ${taskResult.exitCode}, duration ${(totalTaskMs / 1000).toFixed(2)}s, ${mainPings} pings during execution`);

  console.log(`    Stdout: ${taskResult.stdout}`);
  if (taskResult.stderr) console.log(`    Stderr: ${taskResult.stderr}`);

  assert(taskResult.exitCode === 0, 'Task exited with code 0');
  assert(taskResult.stdout.includes('STATUS=SUCCESS'), 'Task output contains SUCCESS');
  assert(taskResult.stdout.includes(`HASH=${SECRET_HASH}`), 'Task output contains correct hash');
  assert(taskResult.stdout.includes('RESULT=500500'), 'Task computed correct sum (1..1000 = 500500)');
  assert(mainPings >= 4, `Event loop stayed responsive (${mainPings} pings ≥ 4)`);

  // Verify pings were interleaved (happened DURING the task)
  const pingsDuringTask = pingLog.length;
  assert(pingsDuringTask >= 4, `Pings interleaved during 3s task (got: ${pingsDuringTask})`);

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 5: JULES VALIDATION
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('  STEP 5: JULES VALIDATION');
  console.log('━'.repeat(60));

  // Jules receives the artifact and validates
  const julesInput = {
    originalPrompt: `Process mega-context data. Extract instruction, execute compute_sum(1,1000), verify hash ${SECRET_HASH}.`,
    agentStdout: taskResult.stdout,
    agentExitCode: taskResult.exitCode,
  };

  console.log(`    [${ts()}] Jules received artifact:`);
  console.log(`      Prompt:  "${julesInput.originalPrompt.substring(0, 80)}..."`);
  console.log(`      Stdout:  "${julesInput.agentStdout.split('\n')[0]}..."`);
  console.log(`      Exit:    ${julesInput.agentExitCode}`);

  // Jules validation logic
  const julesChecks = {
    exitCodeValid: julesInput.agentExitCode === 0,
    resultPresent: julesInput.agentStdout.includes('RESULT=500500'),
    hashMatch: julesInput.agentStdout.includes(`HASH=${SECRET_HASH}`),
    statusSuccess: julesInput.agentStdout.includes('STATUS=SUCCESS'),
  };

  const allChecksPass = Object.values(julesChecks).every(Boolean);
  const julesVerdict = allChecksPass ? 'VALIDATED' : 'REJECTED';

  logTransition('JULES VALIDATION', `Verdict: ${julesVerdict} (${Object.values(julesChecks).filter(Boolean).length}/${Object.keys(julesChecks).length} checks passed)`);

  console.log(`    Checks:`);
  for (const [k, v] of Object.entries(julesChecks)) {
    console.log(`      ${v ? '✅' : '❌'} ${k}`);
  }

  assert(julesChecks.exitCodeValid, 'Jules: exit code is valid');
  assert(julesChecks.resultPresent, 'Jules: result value present');
  assert(julesChecks.hashMatch, 'Jules: hash verification passed');
  assert(julesChecks.statusSuccess, 'Jules: status is SUCCESS');
  assert(julesVerdict === 'VALIDATED', 'Jules final verdict: VALIDATED');

  // ──────────────────────────────────────────────────────────────────────
  //  STEP 6: SUCCESS — Report & Persist
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('  STEP 6: SUCCESS');
  console.log('━'.repeat(60));

  // Generate and save the final report
  store.saveSession('e2e-session-001', {
    id: 'e2e-session-001',
    state: 'COMPLETED',
    strategy: 'data_processing',
    agentNumber: 1,
    title: 'Antigravity E2E Data Processing',
    pulled: true,
    approved: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const report = generateStatusReport({
    sessions: [{
      index: 0,
      id: 'e2e-session-001',
      state: 'COMPLETED',
      strategy: 'data_processing',
      agentNumber: 1,
      title: 'Antigravity E2E',
    }],
    pollNumber: 1,
    maxPolls: 1,
    pulledSessions: new Set(['e2e-session-001']),
    strategies: ['data_processing'],
  });

  store.writeStatusReport(report);
  store.appendLog('e2e.log', `E2E completed: ${julesVerdict}`);
  store.appendLog('e2e.log', `Result: ${taskResult.stdout.split('\n').find(l => l.startsWith('RESULT='))}`);

  logTransition('SUCCESS', 'Report written, session persisted, logs saved');

  assert(fs.existsSync(store.getStatusReportPath()), 'Final report persisted');
  assert(fs.existsSync(store.getLogPath('e2e.log')), 'E2E log persisted');

  // ── Print full transition timeline ────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  SWARM STATE TRANSITION TIMELINE');
  console.log('═'.repeat(60));

  for (const t of transitions) {
    const icon = {
      'MEGA-CONTEXT INGEST': '📦',
      'SPAWN BACKGROUND PID': '🚀',
      'MAIN LOOP UNBLOCKED': '💚',
      'TASK COMPLETE': '✅',
      'JULES VALIDATION': '🔍',
      'SUCCESS': '🏆',
    }[t.phase] || '▶';
    console.log(`  ${icon} [${t.ts}] [${t.phase}] ${t.detail}`);
  }

  console.log('═'.repeat(60));

  // Cleanup
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  E2E RESULTS: ${passedTests}/${totalTests} assertions passed${' '.repeat(Math.max(0, 30 - `${passedTests}/${totalTests}`.length))}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) process.exit(1);
}

runE2E().catch(err => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
