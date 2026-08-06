import { spawn } from 'child_process';
import * as path from 'path';

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';

async function runFuzzTest() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST: Integration Fuzzing & Robustness                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Boot the MCP daemon in a background process
  const scriptPath = path.join(process.cwd(), 'dist', 'cli.js');
  const child = spawn('node', [scriptPath, 'daemon'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  child.stderr.on('data', (data) => {
    output += data.toString();
  });

  // Fuzz inputs
  const malformedInputs = [
    'Not a JSON string',
    '{"status": "PROGRESS_UPDATES", "completed_status_message": "test",', // Syntax error
    '{"type": "UNKNOWN_EVENT"}', // Unhandled schema
    '{"jsonrpc":"2.0","method":"unknown/method","params":{}}',
    '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"unknown_tool","arguments":{}}}'
  ];

  for (const input of malformedInputs) {
    child.stdin.write(input + '\n');
  }

  // Graceful shutdown attempt
  child.stdin.end();

  // Wait for closure
  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
    // Timeout if hung
    setTimeout(() => {
      child.kill();
      resolve(-1);
    }, 5000);
  });

  const didNotCrash = exitCode === 0;
  console.log(didNotCrash ? `  ${PASS} — Daemon survived malformed fuzzed inputs` : `  ${FAIL} — Daemon crashed during fuzzing (Exit Code: ${exitCode})`);

  if (!didNotCrash) {
      console.log('--- OUTPUT DUMP ---');
      console.log(output);
      console.log('-------------------');
  }

  process.exit(didNotCrash ? 0 : 1);
}

runFuzzTest().catch(console.error);
