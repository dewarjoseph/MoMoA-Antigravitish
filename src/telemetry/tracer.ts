/**
 * SwarmTracer — Lightweight OpenTelemetry-inspired tracing for Glass Swarm.
 *
 * Provides trace/span management without requiring the full OTel SDK.
 * Every master task gets a parent trace_id; every sub-task, MCP call,
 * and retry loop gets a child span_id.
 *
 * Persists traces to .swarm/telemetry/traces.json for post-mortem analysis.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  Span,
  SpanKind,
  SpanStatus,
  TraceContext,
  ExhaustionMetric,
  TelemetryConfig,
  DEFAULT_TELEMETRY_CONFIG,
  SpanSchema, // Import the new schema
  TelemetryConfigSchema, // Import the new schema
} from './types.js';
import { LocalStoreManager } from '../persistence/localStoreManager.js'; // Import LocalStoreManager

export class SwarmTracer {
    private static instance: SwarmTracer | null = null;
  private config: TelemetryConfig;
  private spans: Map<string, Span> = new Map();
  private traces: Map<string, Set<string>> = new Map(); // traceId -> spanIds
  private dirty = false;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private localStore: LocalStoreManager; // Add LocalStoreManager instance

  private constructor(config?: Partial<TelemetryConfig>) {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    this.localStore = new LocalStoreManager(this.config.storageDir); // Instantiate LocalStoreManager

    if (this.config.enabled) {
      // this.ensureStorageDir(); // Removed, LocalStoreManager handles this
      this.loadTraces();

      // OUROBOROS Cycle 2: Time-based flush to prevent data loss on crash
      // The count-based trigger (every 50 spans) is insufficient for low-traffic scenarios
      this.flushInterval = setInterval(() => {
        if (this.dirty) {
          this.persistTraces();
        }
      }, 60_000); // Flush every 60 seconds if dirty
      // unref() so the timer doesn't prevent Node.js from exiting naturally
      this.flushInterval.unref();
    }
  }

  /** Get or create singleton */
  static getInstance(config?: Partial<TelemetryConfig>): SwarmTracer {
    if (!SwarmTracer.instance) {
      SwarmTracer.instance = new SwarmTracer(config);
    }
    return SwarmTracer.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    SwarmTracer.instance = null;
  }

  // ─── Trace/Span Creation ────────────────────────────────────────────────

  /**
   * Start a new root trace.
   * Returns the TraceContext to propagate to child operations.
   */
  startTrace(name: string, attributes?: Record<string, string | number | boolean>): TraceContext {
    const traceId = crypto.randomUUID().replace(/-/g, '');
    const spanId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);

    const rootSpan: Span = {
      traceId,
      spanId,
      name,
      kind: SpanKind.ORCHESTRATOR,
      startTimeMs: Date.now(),
      endTimeMs: 0,
      status: SpanStatus.PENDING,
      attributes: attributes || {},
      tokensSent: 0,
      tokensReceived: 0,
      children: [],
    };

    this.spans.set(spanId, rootSpan);
    this.traces.set(traceId, new Set([spanId]));

    if (this.config.enabled) {
      process.stderr.write(
        `[Telemetry] Trace started: ${traceId.substring(0, 8)}... | ${name}\n`
      );
    }

    return { traceId, spanId };
  }

  /**
   * Start a child span under an existing parent.
   */
  startSpan(
    parent: TraceContext,
    name: string,
    kind: SpanKind,
    attributes?: Record<string, string | number | boolean>
  ): Span {
    const spanId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);

    const span: Span = {
      traceId: parent.traceId,
      spanId,
      parentSpanId: parent.spanId,
      name,
      kind,
      startTimeMs: Date.now(),
      endTimeMs: 0,
      status: SpanStatus.PENDING,
      attributes: attributes || {},
      tokensSent: 0,
      tokensReceived: 0,
      children: [],
    };

    this.spans.set(spanId, span);

    // Register in trace index
    let traceSpans = this.traces.get(parent.traceId);
    if (!traceSpans) {
      traceSpans = new Set();
      this.traces.set(parent.traceId, traceSpans);
    }
    traceSpans.add(spanId);

    // Register as child of parent span
    const parentSpan = this.spans.get(parent.spanId);
    if (parentSpan) {
      parentSpan.children.push(spanId);
    }

    return span;
  }

  /**
   * End a span, recording its final status and timing.
   */
  endSpan(
    span: Span,
    status: SpanStatus = SpanStatus.OK,
    attributes?: Record<string, string | number | boolean>
  ): void {
    span.endTimeMs = Date.now();
    span.status = status;

    if (attributes) {
      Object.assign(span.attributes, attributes);
    }

    this.dirty = true;

    // Auto-persist periodically
    if (this.spans.size % 50 === 0) {
      this.persistTraces();
    }
  }

  /**
   * Record token metrics on a span.
   */
  recordTokens(span: Span, sent: number, received: number): void {
    span.tokensSent += sent;
    span.tokensReceived += received;
  }

  /**
   * Log a general message through the telemetry pipeline (bypassing stdout).
   * Ensures MCP protocol compatibility by routing to stderr.
   */
  emitLog(...args: any[]): void {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
    process.stderr.write(`${message}\n`);
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  /**
   * Get all spans for a given trace.
   */
  getTrace(traceId: string): Span[] {
    const spanIds = this.traces.get(traceId);
    if (!spanIds) return [];

    return [...spanIds]
      .map(id => this.spans.get(id))
      .filter((s): s is Span => s !== undefined)
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
  }

  /**
   * Get the exhaustion metric for a trace.
   * Used to detect token burn and force-terminate runaway agents.
   */
  getExhaustionMetric(traceId: string): ExhaustionMetric {
    const spans = this.getTrace(traceId);

    let totalTokensSent = 0;
    let totalTokensReceived = 0;
    let totalRetries = 0;
    let errorCount = 0;
    let hitlWaitMs = 0;
    let minStart = Infinity;
    let maxEnd = 0;

    for (const span of spans) {
      totalTokensSent += span.tokensSent;
      totalTokensReceived += span.tokensReceived;
      if (span.kind === SpanKind.SELF_HEAL) totalRetries++;
      if (span.status === SpanStatus.ERROR) errorCount++;
      if (span.kind === SpanKind.HITL_WAIT && span.endTimeMs > 0) {
        hitlWaitMs += span.endTimeMs - span.startTimeMs;
      }
      minStart = Math.min(minStart, span.startTimeMs);
      if (span.endTimeMs > 0) maxEnd = Math.max(maxEnd, span.endTimeMs);
    }

    return {
      traceId,
      totalTokensSent,
      totalTokensReceived,
      totalRetries,
      totalSpans: spans.length,
      durationMs: maxEnd > minStart ? maxEnd - minStart : 0,
      errorCount,
      hitlWaitMs,
    };
  }

  /**
   * Check if a trace has exceeded the exhaustion threshold.
   */
  isExhausted(traceId: string): boolean {
    const metric = this.getExhaustionMetric(traceId);
    return (metric.totalTokensSent + metric.totalTokensReceived) > this.config.exhaustionThreshold;
  }

  /**
   * Get recent traces for dashboard display.
   */
  getRecentTraces(count: number = 10): Array<{ traceId: string; rootSpan: Span | undefined; spanCount: number }> {
    const traceEntries = [...this.traces.entries()];

    return traceEntries
      .map(([traceId, spanIds]) => {
        const allSpans = [...spanIds]
          .map(id => this.spans.get(id))
          .filter((s): s is Span => s !== undefined);
        const rootSpan = allSpans.find(s => !s.parentSpanId);
        return { traceId, rootSpan, spanCount: spanIds.size };
      })
      .sort((a, b) => {
        const aTime = a.rootSpan?.startTimeMs ?? 0;
        const bTime = b.rootSpan?.startTimeMs ?? 0;
        return bTime - aTime;
      })
      .slice(0, count);
  }

  /**
   * Format a trace as a Gantt-style text diagram.
   */
  formatTraceGantt(traceId: string): string {
    const spans = this.getTrace(traceId);
    if (spans.length === 0) return 'No spans found for this trace.';

    const _minStart = Math.min(...spans.map(s => s.startTimeMs));
    const lines: string[] = [`Trace: ${traceId.substring(0, 16)}...`, ''];

    for (const span of spans) {
      const depth = this.getSpanDepth(span);
      const indent = '  '.repeat(depth);
      const durationMs = span.endTimeMs > 0 ? span.endTimeMs - span.startTimeMs : Date.now() - span.startTimeMs;
      const statusIcon = span.status === SpanStatus.OK ? '✅'
        : span.status === SpanStatus.ERROR ? '❌'
        : span.status === SpanStatus.PENDING ? '⏳'
        : '⚠️';

      const tokens = (span.tokensSent + span.tokensReceived) > 0
        ? ` [${span.tokensSent}→/${span.tokensReceived}←]`
        : '';

      lines.push(
        `${indent}${statusIcon} ${span.kind.padEnd(12)} | ${span.name.substring(0, 40).padEnd(40)} | ${durationMs}ms${tokens}`
      );
    }

    const metric = this.getExhaustionMetric(traceId);
    lines.push('');
    lines.push(`--- Summary: ${metric.totalSpans} spans, ${metric.totalTokensSent + metric.totalTokensReceived} tokens, ${metric.totalRetries} retries, ${metric.errorCount} errors, ${metric.durationMs}ms total ---`);

    return lines.join('\n');
  }

  private getSpanDepth(span: Span): number {
    let depth = 0;
    let current = span;
    while (current.parentSpanId) {
      const parent = this.spans.get(current.parentSpanId);
      if (!parent) break;
      current = parent;
      depth++;
    }
    return depth;
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  private getTraceFilePath(): string {
    return path.join(this.config.storageDir, 'traces.json');
  }

  private loadTraces(): void {
    const filePath = this.getTraceFilePath();
    try {
      const data = this.localStore.readState<{ spans: Span[] }>(filePath, undefined, SpanSchema); // Use LocalStoreManager and SpanSchema object
      if (data && data.spans) {
        for (const span of data.spans) {
          this.spans.set(span.spanId, span);
          let traceSpans = this.traces.get(span.traceId);
          if (!traceSpans) {
            traceSpans = new Set();
            this.traces.set(span.traceId, traceSpans);
          }
          traceSpans.add(span.spanId);
        }
        process.stderr.write(
          `[Telemetry] Loaded ${this.spans.size} spans across ${this.traces.size} traces.\n`
        );
      }
    } catch (err) {
      process.stderr.write(`[Telemetry] Failed to load traces: ${err}\n`);
    }
  }

  private persistTraces(): void {
    if (!this.dirty || !this.config.enabled) return;

    try {
      const allSpans = [...this.spans.values()];
      const data = JSON.stringify({ spans: allSpans }, null, 2);

      // Rotate if too large
      if (data.length > this.config.maxFileSizeBytes) {
        const archivePath = path.join(
          this.config.storageDir,
          `traces_${Date.now()}.archive.json`
        );
        // Keep only recent spans
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
        const oldSpans = allSpans.filter(s => s.startTimeMs < cutoff);
        this.localStore.writeState(archivePath, { spans: oldSpans }, undefined, SpanSchema); // Use LocalStoreManager and SpanSchema object

        // Remove old spans from memory
        for (const span of oldSpans) {
          this.spans.delete(span.spanId);
          const traceSpans = this.traces.get(span.traceId);
          if (traceSpans) {
            traceSpans.delete(span.spanId);
            if (traceSpans.size === 0) this.traces.delete(span.traceId);
          }
        }
      }

      this.localStore.writeState(this.getTraceFilePath(), { spans: [...this.spans.values()] }, undefined, SpanSchema); // Use LocalStoreManager and SpanSchema object
      this.dirty = false;
    } catch (err) {
      process.stderr.write(`[Telemetry] Failed to persist traces: ${err}\n`);
    }
  }

  /** Force flush traces to disk */
  flush(): void {
    this.dirty = true;
    this.persistTraces();
  }

  /**
   * OUROBOROS Cycle 2: Clean shutdown — flush pending traces and stop the interval timer.
   * Call this during graceful process exit to ensure no data loss.
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Final flush to persist any remaining dirty traces
    if (this.dirty) {
      this.persistTraces();
    }
    process.stderr.write('[Telemetry] SwarmTracer shut down cleanly.\n');
  }
}
