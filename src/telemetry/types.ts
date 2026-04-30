import { z } from 'zod';

/**
 * Glass Swarm Telemetry Types — OpenTelemetry-inspired tracing model
 *
 * Provides trace/span data structures for observing every tool call,
 * MCP interaction, retry loop, and human wait in the swarm.
 */

/** Span classification */
export enum SpanKind {
  ORCHESTRATOR = 'ORCHESTRATOR',
  TOOL = 'TOOL',
  MCP_CALL = 'MCP_CALL',
  SELF_HEAL = 'SELF_HEAL',
  MERGE = 'MERGE',
  HITL_WAIT = 'HITL_WAIT',
  HIVE_MIND = 'HIVE_MIND',
  REGISTRY = 'REGISTRY',
  WORK_PHASE = 'WORK_PHASE',
}

/** Span completion status */
export enum SpanStatus {
  OK = 'OK',
  ERROR = 'ERROR',
  TIMEOUT = 'TIMEOUT',
  CANCELLED = 'CANCELLED',
  PENDING = 'PENDING',
}

/** Propagated trace context for cross-service correlation */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/** A single span representing one unit of work */
export interface Span {
  /** Trace this span belongs to */
  traceId: string;
  /** Unique span identifier */
  spanId: string;
  /** Parent span (undefined for root spans) */
  parentSpanId?: string;
  /** Human-readable span name */
  name: string;
  /** Classification of this span */
  kind: SpanKind;
  /** Start time (epoch ms) */
  startTimeMs: number;
  /** End time (epoch ms), 0 if still running */
  endTimeMs: number;
  /** Completion status */
  status: SpanStatus;
  /** Arbitrary key-value attributes */
  attributes: Record<string, string | number | boolean>;
  /** Estimated tokens sent in this span's primary operation */
  tokensSent: number;
  /** Estimated tokens received */
  tokensReceived: number;
  /** Child span IDs for hierarchical querying */
  children: string[];
}

/** Aggregated exhaustion metrics for a trace or agent */
export interface ExhaustionMetric {
  traceId: string;
  totalTokensSent: number;
  totalTokensReceived: number;
  totalRetries: number;
  totalSpans: number;
  durationMs: number;
  errorCount: number;
  hitlWaitMs: number;
}

/** Telemetry configuration */
export interface TelemetryConfig {
  /** Where to persist trace data (default: .swarm/telemetry/) */
  storageDir: string;
  /** Max trace file size before rotation (default: 5MB) */
  maxFileSizeBytes: number;
  /** Token exhaustion threshold per trace before forced termination */
  exhaustionThreshold: number;
  /** Whether telemetry is enabled */
  enabled: boolean;
}

/** Default telemetry configuration */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  storageDir: '.swarm/telemetry',
  maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  exhaustionThreshold: 500_000, // ~500k tokens before alarm
  enabled: true,
};

export const SpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  kind: z.nativeEnum(SpanKind),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  status: z.nativeEnum(SpanStatus),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  tokensSent: z.number(),
  tokensReceived: z.number(),
  children: z.array(z.string()),
});

export const TelemetryConfigSchema = z.object({
  storageDir: z.string(),
  maxFileSizeBytes: z.number(),
  exhaustionThreshold: z.number(),
  enabled: z.boolean(),
});
