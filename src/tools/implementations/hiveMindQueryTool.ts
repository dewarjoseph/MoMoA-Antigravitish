/**
 * QUERY_HIVE_MIND Tool — Semantic search across persistent swarm memory.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { HiveMind } from '../../memory/hiveMind.js';

export const hiveMindQueryTool: MultiAgentTool = {
  displayName: 'Hive Mind Query',
  name: 'QUERY_HIVE_MIND',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const query = (params.query as string) || '';
    const topK = (params.topK as number) || 5;
    const tags = (params.tags as string[]) || undefined;

    if (!query) {
      return { result: 'Error: "query" parameter is required.' };
    }

    try {
      const hiveMind = HiveMind.getInstance();
      const results = await hiveMind.query(query, topK, tags);

      if (results.length === 0) {
        return { result: 'No relevant memories found in the Hive Mind.' };
      }

      const formatted = results.map((r, i) => {
        const t = r.triplet;
        return `### Memory #${i + 1} (Similarity: ${(r.similarity * 100).toFixed(1)}%, Confidence: ${(t.confidence * 100).toFixed(0)}%)
**Context:** ${t.context.substring(0, 300)}
**Action:** ${t.action.substring(0, 300)}
**Outcome:** ${t.outcome.substring(0, 300)}
**Tags:** ${t.tags.join(', ') || 'none'}
**Gold Standard:** ${t.isGoldStandard ? '⭐ Yes' : 'No'}
**Hit Count:** ${t.hitCount}`;
      });

      const stats = hiveMind.getStats();

      return {
        result: `# Hive Mind Query Results\n\n**Query:** "${query.substring(0, 100)}"\n**Results:** ${results.length} of ${stats.total} total memories\n\n${formatted.join('\n\n---\n\n')}`,
      };
    } catch (err: any) {
      return { result: `Hive Mind query failed: ${err.message}` };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    try {
      return { success: true, params: JSON.parse(invocation.trim()) };
    } catch {
      return { success: true, params: { query: invocation.trim() } };
    }
  },
};
