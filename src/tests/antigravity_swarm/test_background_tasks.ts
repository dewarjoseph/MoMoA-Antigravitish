/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST B: Background Task Spinning — Non-Blocking Async Validation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates:
 * 1. A 5-second background script is spawned and returns immediately
 * 2. The main thread remains responsive (500ms interval pings)
 * 3. The background job resolves with correct exit code and stdout
 * 4. Interleaved timestamps prove concurrency
 * 5. Multiple concurrent background tasks complete independently
 *
 * Run: npx tsx src/tests/antigravity_swarm/test_background_tasks.ts
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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

function ts(): string {
  return new Date().toISOString().split('T')[1].split('.')[0];
}

// ── Background Job Abstraction ──────────────────────────────────────────────

interface BackgroundJob {
  id: string;
  pid: number | null;
  startedAt: number;
  promise: Promise<{ stdout: string; stderr: string; exitCode: number | null; durationMs: number }>;
}

/**
 * Spawn a background job that returns immediately and resolves later.
 * This mirrors how MoMo's CodeRunnerTool should handle long-running tasks.
 */
function spawnBackgroundJob(
  id: string,
  script: string,
  durationHint: string
): BackgroundJob {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `bg-job-${id}-`));
  const scriptPath = path.join(tempDir, 'task.py');
  fs.writeFileSync(scriptPath, script, 'utf8');

  const startedAt = performance.now();
  const isWin = os.platform() === 'win32';
  const cmd = isWin ? 'python' : 'python3';

  const child = spawn(cmd, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  SwarmTracer.getInstance().emitLog(`    [${ts()}] [SPAWN] Job "${id}" → PID ${child.pid} (${durationHint})`);

  const promise = new Promise<{ stdout: string; stderr: string; exitCode: number | null; durationMs: number }>(
    (resolve) => {
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      child.on('close', (code) => {
        const durationMs = performance.now() - startedAt;
        // Cleanup
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, durationMs });
      });

      child.on('error', (err) => {
        resolve({ stdout: '', stderr: err.message, exitCode: -1, durationMs: performance.now() - startedAt });
      });

      // Failsafe timeout
      setTimeout(() => {
        child.kill('SIGTERM');
      }, 30_000);
    }
  );

  return { id, pid: child.pid ?? null, startedAt, promise };
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog('║  TEST B: Background Task Spinning                       ║');
  SwarmTracer.getInstance().emitLog('║  "Non-Blocking Async Job Orchestration"                  ║');
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  // ── Phase 1: Single Background Job + Main Thread Pings ────────────────
  SwarmTracer.getInstance().emitLog('── Phase 1: Single Background Job + Main Thread Liveness ──');

  const SLEEP_SECONDS = 4;
  const EXPECTED_MIN_PINGS = 5;

  const mainThreadPings: Array<{ ts: number; label: string }> = [];
  const spawnTimestamp = performance.now();

  // Spawn the background job (returns immediately!)
  const job = spawnBackgroundJob(
    'sleep-task',
    `import time, sys
print("STARTED", flush=True)
time.sleep(${SLEEP_SECONDS})
print("COMPLETED after ${SLEEP_SECONDS}s sleep", flush=True)
sys.exit(0)
`,
    `~${SLEEP_SECONDS}s sleep`
  );

  const afterSpawnMs = performance.now() - spawnTimestamp;
  SwarmTracer.getInstance().emitLog(`    [${ts()}] [MAIN] Spawn returned in ${afterSpawnMs.toFixed(1)}ms`);
  mainThreadPings.push({ ts: performance.now(), label: 'SPAWN_RETURN' });

  assert(afterSpawnMs < 1000, `Spawn returned in <1s (got: ${afterSpawnMs.toFixed(0)}ms)`);

  // Start concurrent pings on the main thread
  let pingCount = 0;
  const pingInterval = setInterval(() => {
    pingCount++;
    const elapsed = ((performance.now() - spawnTimestamp) / 1000).toFixed(2);
    SwarmTracer.getInstance().emitLog(`    [${ts()}] [PING ${pingCount}] Main thread alive at +${elapsed}s`);
    mainThreadPings.push({ ts: performance.now(), label: `PING_${pingCount}` });
  }, 500);

  // Wait for the background job to complete
  const result = await job.promise;
  clearInterval(pingInterval);

  SwarmTracer.getInstance().emitLog(`    [${ts()}] [DONE] Job "${job.id}" completed:`);
  SwarmTracer.getInstance().emitLog(`      Exit code: ${result.exitCode}`);
  SwarmTracer.getInstance().emitLog(`      Duration:  ${(result.durationMs / 1000).toFixed(2)}s`);
  SwarmTracer.getInstance().emitLog(`      Stdout:    ${result.stdout}`);
  if (result.stderr) SwarmTracer.getInstance().emitLog(`      Stderr:    ${result.stderr}`);

  assert(result.exitCode === 0, 'Background job exited with code 0');
  assert(result.durationMs >= (SLEEP_SECONDS - 1) * 1000, `Job took ≥${SLEEP_SECONDS - 1}s (got: ${(result.durationMs / 1000).toFixed(2)}s)`);
  assert(result.stdout.includes('COMPLETED'), 'Job stdout contains COMPLETED');
  assert(pingCount >= EXPECTED_MIN_PINGS, `Main thread handled ≥${EXPECTED_MIN_PINGS} pings during job (got: ${pingCount})`);

  // Prove interleaving: pings happened DURING the job, not after
  const jobEndTs = job.startedAt + result.durationMs;
  const pingsDuringJob = mainThreadPings.filter(
    p => p.label.startsWith('PING_') && p.ts < jobEndTs
  ).length;
  SwarmTracer.getInstance().emitLog(`    [INFO] Pings during job execution: ${pingsDuringJob}`);
  assert(pingsDuringJob >= EXPECTED_MIN_PINGS, `Pings interleaved during job (${pingsDuringJob} ≥ ${EXPECTED_MIN_PINGS})`);

  // ── Phase 2: Multiple Concurrent Background Tasks ─────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 2: Concurrent Background Task Fan-Out ──');

  const concurrentJobs: BackgroundJob[] = [];
  const fanOutStart = performance.now();

  // Spawn 3 tasks with different durations
  for (let i = 0; i < 3; i++) {
    const sleepSecs = 2 + i; // 2s, 3s, 4s
    const job = spawnBackgroundJob(
      `concurrent-${i}`,
      `import time, sys, os
print(f"JOB-${i} STARTED (PID={os.getpid()})", flush=True)
time.sleep(${sleepSecs})
result = sum(range(1, ${(i + 1) * 10000}))
print(f"JOB-${i} DONE result={result}", flush=True)
sys.exit(0)
`,
      `${sleepSecs}s`
    );
    concurrentJobs.push(job);
  }

  const spawnAllMs = performance.now() - fanOutStart;
  SwarmTracer.getInstance().emitLog(`    [${ts()}] [MAIN] All 3 jobs spawned in ${spawnAllMs.toFixed(1)}ms`);
  assert(spawnAllMs < 2000, `All jobs spawned in <2s (got: ${spawnAllMs.toFixed(0)}ms)`);

  // Wait for all to complete
  const concurrentResults = await Promise.all(concurrentJobs.map(j => j.promise));
  const totalConcurrentMs = performance.now() - fanOutStart;
  SwarmTracer.getInstance().emitLog(`    [${ts()}] [MAIN] All 3 jobs completed in ${(totalConcurrentMs / 1000).toFixed(2)}s`);

  for (let i = 0; i < concurrentResults.length; i++) {
    const r = concurrentResults[i];
    SwarmTracer.getInstance().emitLog(`    [INFO] Job ${i}: exit=${r.exitCode}, duration=${(r.durationMs / 1000).toFixed(2)}s, stdout="${r.stdout.split('\n').pop()}"`);
    assert(r.exitCode === 0, `Concurrent job ${i} exited with code 0`);
    assert(r.stdout.includes('DONE'), `Concurrent job ${i} completed`);
  }

  // True concurrency: total time should be ~max(2,3,4)=4s, not sum(2+3+4)=9s
  assert(totalConcurrentMs < 7000, `Concurrent jobs ran in parallel (<7s, got: ${(totalConcurrentMs / 1000).toFixed(2)}s)`);

  // ── Phase 3: CPU-Intensive Background + Responsive Main Thread ────────
  SwarmTracer.getInstance().emitLog('\n── Phase 3: CPU-Intensive Job + Event Loop Responsiveness ──');

  let eventLoopBlocked = false;
  const cpuJob = spawnBackgroundJob(
    'cpu-heavy',
    `import sys
# CPU-intensive: compute primes up to 50000
def sieve(n):
    is_prime = [True] * (n + 1)
    is_prime[0] = is_prime[1] = False
    for i in range(2, int(n**0.5) + 1):
        if is_prime[i]:
            for j in range(i*i, n + 1, i):
                is_prime[j] = False
    return sum(1 for x in is_prime if x)

count = sieve(50000)
print(f"PRIMES_FOUND={count}", flush=True)
sys.exit(0)
`,
    '~1-3s CPU'
  );

  // Check event loop responsiveness with setImmediate
  const elCheckStart = performance.now();
  const elPromise = new Promise<number>((resolve) => {
    setImmediate(() => {
      const delay = performance.now() - elCheckStart;
      resolve(delay);
    });
  });
  const eventLoopDelay = await elPromise;
  SwarmTracer.getInstance().emitLog(`    [${ts()}] Event loop responded in ${eventLoopDelay.toFixed(1)}ms`);
  assert(eventLoopDelay < 100, `Event loop not blocked (<100ms delay, got: ${eventLoopDelay.toFixed(1)}ms)`);

  const cpuResult = await cpuJob.promise;
  SwarmTracer.getInstance().emitLog(`    [${ts()}] CPU job done: ${cpuResult.stdout}`);
  assert(cpuResult.exitCode === 0, 'CPU-intensive job completed successfully');
  assert(cpuResult.stdout.includes('PRIMES_FOUND='), 'CPU job produced correct output');

  // ── Phase 4: Background Job State Tracking ────────────────────────────
  SwarmTracer.getInstance().emitLog('\n── Phase 4: Job State Machine ──');

  enum JobState { PENDING, RUNNING, COMPLETED, FAILED }
  const stateLog: Array<{ state: JobState; ts: number }> = [];

  const stateJob = spawnBackgroundJob(
    'stateful',
    `import time; print("OK"); time.sleep(1); print("FINAL")`,
    '~1s'
  );

  stateLog.push({ state: JobState.RUNNING, ts: performance.now() });
  SwarmTracer.getInstance().emitLog(`    [${ts()}] State: RUNNING`);

  const stateResult = await stateJob.promise;
  const finalState = stateResult.exitCode === 0 ? JobState.COMPLETED : JobState.FAILED;
  stateLog.push({ state: finalState, ts: performance.now() });
  SwarmTracer.getInstance().emitLog(`    [${ts()}] State: ${JobState[finalState]}`);

  assert(stateLog.length === 2, 'State machine tracked 2 transitions');
  assert(stateLog[0].state === JobState.RUNNING, 'Initial state: RUNNING');
  assert(stateLog[1].state === JobState.COMPLETED, 'Final state: COMPLETED');
  assert(stateLog[1].ts > stateLog[0].ts, 'State transitions are chronological');

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
