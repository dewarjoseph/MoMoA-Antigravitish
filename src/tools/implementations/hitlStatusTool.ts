/**
 * HITL_STATUS Tool — List pending human input requests.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { HitlManager } from '../../hitl/hitlManager.js';

export const hitlStatusTool: MultiAgentTool = {
  displayName: 'HITL Status',
  name: 'HITL_STATUS',

  async execute(
    _params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    try {
      const hitlManager = HitlManager.getInstance();
      const pending = hitlManager.listPending();
      const history = hitlManager.getHistory();

      if (pending.length === 0 && history.length === 0) {
        return { result: 'No pending or historical HITL requests.' };
      }

      let output = `# HITL Status\n\n## Pending Requests (${pending.length})\n\n`;

      if (pending.length === 0) {
        output += '_No pending requests._\n\n';
      } else {
        for (const req of pending) {
          const age = Date.now() - new Date(req.createdAt).getTime();
          const ageMin = Math.round(age / 60000);
          output += `### ${req.urgency.toUpperCase()} — Request ${req.id.substring(0, 8)}\n`;
          output += `- **Question:** ${req.question.substring(0, 200)}\n`;
          output += `- **Agent:** ${req.agentContext}\n`;
          output += `- **Waiting:** ${ageMin} minutes\n`;
          if (req.traceId) output += `- **Trace:** ${req.traceId.substring(0, 16)}\n`;
          output += '\n';
        }
      }

      output += `## Response History (${history.length})\n\n`;
      for (const resp of history.slice(-5)) {
        output += `- **${resp.requestId.substring(0, 8)}:** "${resp.answer.substring(0, 100)}" (${resp.respondedAt})\n`;
      }

      return { result: output };
    } catch (err: any) {
      return { result: `HITL status query failed: ${err.message}` };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    return { success: true, params: {} };
  },
};
