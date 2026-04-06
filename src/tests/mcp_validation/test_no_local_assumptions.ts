import * as fs from 'node:fs';
import * as path from 'node:path';

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

async function runTests(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST D: Local Child Process Assumption Check            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // We are checking that high-level orchestrator and swarm managers do NOT
  // rely on child_process to execute shell commands locally. Instead they
  // must delegate through the MCP tool interface (e.g. `executeTool`).
  
  const filesToCheck = [
    'src/swarm/swarm_manager.ts',
    'src/swarm/merge_supervisor.ts',
    'src/mcp/selfHealingRunner.ts',
    'src/momoa_core/orchestrator.ts',
  ];

  const rootDir = process.cwd();

  for (const relativePath of filesToCheck) {
    const fullPath = path.join(rootDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      assert(false, `File exists: ${relativePath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    
    // Check if child_process is imported
    const hasChildProcessImport = content.includes('child_process');
    assert(!hasChildProcessImport, `No child_process import in ${relativePath}`, hasChildProcessImport ? 'Found child_process usage' : undefined);

    // Check if spawn or exec is used (if not imported, this might be safe, but we double check)
    // We check for typical spawn/exec uses around process dispatching.
    const hasSpawn = /\bspawn\s*\(/.test(content);
    const hasExec = /\bexec\s*\(|execSync\s*\(/.test(content);
    
    // To minimize false positives with other `spawn` methods not from child_process, 
    // we only fail if it was from child_process, but we do warn. 
    if (hasSpawn || hasExec) {
        assert(!hasChildProcessImport, `Checking local spawn usage in ${relativePath}`, 'Contains spawn() but hopefully mapped to a class or mock if no import present');
    }

  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passedTests}/${totalTests} tests passed${' '.repeat(Math.max(0, 35 - `${passedTests}/${totalTests}`.length))}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) { process.exit(1); } else { process.exit(0); }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
