/**
 * HITL Notifier — Notification dispatch for human escalation requests.
 *
 * Supports multiple notification channels:
 * - stderr: Always available, writes formatted alerts
 * - file: Writes to .swarm/hitl/pending_requests.json for external polling
 * - webhook: Optional HTTP POST to Slack/Discord/custom (future-ready)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HitlRequest } from './types.js';

/**
 * Send a formatted HITL notification to stderr.
 */
export function notifyStderr(request: HitlRequest): void {
  const urgencyEmoji = {
    low: '📋',
    medium: '⚠️',
    high: '🚨',
    critical: '🔴',
  }[request.urgency] || '📋';

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    `║  ${urgencyEmoji} HUMAN INPUT REQUIRED ${urgencyEmoji}`.padEnd(63) + '║',
    '╠══════════════════════════════════════════════════════════════╣',
    `║  Request ID: ${request.id.substring(0, 36)}`.padEnd(63) + '║',
    `║  Urgency:    ${request.urgency.toUpperCase()}`.padEnd(63) + '║',
    `║  Agent:      ${request.agentContext.substring(0, 40)}`.padEnd(63) + '║',
    '╠══════════════════════════════════════════════════════════════╣',
    `║  Question:`.padEnd(63) + '║',
  ];

  // Word-wrap the question
  const words = request.question.split(/\s+/);
  let currentLine = '║    ';
  for (const word of words) {
    if (currentLine.length + word.length + 1 > 60) {
      lines.push(currentLine.padEnd(63) + '║');
      currentLine = '║    ';
    }
    currentLine += word + ' ';
  }
  if (currentLine.trim() !== '║') {
    lines.push(currentLine.padEnd(63) + '║');
  }

  if (request.traceId) {
    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push(`║  Trace: ${request.traceId.substring(0, 48)}`.padEnd(63) + '║');
  }

  lines.push('╠══════════════════════════════════════════════════════════════╣');
  lines.push('║  Respond via: RESPOND_TO_HUMAN tool or pending queue file   ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');

  process.stderr.write(lines.join('\n') + '\n');
}

/**
 * Write the pending request to the HITL queue file for external polling.
 */
export function notifyFile(request: HitlRequest, storageDir: string): void {
  const queuePath = path.join(storageDir, 'pending_requests.json');

  let existing: HitlRequest[] = [];
  try {
    if (fs.existsSync(queuePath)) {
      existing = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    }
  } catch {
    existing = [];
  }

  // Replace if same ID exists, otherwise append
  const idx = existing.findIndex(r => r.id === request.id);
  if (idx >= 0) {
    existing[idx] = request;
  } else {
    existing.push(request);
  }

  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify(existing, null, 2), 'utf-8');
}

/**
 * Remove a resolved/cancelled request from the pending file.
 */
export function removeFromFile(requestId: string, storageDir: string): void {
  const queuePath = path.join(storageDir, 'pending_requests.json');

  try {
    if (!fs.existsSync(queuePath)) return;
    const existing: HitlRequest[] = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    const filtered = existing.filter(r => r.id !== requestId);
    fs.writeFileSync(queuePath, JSON.stringify(filtered, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}

/**
 * Send an HTTP POST webhook notification (future-ready).
 */
export async function notifyWebhook(
  url: string,
  request: HitlRequest
): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'hitl_request',
        request,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    process.stderr.write(`[HITL-Notify] Webhook sent to ${url}\n`);
  } catch (err) {
    process.stderr.write(`[HITL-Notify] Webhook failed: ${err}\n`);
  }
}
