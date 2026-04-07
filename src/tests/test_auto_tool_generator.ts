import { generateAndLoadTool, getTool } from '../tools/multiAgentToolRegistry.js';

async function runTest() {
  console.log("Loading bold generated tool...");
  const tsCode = `
export const mathTool = {
  name: 'TOOL/MATH{',
  displayName: 'Math Calculator',
  endToken: '}',
  execute: async (params, context) => {
    return { result: 'Calculated: 42' };
  },
  extractParameters: async (invocation, context) => {
    return { success: true, params: { expression: '7*6' } };
  }
};
export default mathTool;
  `;

  try {
    const newTool = await generateAndLoadTool(tsCode);
    console.log("Tool created dynamically: " + newTool.displayName);
    const registered = getTool('TOOL/MATH{');
    if (!registered) throw new Error("Not in registry!");
    
    // Simulate execution
    const res = await registered.execute({ expression: 'test' }, {} as any);
    console.log("Execution Result:", res.result);
    console.log("Test: PASS");
  } catch(e) {
    console.error("Test: FAIL", e);
  }
}

runTest();
