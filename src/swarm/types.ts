/**
 * Type definitions for the Jules swarm management system.
 */

export interface SessionStatus {
  id: string;
  state: 'COMPLETED' | 'IN_PROGRESS' | 'AWAITING_PLAN_APPROVAL' | 'FAILED' | 'API_ERROR' | string;
  strategy: string;
  agentNumber: number;
  title?: string;
  index: number;
}

export interface SwarmConfig {
  repo: string;
  branch: string;
  strategies: string[];
  agentsPerStrategy: number;
  pollIntervalMs: number;
  maxPolls: number;
  repoRoot: string;
  logDir: string;
  promptDir?: string;
}

export const DEFAULT_STRATEGIES = [
  '01_alignment_fix',
  '02_blend_mode_fix',
  '03_bg_color_override',
  '04_linker_section_cleanup',
  '05_combined_conservative',
  '06_combined_aggressive',
  '07_alignment_section_approach',
  '08_qe_config_override',
  '09_combined_qe_plus_code',
  '10_diagnostic_telemetry',
];

export interface SwarmDispatchOptions {
  count: number;
  targetDir: string;
  repo: string;
  branch: string;
  promptDir?: string;
  strategies?: string[];
}

export interface PollResult {
  sessions: SessionStatus[];
  completed: number;
  inProgress: number;
  awaiting: number;
  failed: number;
}
