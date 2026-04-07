import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import { evolvePrompt } from '../../services/promptManager.js';

export const promptEvolutionTool: MultiAgentTool = {
  name: 'TOOL/EVOLVE{',
  displayName: 'Prompt Evolution',
  endToken: '}',
  execute: async (params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> => {
    const promptId = params.promptId as string;
    const newMarkdownContent = params.newMarkdownContent as string;

    if (!promptId || typeof promptId !== 'string') {
      return { result: `Error: promptId is required and must be a string.` };
    }
    if (!newMarkdownContent || typeof newMarkdownContent !== 'string') {
      return { result: `Error: newMarkdownContent is required and must be a string.` };
    }

    try {
      await evolvePrompt(promptId, newMarkdownContent);
      return { result: `SUCCESS: System prompt '${promptId}' has been successfully evolved, saved to disk, and hot-loaded into active memory.` };
    } catch (error: any) {
      return { result: `FAILURE: Could not evolve prompt '${promptId}'. Reason: ${error.message}` };
    }
  },
  extractParameters: async (invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> => {
    // Basic comma parsing or JSON parse based on standard formats.
    // Given the complexity of newMarkdownContent (which contains newlines and markdown),
    // we should ideally use a robust parser. For this example, we expect the LLM to provide
    // standard parameters. If the invocation is JSON:
    try {
      const parsed = JSON.parse(invocation.trim().replace(/\}$/, ''));
      return { success: true, params: parsed };
    } catch {
      // Fallback pseudo-parser for LLM error handling
      return { success: false, error: 'Invalid JSON parameters for TOOL/EVOLVE{. Please supply valid JSON with "promptId" and "newMarkdownContent".' };
    }
  }
};
