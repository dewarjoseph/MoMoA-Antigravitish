/**
 * Jules session poller — monitors swarm sessions via Jules REST API and CLI.
 * Ported from swarm_overseer.ps1 main loop, approve_stalled.ps1, triage_225.ps1.
 *
 * Supports two modes:
 * - REST API polling (using JULES_API_KEY)
 * - CLI-based polling (using `jules remote list/approve/pull`)
 */

import { spawn } from 'node:child_process';
import { SessionStatus, PollResult, DEFAULT_STRATEGIES } from './types.js';
import { generateStatusReport } from './report_writer.js';
import { LocalStore } from '../persistence/local_store.js';
import { GeminiClient } from '../services/geminiClient.js';
import { MergeSupervisor } from './merge_supervisor.js';

const API_BASE = 'https://jules.googleapis.com/v1alpha';

export class SessionPoller {
  private sessionIds: string[];
  private strategies: string[];
  private apiKey: string;
  private pollIntervalMs: number;
  private maxPolls: number;
  private store: LocalStore;
  private geminiClient?: GeminiClient;
  private mergeSupervisor?: MergeSupervisor;
  private pulledSessions: Set<string> = new Set();
  private approvedSessions: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor(opts: {
    sessionIds: string[];
    strategies?: string[];
    apiKey?: string;
    pollIntervalMs?: number;
    maxPolls?: number;
    store: LocalStore;
    geminiClient?: GeminiClient;
  }) {
    this.sessionIds = opts.sessionIds;
    this.strategies = opts.strategies ?? DEFAULT_STRATEGIES;
    this.apiKey = opts.apiKey ?? process.env.JULES_API_KEY ?? '';
    this.pollIntervalMs = opts.pollIntervalMs ?? 120_000; // 2 minutes
    this.maxPolls = opts.maxPolls ?? 120; // ~4 hours
    this.store = opts.store;
    this.geminiClient = opts.geminiClient;
    if (this.geminiClient) {
      this.mergeSupervisor = new MergeSupervisor(this.geminiClient, {} as any);
    }
  }

  private log(msg: string): void {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const line = `[${timestamp}] ${msg}`;
    console.log(line);
    this.store.appendLog('overseer.log', msg);
  }

  private getStrategyName(index: number): string {
    const strategyIndex = Math.floor(index / Math.max(1, Math.ceil(this.sessionIds.length / this.strategies.length)));
    return this.strategies[Math.min(strategyIndex, this.strategies.length - 1)];
  }

  private getAgentNumber(index: number): number {
    const agentsPerStrategy = Math.max(1, Math.ceil(this.sessionIds.length / this.strategies.length));
    return (index % agentsPerStrategy) + 1;
  }

  /**
   * Poll all sessions via the Jules REST API.
   */
  async poll(): Promise<PollResult> {
    const sessions: SessionStatus[] = [];

    for (let i = 0; i < this.sessionIds.length; i++) {
      const id = this.sessionIds[i];
      const strategy = this.getStrategyName(i);
      const agentNum = this.getAgentNumber(i);

      try {
        if (this.apiKey) {
          // REST API mode
          const response = await fetch(`${API_BASE}/sessions/${id}`, {
            headers: { 'X-Goog-Api-Key': this.apiKey },
            signal: AbortSignal.timeout(15_000),
          });
          const session = await response.json() as any;
          sessions.push({
            index: i,
            id,
            state: session.state ?? 'UNKNOWN',
            strategy,
            agentNumber: agentNum,
            title: session.title,
          });
        } else {
          // Fallback: CLI mode (slower but doesn't require API key)
          sessions.push({
            index: i,
            id,
            state: 'UNKNOWN', // CLI list will be parsed separately
            strategy,
            agentNumber: agentNum,
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sessions.push({
          index: i,
          id,
          state: 'API_ERROR',
          strategy,
          agentNumber: agentNum,
          title: `Error: ${errorMsg.substring(0, 100)}`,
        });
      }
    }

    const completed = sessions.filter(s => s.state === 'COMPLETED').length;
    const inProgress = sessions.filter(s => s.state === 'IN_PROGRESS').length;
    const awaiting = sessions.filter(s => s.state === 'AWAITING_PLAN_APPROVAL').length;
    const failed = sessions.filter(s => s.state === 'FAILED' || s.state === 'API_ERROR').length;

    return { sessions, completed, inProgress, awaiting, failed };
  }

  /**
   * Auto-approve sessions waiting for plan approval.
   * Ported from approve_stalled.ps1 and swarm_overseer.ps1 Approve-WaitingSessions.
   */
  async approveWaiting(sessions: SessionStatus[]): Promise<number> {
    let approved = 0;
    const waiting = sessions.filter(
      s => s.state === 'AWAITING_PLAN_APPROVAL' && !this.approvedSessions.has(s.id)
    );

    for (const s of waiting) {
      try {
        if (this.apiKey) {
          await fetch(`${API_BASE}/sessions/${s.id}:approvePlan`, {
            method: 'POST',
            headers: {
              'X-Goog-Api-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
            body: '{}',
            signal: AbortSignal.timeout(15_000),
          });
        } else {
          // CLI fallback
          await this.runJulesCli(['remote', 'approve', s.id]);
        }

        this.log(`[APPROVE] ${s.strategy} agent#${s.agentNumber} (${s.id})`);
        this.approvedSessions.add(s.id);
        approved++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.log(`[APPROVE-FAIL] ${s.id}: ${errorMsg}`);
      }
    }

    return approved;
  }

  /**
   * Pull diffs from completed sessions.
   * Ported from swarm_overseer.ps1 Pull-CompletedSessions.
   */
  async pullCompleted(sessions: SessionStatus[], repoRoot: string): Promise<number> {
    let pulled = 0;
    const completed = sessions.filter(
      s => s.state === 'COMPLETED' && !this.pulledSessions.has(s.id)
    );

    for (const s of completed) {
      const branchName = `jules/${s.strategy}/agent${s.agentNumber}`;

      try {
        this.log(`[PULL] Pulling ${s.strategy} agent#${s.agentNumber} -> branch ${branchName}`);

        const output = await this.runJulesCli(['remote', 'pull', s.id], repoRoot);

        // Save pull output to log
        const { writeFileSync } = await import('node:fs');
        writeFileSync(
          this.store.getLogPath(`pull_${s.id}.txt`),
          output,
          'utf-8'
        );

        if (output.includes('No changes') || output.includes('error') || output.includes('Error')) {
          this.log(`[PULL-WARN] ${s.id}: ${output.substring(0, 100)}`);
        } else {
          this.log(`[PULL-OK] ${s.strategy} agent#${s.agentNumber} pulled successfully`);
          
          if (this.mergeSupervisor) {
             this.log(`[MERGE-EVAL] Triggering Gemini merge supervision for ${branchName}...`);
             const evalResult = await this.mergeSupervisor.evaluateAndMerge(branchName, s.id, repoRoot, s.title ?? s.id);
             if (evalResult.approved) {
                 this.log(`[MERGE-OK] Auto-merged ${branchName}`);
             } else {
                 this.log(`[MERGE-REJECTED] Agent work was not approved: ${evalResult.reasoning}`);
             }
          }
        }

        this.pulledSessions.add(s.id);
        pulled++;

        // Update session state in local store
        this.store.saveSession(s.id, {
          id: s.id,
          state: s.state,
          strategy: s.strategy,
          agentNumber: s.agentNumber,
          title: s.title,
          pulled: true,
          approved: this.approvedSessions.has(s.id),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.log(`[PULL-FAIL] ${s.id}: ${errorMsg}`);
      }
    }

    return pulled;
  }

  /**
   * Start the polling daemon loop.
   * Ported from swarm_overseer.ps1 main loop.
   */
  async startPolling(repoRoot: string): Promise<void> {
    this.isRunning = true;

    this.log('=========================================');
    this.log('JULES SWARM OVERSEER STARTING');
    this.log(`Sessions: ${this.sessionIds.length}`);
    this.log(`Poll interval: ${this.pollIntervalMs / 1000}s`);
    this.log(`Max polls: ${this.maxPolls} (~${(this.maxPolls * this.pollIntervalMs / 3600000).toFixed(1)} hours)`);
    this.log('=========================================');

    for (let poll = 1; poll <= this.maxPolls && this.isRunning; poll++) {
      this.log(`--- Poll #${poll} ---`);

      // 1. Poll all sessions
      const result = await this.poll();
      this.log(`Status: ${result.completed} completed, ${result.inProgress} in-progress, ${result.awaiting} awaiting, ${result.failed} failed`);

      // 2. Auto-approve any waiting plans
      if (result.awaiting > 0) {
        const numApproved = await this.approveWaiting(result.sessions);
        this.log(`Auto-approved ${numApproved} plans`);
      }

      // 3. Pull completed sessions that haven't been pulled yet
      const newCompleted = result.sessions.filter(
        s => s.state === 'COMPLETED' && !this.pulledSessions.has(s.id)
      ).length;
      if (newCompleted > 0) {
        this.log(`Pulling ${newCompleted} newly completed sessions...`);
        const numPulled = await this.pullCompleted(result.sessions, repoRoot);
        this.log(`Pulled ${numPulled} sessions`);
      }

      // 4. Write status report
      const report = generateStatusReport({
        sessions: result.sessions,
        pollNumber: poll,
        maxPolls: this.maxPolls,
        pulledSessions: this.pulledSessions,
        strategies: this.strategies,
      });
      this.store.writeStatusReport(report);

      // 5. Check if all done
      if (result.completed + result.failed >= this.sessionIds.length) {
        this.log('ALL SESSIONS COMPLETE!');
        this.log(`Total: ${result.completed} completed, ${result.failed} failed`);
        this.log(`Pulled: ${this.pulledSessions.size} session diffs`);
        break;
      }

      // 6. Sleep until next poll
      if (poll < this.maxPolls && this.isRunning) {
        this.log(`Sleeping ${this.pollIntervalMs / 1000}s until next poll...`);
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
    }

    this.log('=========================================');
    this.log('OVERSEER COMPLETE');
    this.log(`Final status at: ${this.store.getStatusReportPath()}`);
    this.log(`Pull logs at: ${this.store.getLogsDir()}`);
    this.log('=========================================');
  }

  /**
   * Stop the polling daemon.
   */
  stop(): void {
    this.isRunning = false;
    this.log('Overseer stop requested.');
  }

  /**
   * Get the set of pulled session IDs.
   */
  getPulledSessions(): Set<string> {
    return this.pulledSessions;
  }

  /**
   * Run a jules CLI command and return stdout.
   */
  private runJulesCli(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('jules', args, {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code: number | null) => {
        if (code === 0 || code === null) {
          resolve(stdout + stderr);
        } else {
          reject(new Error(`jules ${args.join(' ')} exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn jules: ${err.message}`));
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error(`jules ${args.join(' ')} timed out after 60s`));
      }, 60_000);
    });
  }
}
