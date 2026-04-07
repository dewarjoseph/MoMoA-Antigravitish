/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MASTER TEST RUNNER — Antigravity Swarm Validation Suite (Phase 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Run: npx tsx src/tests/antigravity_swarm/run_all.ts
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { SwarmTracer } from '../../telemetry/tracer.js';

const isWin = os.platform() === 'win32';
const tsxCmd = isWin ? 'npx.cmd' : 'npx';

interface TestSuite {
  name: string;
  file: string;
}

const SUITES: TestSuite[] = [
  { name: 'Test A: Mega-Context Stress', file: 'test_mega_context.ts' },
  { name: 'Test B: Background Task Spinning', file: 'test_background_tasks.ts' },
  { name: 'Test C: Jules Validation Handoff', file: 'test_jules_validation.ts' },
  { name: 'E2E: Antigravity Swarm Integration', file: 'test_antigravity_e2e.ts' },
];

async function runSuite(suite: TestSuite): Promise<{ passed: boolean; output: string }> {
  const suiteDir = __dirname;
  const suitePath = path.join(suiteDir, suite.file);

  return new Promise((resolve) => {
    const child = spawn(tsxCmd, ['-y', 'tsx', suitePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: path.resolve(suiteDir, '..', '..', '..'),
    });

    let output = '';
    child.stdout?.on('data', (d: Buffer) => {
      const text = d.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const text = d.toString();
      output += text;
      if (!text.includes('ExperimentalWarning') && !text.includes('--trace-warnings') && !text.includes('DEP0190')) {
        process.stderr.write(text);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ passed: false, output: output + '\n[TIMEOUT after 120s]' });
    }, 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ passed: code === 0, output });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ passed: false, output: output + `\n[SPAWN ERROR: ${err.message}]` });
    });
  });
}

async function main(): Promise<void> {
  SwarmTracer.getInstance().emitLog('\n' + '█'.repeat(60));
  SwarmTracer.getInstance().emitLog('█                                                          █');
  SwarmTracer.getInstance().emitLog('█   ANTIGRAVITY SWARM — Phase 4 Validation Suite           █');
  SwarmTracer.getInstance().emitLog('█   Mega-Contexts • Background Tasks • Jules Handoff       █');
  SwarmTracer.getInstance().emitLog('█                                                          █');
  SwarmTracer.getInstance().emitLog('█'.repeat(60) + '\n');

  const results: Array<{ name: string; passed: boolean }> = [];

  for (const suite of SUITES) {
    SwarmTracer.getInstance().emitLog('\n' + '▓'.repeat(60));
    SwarmTracer.getInstance().emitLog(`▓  Running: ${suite.name}`);
    SwarmTracer.getInstance().emitLog('▓'.repeat(60) + '\n');

    const result = await runSuite(suite);
    results.push({ name: suite.name, passed: result.passed });

    SwarmTracer.getInstance().emitLog(`\n  ➤ ${result.passed ? '✅' : '❌'} ${suite.name}: ${result.passed ? 'PASSED' : 'FAILED'}`);
  }

  // Grand summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  SwarmTracer.getInstance().emitLog('\n\n' + '█'.repeat(60));
  SwarmTracer.getInstance().emitLog('█                                                          █');
  SwarmTracer.getInstance().emitLog('█   GRAND SUMMARY                                          █');
  SwarmTracer.getInstance().emitLog('█                                                          █');
  SwarmTracer.getInstance().emitLog('█'.repeat(60) + '\n');

  for (const r of results) {
    SwarmTracer.getInstance().emitLog(`  ${r.passed ? '✅' : '❌'} ${r.name}`);
  }

  SwarmTracer.getInstance().emitLog(`\n  Total: ${passed}/${total} suites passed`);
  SwarmTracer.getInstance().emitLog('\n' + '█'.repeat(60) + '\n');

  if (passed < total) process.exit(1);
}

main().catch(err => {
  SwarmTracer.getInstance().emitLog('Fatal runner error:', err);
  process.exit(1);
});
