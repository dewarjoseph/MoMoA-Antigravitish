/**
 * Jules swarm dispatch manager.
 * Ported from dispatch_swarm.ps1, deploy_swarms.ps1, generate_225_swarms.ps1.
 *
 * Dispatches N Jules agents with rotating strategy prompts using
 * `jules remote new` as child processes.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SwarmDispatchOptions, DEFAULT_STRATEGIES } from './types.js';
import { LocalStore } from '../persistence/local_store.js';

export class SwarmManager {
  private store: LocalStore;

  constructor(store: LocalStore) {
    this.store = store;
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
          await this.spawnJulesWorker(prompt, opts.repo, opts.branch);
          dispatched.push(`${strategy}/agent${i + 1}`);
          this.log(`  -> [OK] Dispatched successfully`);
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
          await this.spawnJulesWorker(promptFile.content, opts.repo, opts.branch);
          dispatched.push(`${promptFile.name}/agent${i + 1}`);
          this.log(`  [OK] agent#${i + 1} dispatched`);
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
   * Spawn a single jules worker as a child process using `jules remote new`.
   */
  private spawnJulesWorker(prompt: string, repo: string, branch?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['remote', 'new', '--repo', repo];
      if (branch) {
        args.push('--branch', branch);
      }
      args.push('--session', prompt);

      const proc = spawn('jules', args, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code: number | null) => {
        if (code === 0 || code === null) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`jules remote new exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn jules: ${err.message}`));
      });

      // Timeout after 30 seconds for dispatch
      setTimeout(() => {
        proc.kill();
        reject(new Error('jules remote new timed out after 30s'));
      }, 30_000);
    });
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

  private log(msg: string): void {
    console.log(msg);
    this.store.appendLog('swarm_dispatch.log', msg);
  }
}
