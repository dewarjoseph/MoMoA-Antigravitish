/**
 * HITL (Human-in-the-Loop) Types — Async MCP Endpoint
 *
 * Defines request/response structures for non-blocking human escalation.
 * When an agent needs human input, it parks its promise and the swarm continues.
 */

/** Urgency level for HITL requests */
export enum HitlUrgency {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** A pending human input request */
export interface HitlRequest {
  /** Unique request identifier */
  id: string;
  /** The question or issue requiring human input */
  question: string;
  /** Additional context (error logs, trace links, etc.) */
  context: string;
  /** Which agent/tool originated this request */
  agentContext: string;
  /** How urgent is this request */
  urgency: HitlUrgency;
  /** Associated trace ID for telemetry correlation */
  traceId?: string;
  /** When the request was created */
  createdAt: string;
  /** Current state of the request */
  state: 'PENDING' | 'ANSWERED' | 'EXPIRED' | 'CANCELLED';
}

/** A human response to an HITL request */
export interface HitlResponse {
  /** Which request this answers */
  requestId: string;
  /** The human's answer */
  answer: string;
  /** When the response was provided */
  respondedAt: string;
}

/** Escalation policy configuration */
export interface HitlPolicy {
  /** Max auto-retries before escalating to human (default: 3) */
  maxAutoRetries: number;
  /** Whether to include full stack traces in notifications */
  includeStackTraces: boolean;
  /** Notification channels to use */
  notificationChannels: ('stderr' | 'file' | 'webhook')[];
  /** Optional webhook URL for external notifications */
  webhookUrl?: string;
  /** Timeout for human response before marking as expired (ms, default: 30 min) */
  responseTimeoutMs: number;
}

/** Default HITL policy */
export const DEFAULT_HITL_POLICY: HitlPolicy = {
  maxAutoRetries: 3,
  includeStackTraces: true,
  notificationChannels: ['stderr', 'file'],
  responseTimeoutMs: 30 * 60 * 1000, // 30 minutes
};

/** HITL Manager configuration */
export interface HitlConfig {
  /** Directory for pending request files (default: .swarm/hitl/) */
  storageDir: string;
  /** Escalation policy */
  policy: HitlPolicy;
}

/** Default HITL configuration */
export const DEFAULT_HITL_CONFIG: HitlConfig = {
  storageDir: '.swarm/hitl',
  policy: DEFAULT_HITL_POLICY,
};
