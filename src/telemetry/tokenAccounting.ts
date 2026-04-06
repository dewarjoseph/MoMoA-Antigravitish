/**
 * Token Accounting — Payload measurement for Glass Swarm telemetry.
 *
 * Provides lightweight token estimation from JSON payload sizes
 * and records metrics on Span objects for cost tracking.
 */

import type { Span } from './types.js';

// Rough token estimation: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from a JSON payload or string.
 * Uses the ~4 chars/token heuristic for English text.
 */
export function measurePayload(payload: unknown): number {
  let charCount: number;

  if (typeof payload === 'string') {
    charCount = payload.length;
  } else {
    try {
      charCount = JSON.stringify(payload).length;
    } catch {
      charCount = 0;
    }
  }

  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/**
 * Record request/response token metrics on a span.
 */
export function recordCallMetrics(
  span: Span,
  request: unknown,
  response: unknown
): void {
  const sent = measurePayload(request);
  const received = measurePayload(response);
  span.tokensSent += sent;
  span.tokensReceived += received;
}

/**
 * Format token metrics as a readable summary.
 */
export function formatTokenSummary(
  sent: number,
  received: number
): string {
  const total = sent + received;
  return `${total} tokens (${sent}→ sent, ${received}← received)`;
}
