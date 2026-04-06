/**
 * RESPOND_TO_HUMAN Tool — Provides a human response to a pending HITL request.
 *
 * External MCP clients call this tool with a request ID and answer
 * to resolve a pending ASK_HUMAN request.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { HitlManager } from '../../hitl/hitlManager.js';

export const respondToHumanTool: MultiAgentTool = {
  displayName: 'Respond To Human Request',
  name: 'RESPOND_TO_HUMAN',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const requestId = (params.requestId as string) || '';
    const answer = (params.answer as string) || '';

    if (!requestId) {
      return { result: 'Error: "requestId" parameter is required. Get the ID from HITL_STATUS or ASK_HUMAN output.' };
    }

    if (!answer) {
      return { result: 'Error: "answer" parameter is required.' };
    }

    try {
      const hitlManager = HitlManager.getInstance();

      // Check if the request exists
      const pendingList = hitlManager.listPending();
      const request = pendingList.find(r => r.id === requestId);

      if (!request) {
        const history = hitlManager.getHistory();
        const alreadyAnswered = history.find(h => h.requestId === requestId);
        if (alreadyAnswered) {
          return {
            result: `Request ${requestId} was already answered at ${alreadyAnswered.respondedAt}.`,
          };
        }
        return {
          result: `No pending request found with ID: ${requestId}. It may have expired. Use HITL_STATUS to see current pending requests.`,
        };
      }

      const success = hitlManager.respondToRequest(requestId, answer);

      if (success) {
        return {
          result: `# HITL Response Delivered\n\n**Request ID:** ${requestId}\n**Original Question:** ${request.question.substring(0, 200)}\n**Answer:** ${answer.substring(0, 500)}\n**Status:** ANSWERED\n**Remaining Pending:** ${hitlManager.getPendingCount()}`,
        };
      } else {
        return {
          result: `Failed to deliver response for request ${requestId}. The request may have expired.`,
        };
      }
    } catch (err: any) {
      return {
        result: `Error responding to HITL request: ${err.message}`,
      };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    try {
      return { success: true, params: JSON.parse(invocation.trim()) };
    } catch {
      return { success: true, params: { requestId: invocation.trim(), answer: '' } };
    }
  },
};
