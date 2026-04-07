import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, ToolParsingResult } from '../../momoa_core/types.js';
import { generateAndLoadTool } from '../multiAgentToolRegistry.js';

export const autoToolGeneratorTool: MultiAgentTool = {
  name: 'TOOL/GEN{',
  displayName: 'Auto Tool Generator',
  endToken: '}',
  execute: async (params: Record<string, unknown>, _context: MultiAgentToolContext): Promise<{ result: string }> => {
    const tsCode = params.tsCode as string;
    if (!tsCode) {
      throw new Error(`Parameter 'tsCode' is required.`);
    }

    try {
      const generatedTool = await generateAndLoadTool(tsCode);
      return { result: `Success! Dynamically compiled and registered tool: '${generatedTool.name}'.` };
    } catch (error) {
      let errorMessage = 'Unknown error occurred.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return { result: `Failed to compile and register dynamic tool. Error: ${errorMessage}` };
    }
  },
  extractParameters: async (invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> => {
    if (invocation.trim().endsWith("}")) {
      const tsCode = invocation.trim().slice(0, -1).trim();
      return {
        success: true, 
        params: { tsCode }
      };
    } else {
      return {
        success: false, 
        error: `Invalid syntax for the Auto Tool Generator. Make sure you include the curly brackets.`
      };
    }
  }
};
