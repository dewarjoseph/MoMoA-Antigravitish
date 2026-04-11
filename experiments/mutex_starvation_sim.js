// ═══ OUROBOROS Experiment: _connectionMutex Starvation Simulation ═══
// Models concurrent lock acquisition under synthetic load

class MutexSimulator {
  constructor() {
    this._connectionMutex = Promise.resolve();
    this.metrics = [];
    this.acquisitions = 0;
  }

  async runWithLock(label, workMs) {
    const requestTime = performance.now();
    const previous = this._connectionMutex;
    let release;
    this._connectionMutex = new Promise(r => { release = r; });
    await previous.catch(() => {});
    const acquireTime = performance.now();
    const waitTime = acquireTime - requestTime;

    // Simulate work
    await new Promise(r => setTimeout(r, workMs));

    this.acquisitions++;
    this.metrics.push({ label, waitTime: Math.round(waitTime * 100) / 100, workMs, acquireOrder: this.acquisitions });
    release();
    return waitTime;
  }
}

async function runExperiment() {
  const results = { experiments: [] };

  // ── Experiment 1: Reload Storm + Shutdown Starvation ──
  const sim = new MutexSimulator();
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(sim.runWithLock(`reload-${i}`, 50));
    if (i === 5) {
      promises.push(sim.runWithLock('SHUTDOWN', 100));
    }
  }
  await Promise.all(promises);

  const shutdownMetric = sim.metrics.find(m => m.label === 'SHUTDOWN');
  const reloadMetrics = sim.metrics.filter(m => m.label.startsWith('reload'));
  const avgReloadWait = reloadMetrics.reduce((s, m) => s + m.waitTime, 0) / reloadMetrics.length;
  const maxReloadWait = Math.max(...reloadMetrics.map(m => m.waitTime));

  results.experiments.push({
    name: 'Reload Storm Starvation',
    shutdownWaitMs: shutdownMetric?.waitTime || -1,
    shutdownAcquireOrder: shutdownMetric?.acquireOrder || -1,
    avgReloadWaitMs: Math.round(avgReloadWait * 100) / 100,
    maxReloadWaitMs: Math.round(maxReloadWait * 100) / 100,
    totalAcquisitions: sim.acquisitions,
    starvationDetected: shutdownMetric?.acquireOrder > 7
  });

  // ── Experiment 2: Fire-and-Forget Race Window ──
  const sim2 = new MutexSimulator();
  let fireAndForgetCompleted = false;
  let raceDetected = false;

  const hotPlugPromise = sim2.runWithLock('hotPlug', 30).then(() => {
    // Simulates onToolsChanged() called without await (mcpClientManager.ts L619)
    const _unawaitedWork = new Promise(r => setTimeout(() => {
      fireAndForgetCompleted = true;
      r();
    }, 100));
    // NOT awaited — reproducing the bug
  });

  const nextOpPromise = sim2.runWithLock('nextOp', 10).then(() => {
    raceDetected = !fireAndForgetCompleted;
  });

  await Promise.all([hotPlugPromise, nextOpPromise]);
  await new Promise(r => setTimeout(r, 200));

  results.experiments.push({
    name: 'Fire-and-Forget Race',
    raceDetected,
    fireAndForgetCompletedBeforeNextOp: fireAndForgetCompleted,
    explanation: raceDetected
      ? 'CONFIRMED: nextOp completed BEFORE onToolsChanged() finished. Tool registry state may be inconsistent during hot-plug.'
      : 'No race detected in this trial.'
  });

  // ── Experiment 3: Lock Contention Scaling ──
  const scalingResults = [];
  for (const concurrency of [5, 10, 20, 50, 100]) {
    const sim3 = new MutexSimulator();
    const start = performance.now();
    const p = [];
    for (let i = 0; i < concurrency; i++) {
      p.push(sim3.runWithLock(`worker-${i}`, 10));
    }
    await Promise.all(p);
    const elapsed = performance.now() - start;
    const waits = sim3.metrics.map(m => m.waitTime);
    scalingResults.push({
      concurrency,
      totalElapsedMs: Math.round(elapsed * 100) / 100,
      avgWaitMs: Math.round((waits.reduce((s, w) => s + w, 0) / waits.length) * 100) / 100,
      maxWaitMs: Math.round(Math.max(...waits) * 100) / 100,
      p99WaitMs: Math.round(waits.sort((a, b) => a - b)[Math.floor(waits.length * 0.99)] * 100) / 100
    });
  }
  results.experiments.push({
    name: 'Lock Contention Scaling',
    data: scalingResults
  });

  // ── Final Output ──
  console.log(JSON.stringify(results, null, 2));
}

runExperiment().catch(e => console.error(e));
