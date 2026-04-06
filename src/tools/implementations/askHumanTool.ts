/**
 * ASK_HUMAN Tool — Non-blocking human escalation via HITL Manager.
 *
 * This tool creates a pending HITL request and returns IMMEDIATELY
 * with the request ID. External clients can respond via RESPOND_TO_HUMAN
 * tool, and agents can poll HITL_STATUS to check for answers.
 *
 * The agent does NOT block waiting for a human response.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { HitlManager } from '../../hitl/hitlManager.js';
import { HitlUrgency } from '../../hitl/types.js';

export const askHumanTool: MultiAgentTool = {
  displayName: 'Ask Human',
  name: 'ASK_HUMAN',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const question = (params.question as string) || '';
    const contextText = (params.context as string) || '';
    const urgency = (params.urgency as string) || 'medium';
    const traceId = (params.traceId as string) || undefined;

    if (!question) {
      return { result: 'Error: "question" parameter is required.' };
    }

    const urgencyLevel: HitlUrgency = {
      low: HitlUrgency.LOW,
      medium: HitlUrgency.MEDIUM,
      high: HitlUrgency.HIGH,
      critical: HitlUrgency.CRITICAL,
    }[urgency] || HitlUrgency.MEDIUM;

    try {
      const hitlManager = HitlManager.getInstance();

      // NON-BLOCKING: Create the request and return the ID immediately.
      // The response will be available via HITL_STATUS or RESPOND_TO_HUMAN.
      const fullQuestion = contextText
        ? `${question}\n\n--- Context ---\n${contextText}`
        : question;

      const requestId = hitlManager.createRequest(
        fullQuestion,
        'MoMo Overseer Agent',
        urgencyLevel,
        traceId
      );

      return {
        result: `# HITL Request Created\n\n**Request ID:** ${requestId}\n**Question:** ${question.substring(0, 200)}\n**Urgency:** ${urgency}\n**Status:** PENDING\n\nUse \`RESPOND_TO_HUMAN\` with this request ID to provide an answer, or check \`HITL_STATUS\` to monitor all pending requests.`,
      };
    } catch (err: any) {
      return {
        result: `HITL request creation failed: ${err.message}`,
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
      return { success: true, params: { question: invocation.trim() } };
    }
  },
};
