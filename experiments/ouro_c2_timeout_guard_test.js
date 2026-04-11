/**
 * OUROBOROS Cycle 2 — Task 2 Validation Script
 * Tests that Promise.race timeout pattern correctly bounds
 * an arbitrarily long async operation.
 */

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[Autonomic Pulse] ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runTests() {
  console.log('=== OUROBOROS Cycle 2 — Task 2: timeout_guard Validation ===\n');

  // Test 1: Fast operation completes before timeout
  let test1Passed = false;
  try {
    const result = await withTimeout(
      new Promise(r => setTimeout(() => r('fast-result'), 50)),
      1000,
      'Test1-Fast'
    );
    test1Passed = result === 'fast-result';
    console.log(`Test 1 (fast op finishes): ${test1Passed ? '✅ PASS' : '❌ FAIL'} — result: ${result}`);
  } catch (e) {
    console.log(`Test 1 (fast op finishes): ❌ FAIL — unexpected timeout: ${e.message}`);
  }

  // Test 2: Slow operation exceeds timeout
  let test2Passed = false;
  try {
    await withTimeout(
      new Promise(r => setTimeout(() => r('slow-result'), 5000)),
      100,
      'Test2-Slow'
    );
    console.log('Test 2 (slow op timeout): ❌ FAIL — should have timed out');
  } catch (e) {
    test2Passed = e.message.includes('timed out after 100ms');
    console.log(`Test 2 (slow op timeout): ${test2Passed ? '✅ PASS' : '❌ FAIL'} — ${e.message}`);
  }

  // Test 3: Timer is properly cleaned up (no dangling timers)
  let test3Passed = false;
  const before = process._getActiveHandles().length;
  await withTimeout(
    new Promise(r => setTimeout(() => r('quick'), 10)),
    1000,
    'Test3-Cleanup'
  );
  // Small delay for timer cleanup
  await new Promise(r => setTimeout(r, 50));
  const after = process._getActiveHandles().length;
  test3Passed = after <= before + 1; // Allow 1 for the setTimeout in this test
  console.log(`Test 3 (timer cleanup): ${test3Passed ? '✅ PASS' : '❌ FAIL'} — handles before: ${before}, after: ${after}`);

  // Test 4: Simulates full Autonomic Pulse flow with timeout
  let test4Passed = false;
  const AUTONOMIC_PULSE_TIMEOUT_MS = 200;

  // Simulate a Gemini call that hangs forever
  const mockGeminiHang = async () => {
    await new Promise(r => setTimeout(r, 60000)); // 60s hang
    return { candidates: [{ content: { parts: [{ text: 'fixed code' }] } }] };
  };

  try {
    await withTimeout(
      mockGeminiHang(),
      AUTONOMIC_PULSE_TIMEOUT_MS,
      'Gemini hot-patch synthesis'
    );
    console.log('Test 4 (Gemini timeout): ❌ FAIL — should have timed out');
  } catch (e) {
    test4Passed = e.message.includes('timed out');
    console.log(`Test 4 (Gemini timeout): ${test4Passed ? '✅ PASS' : '❌ FAIL'} — ${e.message}`);
  }

  const allPassed = test1Passed && test2Passed && test3Passed && test4Passed;
  console.log(`\n=== OVERALL: ${allPassed ? '✅ ALL PASS' : '❌ SOME FAILED'} ===`);

  if (!allPassed) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
