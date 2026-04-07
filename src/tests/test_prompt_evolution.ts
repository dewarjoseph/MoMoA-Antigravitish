import { promptEvolutionTool } from '../tools/implementations/promptEvolutionTool.js';
import { _internal, getAssetString } from '../services/promptManager.js';
import { SwarmTracer } from '../telemetry/tracer.js';

async function runTest() {
  SwarmTracer.getInstance().emitLog('Testing Prompt Evolution...');

  // 1. Initial State
  const initialValue = await getAssetString('underscore');
  SwarmTracer.getInstance().emitLog('Initial strings/underscore value:', initialValue.trim());

  // 2. Draft the modified markdown
  const newMarkdown = `---
name: underscore
description: Single underscore. Modified for test.
---
_EVOLVED_
`;

  // 3. Evolve the prompt
  SwarmTracer.getInstance().emitLog('Executing TOOL/EVOLVE{ ...');
  const result = await promptEvolutionTool.execute({
    promptId: 'strings/underscore',
    newMarkdownContent: newMarkdown
  }, {} as any);

  SwarmTracer.getInstance().emitLog('Tool Result:', result);

  // 4. Verify in-memory mutation
  const evolvedValue = await getAssetString('underscore');
  SwarmTracer.getInstance().emitLog('Evolved strings/underscore value:', evolvedValue.trim());

  if (evolvedValue.trim() !== '_EVOLVED_') {
    throw new Error('Evolution failed! Memory was not updated.');
  }

  // 5. Restore back to original
  const restoreMarkdown = `---
name: underscore
description: Single underscore.
---
_
`;
  SwarmTracer.getInstance().emitLog('Restoring to original...');
  await promptEvolutionTool.execute({
    promptId: 'strings/underscore',
    newMarkdownContent: restoreMarkdown
  }, {} as any);
  
  const restoredValue = await getAssetString('underscore');
  if (restoredValue.trim() !== '_') {
      throw new Error('Restoration failed.');
  }

  SwarmTracer.getInstance().emitLog('Test Passed: Intelligence Loop mutation & cascade functional.');
}

runTest().catch(err => {
  SwarmTracer.getInstance().emitLog('Test failed:', err);
  process.exit(1);
});
