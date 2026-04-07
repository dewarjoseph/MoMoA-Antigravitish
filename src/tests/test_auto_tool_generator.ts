import { generateAndLoadTool, getTool } from '../tools/multiAgentToolRegistry.js';
import { SwarmTracer } from '../telemetry/tracer.js';

async function runTest() {
  SwarmTracer.getInstance().emitLog("Loading bold generated tool...");
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
    SwarmTracer.getInstance().emitLog("Tool created dynamically: " + newTool.displayName);
    const registered = getTool('TOOL/MATH{');
    if (!registered) throw new Error("Not in registry!");
    
    // Simulate execution
    const res = await registered.execute({ expression: 'test' }, {} as any);
    SwarmTracer.getInstance().emitLog("Execution Result:", res.result);
    SwarmTracer.getInstance().emitLog("Test: PASS");
  } catch(e) {
    SwarmTracer.getInstance().emitLog("Test: FAIL", e);
  }
}

runTest();
