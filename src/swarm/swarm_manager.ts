/**
 * Jules swarm dispatch manager.
 * Ported from dispatch_swarm.ps1, deploy_swarms.ps1, generate_225_swarms.ps1.
 *
 * Dispatches N Jules agents with rotating strategy prompts using
 * `jules remote new` as child processes.
 */


import * as fs from 'node:fs';
import * as path from 'node:path';
import { SwarmDispatchOptions, DEFAULT_STRATEGIES } from './types.js';
import { LocalStore, SessionState } from '../persistence/local_store.js';
import * as crypto from 'node:crypto';
import type { MultiAgentToolContext } from '../momoa_core/types.js';
import { executeTool } from '../tools/multiAgentToolRegistry.js';

export class SwarmManager {
  private store: LocalStore;
  private context: MultiAgentToolContext;

  constructor(store: LocalStore, context: MultiAgentToolContext) {
    this.store = store;
    this.context = context;
  }

  /**
   * Dispatch N jules agents with rotating strategies.
   * Returns the list of dispatched session descriptions (jules CLI doesn't return IDs synchronously).
   */
  async dispatch(opts: SwarmDispatchOptions): Promise<string[]> {
    const strategies = opts.strategies ?? DEFAULT_STRATEGIES;
    const agentsPerStrategy = Math.ceil(opts.count / strategies.length);
    const dispatched: string[] = [];

    this.log(`=== SWARM DISPATCH ===`);
    this.log(`Total agents: ${opts.count}`);
    this.log(`Strategies: ${strategies.length}`);
    this.log(`Agents per strategy: ${agentsPerStrategy}`);
    this.log(`Repo: ${opts.repo}`);
    this.log(`Branch: ${opts.branch}`);

    // If a prompt directory is provided, read prompt files from it
    if (opts.promptDir && fs.existsSync(opts.promptDir)) {
      return this.dispatchFromPromptDir(opts);
    }

    // Otherwise, generate prompts from strategies
    let agentIndex = 0;
    for (const strategy of strategies) {
      const count = Math.min(agentsPerStrategy, opts.count - agentIndex);
      if (count <= 0) break;

      for (let i = 0; i < count; i++) {
        agentIndex++;
        const prompt = this.buildStrategyPrompt(strategy, opts.targetDir, agentIndex);

        try {
          this.log(`[${agentIndex}/${opts.count}] Dispatching: ${strategy} agent#${i + 1}`);
          const stdout = await this.spawnJulesWorker(prompt, opts.repo, opts.branch);
          const sessionId = this.parseSessionId(stdout, `${strategy}-${i + 1}`);
          
          this.store.saveSession(sessionId, {
            id: sessionId,
            state: 'AWAITING_REVIEW', // Optimistically waiting tracking
            strategy: strategy,
            agentNumber: i + 1,
            pulled: false,
            approved: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          dispatched.push(sessionId);
          this.log(`  -> [OK] Dispatched successfully (Session ID: ${sessionId})`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.log(`  -> [FAIL] ${errorMsg}`);
        }

        // Small delay between dispatches to avoid API throttling
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    this.log(`\n=== SWARM DISPATCHED ===`);
    this.log(`Total dispatched: ${dispatched.length}/${opts.count}`);

    return dispatched;
  }

  /**
   * Dispatch from a directory of prompt files (like dispatch_swarm.ps1).
   * Each .md file in the directory becomes one prompt, dispatched with N parallel agents.
   */
  private async dispatchFromPromptDir(opts: SwarmDispatchOptions): Promise<string[]> {
    const promptDir = opts.promptDir!;
    const prompts = fs.readdirSync(promptDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => ({
        name: path.basename(f, '.md'),
        content: fs.readFileSync(path.join(promptDir, f), 'utf-8'),
      }));

    const dispatched: string[] = [];
    const agentsPerPrompt = Math.ceil(opts.count / Math.max(1, prompts.length));

    for (const promptFile of prompts) {
      this.log(`=== Dispatching: ${promptFile.name} ===`);
      this.log(`  Parallel: ${agentsPerPrompt} agents`);

      for (let i = 0; i < agentsPerPrompt; i++) {
        try {
          const stdout = await this.spawnJulesWorker(promptFile.content, opts.repo, opts.branch);
          const sessionId = this.parseSessionId(stdout, `prompt-${promptFile.name}-${i + 1}`);
          
          this.store.saveSession(sessionId, {
            id: sessionId,
            state: 'AWAITING_REVIEW',
            strategy: promptFile.name,
            agentNumber: i + 1,
            pulled: false,
            approved: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          dispatched.push(sessionId);
          this.log(`  [OK] agent#${i + 1} dispatched (Session ID: ${sessionId})`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.log(`  [FAIL] agent#${i + 1}: ${errorMsg}`);
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    return dispatched;
  }

  /**
   * Helper to parse Jules session ID from STDOUT, with fallback to crypto.randomUUID
   */
  private parseSessionId(stdout: string, fallbackPrefix: string): string {
    const match = stdout.match(/ID:\s*(\d+)/i);
    if (match && match[1]) {
      return match[1];
    }
    // Fallback if stdout formatting changes or local mock
    return `${fallbackPrefix}-${crypto.randomUUID().substring(0, 8)}`;
  }

  /**
   * Build a strategy-specific prompt for a Jules agent.
   */
  private buildStrategyPrompt(strategy: string, targetDir: string, agentIndex: number): string {
    return `[Swarm Strategy: ${strategy} | Agent #${agentIndex}]

You are working on the codebase at: ${targetDir}

Your assigned strategy is: ${strategy}

Follow the CODEBASE_MAP.md explicitly. Focus exclusively on your assigned strategy area.
Do NOT make changes outside the scope of your strategy.
Ensure all changes compile and pass basic validation.

Strategy-specific instructions will be injected from the prompt directory if available.`;
  }

  /**
   * Spawn a single jules worker using JULES_CREATE_SESSION native tool execution.
   */
  private async spawnJulesWorker(prompt: string, repo: string, branch?: string): Promise<string> {
    try {
      const response = await executeTool('JULES_CREATE_SESSION', {
        prompt,
        sourceId: repo,
        branch: branch || "main",
        requirePlanApproval: false,
      }, this.context);

      return response.result;
    } catch (err: any) {
      throw new Error(`Failed to create Jules session via MCP tool: ${err.message}`);
    }
  }

  /**
   * Generate a batch of swarm task prompts to a TODO.md file.
   * Ported from generate_225_swarms.ps1.
   */
  generateBatchPrompts(outputPath: string, groups: Array<{ name: string; count: number; basePrompt: string }>): number {
    let taskIndex = 0;
    const lines: string[] = [];

    for (const group of groups) {
      for (let i = 1; i <= group.count; i++) {
        const taskDesc = `[Swarm Group ${group.name} Variant ${i}]: ${group.basePrompt} Ensure you follow the CODEBASE_MAP.md explicitly.`;
        lines.push(taskDesc);
        taskIndex++;
      }
    }

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    this.log(`Generated ${taskIndex} swarm task prompts to ${outputPath}`);
    return taskIndex;
  }

  /**
   * Run an Intelligence Loop experiment by dynamically spawning multiple variant agents.
   */
  public async runIntelligenceLoopExperiment(
    taskId: string, 
    basePrompt: string, 
    variantPrompts: { id: string, prompt: string }[], 
    repo: string,
    baseBranch: string = "main" 
  ): Promise<{ sessionIds: string[], branches: string[] }> {
    this.log(`Initiating Intelligence Loop experiment for task: ${taskId}`);
    const variantBranches: string[] = [];
    const sessionIds: string[] = [];

    for (const variant of variantPrompts) {
        const branchName = `il-variant/${taskId}-${variant.id}-${crypto.randomUUID().substring(0, 4)}`;
        this.log(`Spawning Jules worker for variant '${variant.id}' on branch: ${branchName}`);

        try {
            const response = await executeTool('JULES_CREATE_SESSION', {
                prompt: `[IL-Variant: ${variant.id}]\n${basePrompt}\n\n${variant.prompt}`,
                sourceId: repo,
                branch: branchName, 
                requirePlanApproval: false
            }, this.context);

            const sessionId = this.parseSessionId(response.result, `il-var-${variant.id}`);
            
            this.store.saveSession(sessionId, {
              id: sessionId,
              state: 'AWAITING_REVIEW',
              strategy: `IL-Variant-${variant.id}`,
              agentNumber: 1,
              pulled: false,
              approved: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });

            sessionIds.push(sessionId);
            variantBranches.push(branchName);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.log(`  -> [FAIL] Variant ${variant.id}: ${errorMsg}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return { sessionIds, branches: variantBranches }; 
  }

  private log(msg: string): void {
    console.log(msg);
    this.store.appendLog('swarm_dispatch.log', msg);
  }
}
