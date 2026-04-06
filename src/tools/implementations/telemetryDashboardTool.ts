/**
 * TELEMETRY_DASHBOARD Tool — View trace data and span hierarchies.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { SwarmTracer } from '../../telemetry/tracer.js';

export const telemetryDashboardTool: MultiAgentTool = {
  displayName: 'Telemetry Dashboard',
  name: 'TELEMETRY_DASHBOARD',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const traceId = (params.traceId as string) || '';
    const last = (params.last as number) || 10;

    try {
      const tracer = SwarmTracer.getInstance();

      if (traceId) {
        // Detailed view of a specific trace
        const gantt = tracer.formatTraceGantt(traceId);
        const metric = tracer.getExhaustionMetric(traceId);

        let output = `# Trace Detail: ${traceId.substring(0, 16)}...\n\n`;
        output += '```\n' + gantt + '\n```\n\n';
        output += `## Exhaustion Metrics\n`;
        output += `- **Total Tokens:** ${metric.totalTokensSent + metric.totalTokensReceived}\n`;
        output += `- **Retries:** ${metric.totalRetries}\n`;
        output += `- **Errors:** ${metric.errorCount}\n`;
        output += `- **Duration:** ${metric.durationMs}ms\n`;
        output += `- **HITL Wait:** ${metric.hitlWaitMs}ms\n`;
        output += `- **Exhausted:** ${tracer.isExhausted(traceId) ? '🔴 YES' : '🟢 No'}\n`;

        return { result: output };
      }

      // Overview of recent traces
      const recent = tracer.getRecentTraces(last);

      if (recent.length === 0) {
        return { result: 'No traces recorded yet.' };
      }

      let output = `# Telemetry Dashboard\n\n**Recent Traces (${recent.length})**\n\n`;
      output += '| Trace ID | Name | Spans | Status | Started |\n';
      output += '|----------|------|-------|--------|---------|\n';

      for (const { traceId: tid, rootSpan, spanCount } of recent) {
        const name = rootSpan?.name || 'Unknown';
        const status = rootSpan?.status || 'UNKNOWN';
        const started = rootSpan
          ? new Date(rootSpan.startTimeMs).toISOString().split('T')[1].split('.')[0]
          : 'N/A';
        output += `| ${tid.substring(0, 12)}... | ${name.substring(0, 30)} | ${spanCount} | ${status} | ${started} |\n`;
      }

      return { result: output };
    } catch (err: any) {
      return { result: `Telemetry dashboard error: ${err.message}` };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    try {
      return { success: true, params: JSON.parse(invocation.trim()) };
    } catch {
      return { success: true, params: {} };
    }
  },
};
