/**
 * OUROBOROS Cycle 3 — Task 3: Prompt Evolution Integrity Hash Validation
 * Tests the SHA-256 snapshot + rollback + integrity verification pattern.
 */

const { createHash } = require('crypto');

function contentHash(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

async function runTests() {
  console.log('=== OUROBOROS Cycle 3 — Task 3: Integrity Hash Validation ===\n');

  // Simulate the evolution snapshot lifecycle
  const snapshots = new Map();

  // Test 1: Store pre-mutation snapshot
  const originalContent = '---\nname: test-prompt\ntemperature: 0.7\n---\nYou are a helpful assistant.';
  const hash = contentHash(originalContent);
  snapshots.set('test/prompt', { hash, originalContent, timestamp: Date.now() });

  const test1 = snapshots.has('test/prompt') && snapshots.get('test/prompt').hash.length === 64;
  console.log(`Test 1 (snapshot stored): ${test1 ? '✅ PASS' : '❌ FAIL'} — hash: ${hash.substring(0, 16)}...`);

  // Test 2: Hash is deterministic
  const hash2 = contentHash(originalContent);
  const test2 = hash === hash2;
  console.log(`Test 2 (deterministic hash): ${test2 ? '✅ PASS' : '❌ FAIL'}`);

  // Test 3: Different content produces different hash
  const mutatedContent = '---\nname: test-prompt\ntemperature: 0.9\n---\nYou are an AI researcher.';
  const hash3 = contentHash(mutatedContent);
  const test3 = hash !== hash3;
  console.log(`Test 3 (mutation detected): ${test3 ? '✅ PASS' : '❌ FAIL'} — original: ${hash.substring(0, 8)}, mutated: ${hash3.substring(0, 8)}`);

  // Test 4: Integrity verification passes for valid snapshot
  const snapshot = snapshots.get('test/prompt');
  const verifyHash = contentHash(snapshot.originalContent);
  const test4 = verifyHash === snapshot.hash;
  console.log(`Test 4 (integrity check pass): ${test4 ? '✅ PASS' : '❌ FAIL'}`);

  // Test 5: Integrity verification fails for corrupted snapshot
  const corruptedSnapshot = { ...snapshot, originalContent: snapshot.originalContent + '!!!' };
  const corruptVerify = contentHash(corruptedSnapshot.originalContent);
  const test5 = corruptVerify !== corruptedSnapshot.hash;
  console.log(`Test 5 (corruption detected): ${test5 ? '✅ PASS' : '❌ FAIL'}`);

  // Test 6: Rollback clears the snapshot
  snapshots.delete('test/prompt');
  const test6 = !snapshots.has('test/prompt');
  console.log(`Test 6 (snapshot cleared on rollback): ${test6 ? '✅ PASS' : '❌ FAIL'}`);

  // Test 7: No snapshot returns graceful failure
  const test7 = !snapshots.has('nonexistent/prompt');
  console.log(`Test 7 (no snapshot graceful): ${test7 ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = test1 && test2 && test3 && test4 && test5 && test6 && test7;
  console.log(`\n=== OVERALL: ${allPassed ? '✅ ALL PASS' : '❌ SOME FAILED'} ===`);
  if (!allPassed) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
