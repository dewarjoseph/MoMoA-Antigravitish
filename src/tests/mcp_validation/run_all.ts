/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MASTER TEST RUNNER — MCP Validation Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs all test harnesses in sequence and reports overall results.
 *
 * Run: npx tsx src/tests/mcp_validation/run_all.ts
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
  { name: 'Test B: Self-Healing Retry Logic', file: 'test_self_healing_logic.ts' },
  { name: 'Test C: MCP Resources & Prompts', file: 'test_mcp_resources.ts' },
  { name: 'Test D: Bi-Directional MCP Host', file: 'test_agent_as_mcp.ts' },
  { name: 'Test E: Dynamic MCP Hot-Plug', file: 'test_mcp_hotplug.ts' },
  { name: 'Test F: Architecture Local Assumption Check', file: 'test_no_local_assumptions.ts' },
  { name: 'E2E Crucible: Self-Healing Integration', file: 'test_e2e_crucible.ts' },
];

async function runSuite(suite: TestSuite): Promise<{ passed: boolean; output: string }> {
  const suiteDir = __dirname;
  const suitePath = path.join(suiteDir, suite.file);

  return new Promise((resolve) => {
    const child = spawn(tsxCmd, ['-y', 'tsx', suitePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWin,
      env: { ...process.env },
      cwd: path.resolve(suiteDir, '..', '..', '..'),
    });

    let output = '';
    child.stdout?.on('data', d => {
      const text = d.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', d => {
      const text = d.toString();
      output += text;
      // Only forward non-noisy stderr
      if (!text.includes('ExperimentalWarning') && !text.includes('--trace-warnings')) {
        process.stderr.write(text);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ passed: false, output: output + '\n[TIMEOUT after 120s]' });
    }, 120000);

    child.on('close', code => {
      clearTimeout(timer);
      resolve({ passed: code === 0, output });
    });

    child.on('error', err => {
      clearTimeout(timer);
      resolve({ passed: false, output: output + `\n[SPAWN ERROR: ${err.message}]` });
    });
  });
}

async function main(): Promise<void> {
  SwarmTracer.getInstance().emitLog('\n' + '█'.repeat(60));
  SwarmTracer.getInstance().emitLog('█                                                          █');
  SwarmTracer.getInstance().emitLog('█   MoMo MCP Validation Suite — Phase 3 Proof of Work     █');
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
