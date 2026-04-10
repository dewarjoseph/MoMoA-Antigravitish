/**
 * HitlManager — Non-blocking Human-in-the-Loop request management.
 *
 * When an agent needs human input, it calls `requestHuman()` which:
 * 1. Creates a pending request
 * 2. Sends notifications (stderr + file)
 * 3. Parks the calling agent's Promise
 * 4. Returns when a human calls `respondToRequest()`
 *
 * Unlike the old blocking HITL, this allows the rest of the swarm
 * to continue working while waiting for human input.
 */

import * as crypto from 'node:crypto';
import {
  HitlRequest,
  HitlResponse,
  HitlConfig,
  HitlUrgency,
  DEFAULT_HITL_CONFIG,
} from './types.js';
import { notifyStderr, notifyFile, removeFromFile, notifyWebhook } from './notifier.js';

interface PendingPromise {
  resolve: (answer: string) => void;
  reject: (reason: Error) => void;
  request: HitlRequest;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export class HitlManager {
  private static instance: HitlManager | null = null;
  private config: HitlConfig;
  private pending: Map<string, PendingPromise> = new Map();
  private history: HitlResponse[] = [];

  private constructor(config?: Partial<HitlConfig>) {
    this.config = {
      storageDir: config?.storageDir ?? DEFAULT_HITL_CONFIG.storageDir,
      policy: { ...DEFAULT_HITL_CONFIG.policy, ...config?.policy },
    };
  }

  /** Get or create singleton */
  static getInstance(config?: Partial<HitlConfig>): HitlManager {
    if (!HitlManager.instance) {
      HitlManager.instance = new HitlManager(config);
    }
    return HitlManager.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    if (HitlManager.instance) {
      // Cancel all pending requests
      for (const [_id, pending] of HitlManager.instance.pending) {
        clearTimeout(pending.timeoutHandle);
        pending.reject(new Error('HitlManager reset'));
      }
      HitlManager.instance.pending.clear();
    }
    HitlManager.instance = null;
  }

  // ─── Request Human Input ────────────────────────────────────────────────

  /**
   * Request human input. This parks the calling agent's Promise
   * until a human responds or the timeout expires.
   *
   * @param question - What to ask the human
   * @param agentContext - Which agent/tool is asking
   * @param urgency - How urgent the request is
   * @param traceId - Optional trace ID for telemetry correlation
   * @returns The human's response text
   */
  requestHuman(
    question: string,
    agentContext: string,
    urgency: HitlUrgency = HitlUrgency.MEDIUM,
    traceId?: string
  ): Promise<string> {
    const request: HitlRequest = {
      id: crypto.randomUUID(),
      question,
      context: '',
      agentContext,
      urgency,
      traceId,
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    return new Promise<string>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        const pending = this.pending.get(request.id);
        if (pending) {
          pending.request.state = 'EXPIRED';
          this.pending.delete(request.id);
          removeFromFile(request.id, this.config.storageDir);
          reject(new Error(`HITL request ${request.id} expired after ${this.config.policy.responseTimeoutMs}ms`));
        }
      }, this.config.policy.responseTimeoutMs);

      // Park the promise
      this.pending.set(request.id, {
        resolve,
        reject,
        request,
        timeoutHandle,
      });

      // Send notifications
      this.dispatchNotifications(request);

      process.stderr.write(
        `[HITL] Request ${request.id} parked. ${this.pending.size} pending request(s). Swarm continues...\n`
      );
    });
  }

  /**
   * Create a non-blocking HITL request.
   * Sends notifications and returns the request ID immediately.
   * The answer can be provided later via respondToRequest().
   */
  createRequest(
    question: string,
    agentContext: string,
    urgency: HitlUrgency = HitlUrgency.MEDIUM,
    traceId?: string
  ): string {
    const request: HitlRequest = {
      id: crypto.randomUUID(),
      question,
      context: '',
      agentContext,
      urgency,
      traceId,
      createdAt: new Date().toISOString(),
      state: 'PENDING',
    };

    // Set up timeout (auto-expire after policy timeout)
    const timeoutHandle = setTimeout(() => {
      const pending = this.pending.get(request.id);
      if (pending) {
        pending.request.state = 'EXPIRED';
        this.pending.delete(request.id);
        removeFromFile(request.id, this.config.storageDir);
        process.stderr.write(
          `[HITL] Non-blocking request ${request.id} expired after ${this.config.policy.responseTimeoutMs}ms\n`
        );
      }
    }, this.config.policy.responseTimeoutMs);

    // Park with a no-op resolver (the answer is stored in history when respondToRequest is called)
    this.pending.set(request.id, {
      resolve: () => {},
      reject: () => {},
      request,
      timeoutHandle,
    });

    // Send notifications
    this.dispatchNotifications(request);

    process.stderr.write(
      `[HITL] Non-blocking request ${request.id} created. ${this.pending.size} pending request(s).\n`
    );

    return request.id;
  }

  /**
   * Request human input with additional context (error logs, etc.)
   */
  requestHumanWithContext(
    question: string,
    context: string,
    agentContext: string,
    urgency: HitlUrgency = HitlUrgency.HIGH,
    traceId?: string
  ): Promise<string> {
    const fullQuestion = context
      ? `${question}\n\n--- Context ---\n${context}`
      : question;
    return this.requestHuman(fullQuestion, agentContext, urgency, traceId);
  }

  // ─── Respond to Requests ────────────────────────────────────────────────

  /**
   * Provide a human response to a pending request.
   * Resolves the parked Promise, allowing the agent to continue.
   */
  respondToRequest(requestId: string, answer: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      process.stderr.write(`[HITL] No pending request found for ID: ${requestId}\n`);
      return false;
    }

    // Clear timeout
    clearTimeout(pending.timeoutHandle);

    // Update state
    pending.request.state = 'ANSWERED';

    // Record in history
    this.history.push({
      requestId,
      answer,
      respondedAt: new Date().toISOString(),
    });

    // Remove from pending
    this.pending.delete(requestId);
    removeFromFile(requestId, this.config.storageDir);

    // Resolve the promise — the agent wakes up
    pending.resolve(answer);

    process.stderr.write(
      `[HITL] Request ${requestId} answered. ${this.pending.size} pending request(s) remaining.\n`
    );

    return true;
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  /** List all pending requests */
  listPending(): HitlRequest[] {
    return [...this.pending.values()].map(p => p.request);
  }

  /** Get the number of pending requests */
  getPendingCount(): number {
    return this.pending.size;
  }

  /** Get response history */
  getHistory(): HitlResponse[] {
    return [...this.history];
  }

  /** Cancel a specific pending request */
  cancelRequest(requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeoutHandle);
    pending.request.state = 'CANCELLED';
    this.pending.delete(requestId);
    removeFromFile(requestId, this.config.storageDir);
    pending.reject(new Error('HITL request cancelled'));

    return true;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private dispatchNotifications(request: HitlRequest): void {
    const channels = this.config.policy.notificationChannels;

    if (channels.includes('stderr')) {
      notifyStderr(request);
    }

    if (channels.includes('file')) {
      notifyFile(request, this.config.storageDir);
    }

    if (channels.includes('webhook') && this.config.policy.webhookUrl) {
      // Fire-and-forget async webhook
      notifyWebhook(this.config.policy.webhookUrl, request).catch(() => {});
    }
  }
}
