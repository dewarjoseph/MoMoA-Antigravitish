/**
 * Markdown status report generator for Jules swarm operations.
 * Ported from swarm_overseer.ps1 Write-StatusReport function.
 */

import { SessionStatus, DEFAULT_STRATEGIES } from './types.js';

export interface ReportContext {
  sessions: SessionStatus[];
  pollNumber: number;
  maxPolls: number;
  pulledSessions: Set<string>;
  strategies?: string[];
}

export function generateStatusReport(ctx: ReportContext): string {
  const strategies = ctx.strategies ?? DEFAULT_STRATEGIES;
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  const completed = ctx.sessions.filter(s => s.state === 'COMPLETED').length;
  const inProgress = ctx.sessions.filter(s => s.state === 'IN_PROGRESS').length;
  const awaiting = ctx.sessions.filter(s => s.state === 'AWAITING_PLAN_APPROVAL').length;
  const failed = ctx.sessions.filter(s => s.state === 'FAILED' || s.state === 'API_ERROR').length;
  const pulledCount = ctx.pulledSessions.size;
  const totalSessions = ctx.sessions.length;

  let report = `# Jules Swarm Status Report\n`;
  report += `**Updated:** ${now}\n`;
  report += `**Poll #:** ${ctx.pollNumber} / ${ctx.maxPolls}\n\n`;
  report += `## Summary\n`;
  report += `| Status | Count |\n`;
  report += `|--------|-------|\n`;
  report += `| COMPLETED | ${completed} / ${totalSessions} |\n`;
  report += `| IN_PROGRESS | ${inProgress} |\n`;
  report += `| AWAITING_APPROVAL | ${awaiting} |\n`;
  report += `| FAILED/ERROR | ${failed} |\n`;
  report += `| Pulled | ${pulledCount} |\n\n`;
  report += `## Per-Strategy Status\n\n`;

  for (const strategyName of strategies) {
    const strategySessions = ctx.sessions.filter(s => s.strategy === strategyName);
    if (strategySessions.length === 0) continue;

    const stratCompleted = strategySessions.filter(s => s.state === 'COMPLETED').length;
    const totalForStrategy = strategySessions.length;

    let statusEmoji: string;
    if (stratCompleted === totalForStrategy) {
      statusEmoji = '✅';
    } else if (stratCompleted > 0) {
      statusEmoji = '🔶';
    } else {
      statusEmoji = '⏳';
    }

    report += `### ${statusEmoji} ${strategyName} (${stratCompleted}/${totalForStrategy} completed)\n`;

    for (const agent of strategySessions) {
      const stateIcon = getStateIcon(agent.state);
      const isPulled = ctx.pulledSessions.has(agent.id) ? ' **[PULLED]**' : '';
      report += `- ${stateIcon} Agent #${agent.agentNumber} (\`${agent.id}\`)${isPulled}\n`;
    }
    report += '\n';
  }

  return report;
}

function getStateIcon(state: string): string {
  switch (state) {
    case 'COMPLETED': return '✅';
    case 'IN_PROGRESS': return '🔄';
    case 'AWAITING_PLAN_APPROVAL': return '⏸️';
    case 'FAILED': return '❌';
    case 'API_ERROR': return '⚠️';
    default: return '❓';
  }
}
