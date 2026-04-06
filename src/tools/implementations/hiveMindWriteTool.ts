/**
 * WRITE_HIVE_MIND Tool — Store a Context-Action-Outcome triplet in persistent memory.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { HiveMind } from '../../memory/hiveMind.js';

export const hiveMindWriteTool: MultiAgentTool = {
  displayName: 'Hive Mind Write',
  name: 'WRITE_HIVE_MIND',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const context = (params.context as string) || '';
    const action = (params.action as string) || '';
    const outcome = (params.outcome as string) || '';
    const tags = (params.tags as string[]) || [];
    const isGoldStandard = (params.isGoldStandard as boolean) || false;

    if (!context || !action || !outcome) {
      return {
        result: 'Error: "context", "action", and "outcome" parameters are all required.',
      };
    }

    try {
      const hiveMind = HiveMind.getInstance();

      const id = isGoldStandard
        ? await hiveMind.writeGoldStandard(context, action, outcome, tags)
        : await hiveMind.write(context, action, outcome, { tags });

      const stats = hiveMind.getStats();

      return {
        result: `# Memory Stored Successfully\n\n**ID:** ${id}\n**Type:** ${isGoldStandard ? '⭐ Gold Standard' : 'Standard'}\n**Tags:** ${tags.join(', ') || 'none'}\n**Total Memories:** ${stats.total} (${stats.goldStandard} gold standard)\n**Average Confidence:** ${(stats.avgConfidence * 100).toFixed(1)}%`,
      };
    } catch (err: any) {
      return { result: `Hive Mind write failed: ${err.message}` };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    try {
      return { success: true, params: JSON.parse(invocation.trim()) };
    } catch {
      return { success: true, params: { context: invocation.trim(), action: 'unknown', outcome: 'unknown' } };
    }
  },
};
