/**
 * OUROBOROS Cycle 2 — Task 1 Validation Script
 * Tests that onToolsChanged() is awaited inside the lock scope
 * by verifying sequential execution ordering.
 *
 * If onToolsChanged() is NOT awaited, nextOp will complete
 * before the callback finishes → race detected.
 */

const { performance } = require('perf_hooks');

class McpClientManagerSimulator {
  constructor() {
    this._connectionMutex = Promise.resolve();
    this.connections = new Map();
    this.onToolsChanged = null;
    this._executionLog = [];
  }

  async runWithLock(fn) {
    const previous = this._connectionMutex;
    let release;
    this._connectionMutex = new Promise(r => { release = r; });
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // BUGGY version (original): does NOT await onToolsChanged
  async hotPlugServer_BUGGY(name) {
    return this.runWithLock(async () => {
      this.connections.set(name, { tools: new Map([['tool1', {}]]) });
      this._executionLog.push(`hotPlug:${name}:connected`);

      // BUG: fire-and-forget
      if (this.onToolsChanged) {
        this.onToolsChanged();
      }

      this._executionLog.push(`hotPlug:${name}:returned`);
      return ['tool1'];
    });
  }

  // FIXED version: awaits onToolsChanged
  async hotPlugServer_FIXED(name) {
    return this.runWithLock(async () => {
      this.connections.set(name, { tools: new Map([['tool1', {}]]) });
      this._executionLog.push(`hotPlug:${name}:connected`);

      // FIX: await the callback
      if (this.onToolsChanged) {
        await this.onToolsChanged();
      }

      this._executionLog.push(`hotPlug:${name}:returned`);
      return ['tool1'];
    });
  }
}

async function runTest(label, hotPlugFn) {
  const sim = new McpClientManagerSimulator();
  let callbackCompleted = false;

  sim.onToolsChanged = async () => {
    // Simulate async registry update (e.g., re-registering tools)
    await new Promise(r => setTimeout(r, 100));
    callbackCompleted = true;
    sim._executionLog.push('onToolsChanged:completed');
  };

  // Run hotPlug and immediately schedule a next operation
  const hotPlugPromise = hotPlugFn.call(sim, 'test-server');

  const nextOpPromise = sim.runWithLock(async () => {
    sim._executionLog.push(`nextOp:callbackWasComplete=${callbackCompleted}`);
    return callbackCompleted;
  });

  await Promise.all([hotPlugPromise, nextOpPromise]);
  // Wait for any dangling fire-and-forget
  await new Promise(r => setTimeout(r, 200));

  return {
    label,
    callbackCompleteBeforeNextOp: callbackCompleted,
    executionLog: sim._executionLog,
    raceDetected: sim._executionLog.some(e =>
      e.startsWith('nextOp:callbackWasComplete=false')
    )
  };
}

async function main() {
  console.log('=== OUROBOROS Cycle 2 — Task 1: await_fix Validation ===\n');

  // Test 1: Buggy version (should detect race)
  const buggyResult = await runTest(
    'BUGGY (no await)',
    McpClientManagerSimulator.prototype.hotPlugServer_BUGGY
  );

  // Test 2: Fixed version (should NOT detect race)
  const fixedResult = await runTest(
    'FIXED (with await)',
    McpClientManagerSimulator.prototype.hotPlugServer_FIXED
  );

  console.log('--- BUGGY Version ---');
  console.log(`  Race detected: ${buggyResult.raceDetected}`);
  console.log(`  Execution log: ${JSON.stringify(buggyResult.executionLog)}`);
  console.log();

  console.log('--- FIXED Version ---');
  console.log(`  Race detected: ${fixedResult.raceDetected}`);
  console.log(`  Execution log: ${JSON.stringify(fixedResult.executionLog)}`);
  console.log();

  // Assertions
  const passed = buggyResult.raceDetected && !fixedResult.raceDetected;
  console.log(`=== TEST RESULT: ${passed ? '✅ PASS' : '❌ FAIL'} ===`);
  console.log(`  Buggy race confirmed: ${buggyResult.raceDetected}`);
  console.log(`  Fixed race eliminated: ${!fixedResult.raceDetected}`);

  if (!passed) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
