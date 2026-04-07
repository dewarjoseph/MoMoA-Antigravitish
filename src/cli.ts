#!/usr/bin/env node
/**
 * MoMo Overseer — Headless CLI daemon for autonomous Jules swarm orchestration.
 *
 * Commands:
 *   daemon          Start the MCP server on stdio
 *   swarm dispatch  Dispatch Jules worker agents
 *   swarm status    Print current swarm status
 *   swarm triage    Run a single triage pass (approve + pull)
 *   swarm monitor   Start the polling daemon
 */

import { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { startMcpServer } from './mcp_server.js';
import { SwarmManager } from './swarm/swarm_manager.js';
import { SessionPoller } from './swarm/session_poller.js';
import { LocalStore } from './persistence/local_store.js';
import { DEFAULT_STRATEGIES } from './swarm/types.js';
import { GeminiClient } from './services/geminiClient.js';
import { ApiPolicyManager } from './services/apiPolicyManager.js';
import { ConcreteInfrastructureContext } from './services/infrastructure.js';

// --- Global error handlers ---
const store = new LocalStore('.swarm');

process.on('unhandledRejection', (reason) => {
  const msg = `UNHANDLED_REJECTION: ${reason}`;
  console.error(`[ERROR] ${msg}`);
  store.logError(msg);
});

process.on('uncaughtException', (error) => {
  const msg = `UNCAUGHT_EXCEPTION: ${error.stack ?? error.message}`;
  console.error(`[ERROR] ${msg}`);
  store.logError(msg);
  // Don't exit — keep daemon alive
});

// --- CLI Definition ---
const program = new Command();

program
  .name('momo-overseer')
  .description('Headless CLI daemon for autonomous Jules swarm orchestration & MCP server')
  .version('1.0.0');

function createGeminiClient(): GeminiClient {
  const infraContext = new ConcreteInfrastructureContext();
  const apiPolicyManager = new ApiPolicyManager();
  return new GeminiClient(
    { apiKey: process.env.GEMINI_API_KEY ?? '', context: infraContext },
    apiPolicyManager,
  );
}

// --- daemon command ---
program
  .command('daemon')
  .description('Start the MCP server on stdio transport')
  .option('-d, --dir <path>', 'Target project directory', process.env.MOMO_WORKING_DIR || process.cwd())
  .option('--mcp-config <path>', 'Path to mcp_servers.json for dynamic MCP server discovery')
  .option('--no-self-healing', 'Disable the autonomous self-healing execution loop')
  .action(async (opts) => {
    const projectDir = path.resolve(opts.dir);
    const mcpConfigPath = opts.mcpConfig ? path.resolve(opts.mcpConfig) : undefined;
    
    if (opts.selfHealing === false) {
      process.env.MOMO_DISABLE_SELF_HEALING = 'true';
    }

    console.error(`[MoMo] Starting daemon for project: ${projectDir}`);
    if (mcpConfigPath) {
      console.error(`[MoMo] Dynamic MCP config: ${mcpConfigPath}`);
    }
    await startMcpServer(projectDir, mcpConfigPath);
  });

// --- swarm commands ---
const swarm = program
  .command('swarm')
  .description('Jules swarm management commands');

swarm
  .command('dispatch')
  .description('Dispatch Jules worker agents with strategy rotation')
  .requiredOption('-c, --count <n>', 'Number of agents to dispatch', parseInt)
  .requiredOption('-r, --repo <owner/repo>', 'GitHub repository (e.g. dewarjoseph/renesas)')
  .option('-b, --branch <branch>', 'Target branch', 'main')
  .option('-d, --target-dir <dir>', 'Target directory for agents', process.cwd())
  .option('-p, --prompt-dir <dir>', 'Directory containing prompt .md files')
  .option('-t, --todo-file <path>', 'Path to a TODO_swarm.md file to dispatch each line as an agent prompt')
  .option('-s, --strategies <list>', 'Comma-separated strategy list', (val: string) => val.split(','))
  .action(async (opts) => {
    const manager = new SwarmManager(store, {} as any);
    const dispatched = await manager.dispatch({
      count: opts.count,
      targetDir: path.resolve(opts.targetDir),
      repo: opts.repo,
      branch: opts.branch,
      promptDir: opts.promptDir ? path.resolve(opts.promptDir) : undefined,
      todoFile: opts.todoFile ? path.resolve(opts.todoFile) : undefined,
      strategies: opts.strategies ?? DEFAULT_STRATEGIES,
    });

    console.log(`\nDispatched ${dispatched.length} agents.`);
    dispatched.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
  });

swarm
  .command('monitor')
  .description('Start the polling daemon to monitor, approve, and pull swarm sessions')
  .option('--sessions <ids>', 'Comma-separated session IDs', (val: string) => val.split(','))
  .option('-i, --interval <ms>', 'Poll interval in milliseconds', parseInt, 120_000)
  .option('-m, --max-polls <n>', 'Maximum number of polls', parseInt, 120)
  .option('-r, --repo-root <dir>', 'Local repo root for pulling diffs', process.cwd())
  .option('-s, --strategies <list>', 'Comma-separated strategy names', (val: string) => val.split(','))
  .action(async (opts) => {
    const sessionIds = opts.sessions || store.listSessions().map(s => s.id);
    if (!sessionIds || sessionIds.length === 0) {
      console.log('No sessions exist to monitor. Please run `swarm dispatch` or provide `--sessions <ids>`.');
      return;
    }

    const poller = new SessionPoller({
      sessionIds: sessionIds,
      strategies: opts.strategies ?? DEFAULT_STRATEGIES,
      pollIntervalMs: opts.interval,
      maxPolls: opts.maxPolls,
      store,
      geminiClient: createGeminiClient(),
    });

    await poller.startPolling(path.resolve(opts.repoRoot));
  });

swarm
  .command('triage')
  .description('Run a single triage pass: approve waiting plans and pull completed diffs')
  .option('--sessions <ids>', 'Comma-separated session IDs', (val: string) => val.split(','))
  .option('-r, --repo-root <dir>', 'Local repo root for pulling diffs', process.cwd())
  .option('-s, --strategies <list>', 'Comma-separated strategy names', (val: string) => val.split(','))
  .action(async (opts) => {
    const sessionIds = opts.sessions || store.listSessions().map(s => s.id);
    if (!sessionIds || sessionIds.length === 0) {
      console.log('No sessions exist to triage. Please run `swarm dispatch` or provide `--sessions <ids>`.');
      return;
    }

    const poller = new SessionPoller({
      sessionIds: sessionIds,
      strategies: opts.strategies ?? DEFAULT_STRATEGIES,
      store,
      geminiClient: createGeminiClient(),
    });

    console.log('Running single triage pass...');
    const result = await poller.poll();
    console.log(`Status: ${result.completed} completed, ${result.inProgress} in-progress, ${result.awaiting} awaiting`);

    if (result.awaiting > 0) {
      const approved = await poller.approveWaiting(result.sessions);
      console.log(`Auto-approved: ${approved}`);
    }

    const newCompleted = result.sessions.filter(
      s => s.state === 'COMPLETED'
    ).length;
    if (newCompleted > 0) {
      const pulled = await poller.pullCompleted(result.sessions, path.resolve(opts.repoRoot));
      console.log(`Pulled: ${pulled} session diffs`);
    }

    console.log('Triage complete.');
  });

swarm
  .command('status')
  .description('Print the current swarm status report')
  .action(() => {
    const reportPath = store.getStatusReportPath();
    if (fs.existsSync(reportPath)) {
      console.log(fs.readFileSync(reportPath, 'utf-8'));
    } else {
      console.log('No status report found. Run `swarm monitor` to start tracking.');
    }
  });

swarm
  .command('generate-batch')
  .description('Generate batch swarm prompts to a TODO.md file')
  .option('-o, --output <path>', 'Output file path', 'TODO_swarm.md')
  .requiredOption('-c, --count <n>', 'Number of variants per group', parseInt)
  .requiredOption('-g, --groups <json>', 'JSON array of {name, basePrompt} objects')
  .action((opts) => {
    const manager = new SwarmManager(store, {} as any);
    const groups = JSON.parse(opts.groups).map((g: any) => ({
      ...g,
      count: opts.count,
    }));
    const total = manager.generateBatchPrompts(opts.output, groups);
    console.log(`Generated ${total} tasks to ${opts.output}`);
  });

// --- Run ---
program.parse();
