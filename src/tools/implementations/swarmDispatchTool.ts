import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import { SwarmManager } from '../../swarm/swarm_manager.js';
import { LocalStore } from '../../persistence/local_store.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface SwarmDispatchArgs {
  count: number;
  repo: string;
  basePrompt?: string;
  branch?: string;
  strategies?: string[];
  promptDir?: string;
}

export const swarmDispatchTool: MultiAgentTool = {
  displayName: "Swarm Dispatch",
  name: 'SWARM_DISPATCH{',
  endToken: '}',

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const dispatchArgs = params as unknown as SwarmDispatchArgs;
    
    // Safety guardrails: max agents limit
    const MAX_AGENTS = 10;
    const requestedCount = Number(dispatchArgs.count) || 1;
    if (requestedCount > MAX_AGENTS) {
      return {
        result: `[ERROR] Dispatch count ${requestedCount} exceeds maximum allowed limit (${MAX_AGENTS}). Scaling down to ${MAX_AGENTS}.`
      };
    }
    const count = Math.min(requestedCount, MAX_AGENTS);
    const repo = dispatchArgs.repo;

    if (!repo) {
       return { result: "[ERROR] 'repo' parameter is required for Swarm Dispatch (e.g. owner/repo)." };
    }

    // Default target dir is current working dir
    const targetDir = process.env.MOMO_WORKING_DIR || process.cwd();

    const store = new LocalStore(path.join(targetDir, '.swarm'));
    const manager = new SwarmManager(store, context);

    let promptDir = dispatchArgs.promptDir;

    // Build dynamic prompt dir if basePrompt specified
    if (!promptDir && dispatchArgs.basePrompt) {
      const dynamicPromptDir = path.join(store.getBaseDir(), 'active-prompts');
      fs.mkdirSync(dynamicPromptDir, { recursive: true });
      
      const strategies = dispatchArgs.strategies || ['general_task'];
      const agentsPerStrategy = Math.ceil(count / Math.max(1, strategies.length));
      
      let promptsGeneratedCounter = 0;
      for (const strat of strategies) {
        if (promptsGeneratedCounter >= count) break;
        const promptContent = `[Strategy: ${strat}]\n\n${dispatchArgs.basePrompt}\n\nPlease exclusively operate under the designated strategy context.`;
        fs.writeFileSync(path.join(dynamicPromptDir, `${strat.replace(/[^a-zA-Z0-9]/g, '_')}.md`), promptContent, 'utf-8');
        promptsGeneratedCounter += agentsPerStrategy;
      }
      promptDir = dynamicPromptDir;
    }

    // Launch dispatch asynchronously to avoid blocking the MCP/Orchestrator loop
    context.sendMessage(JSON.stringify({
      status: "PROGRESS_UPDATES",
      completed_status_message: `[Swarm] Backgrounding dispatch of ${count} Jules workers to '${repo}'...`
    }));
    
    // We execute in the background and return immediately.
    manager.dispatch({
      count,
      targetDir,
      repo,
      branch: dispatchArgs.branch ?? 'main',
      ...(promptDir && { promptDir: promptDir }),
      ...(dispatchArgs.strategies && { strategies: dispatchArgs.strategies }),
    }).then(dispatched => {
       store.appendLog('swarm_dispatch.log', `Background dispatch resolved. Dispatched ${dispatched.length} workers.`);
    }).catch(err => {
       const errMsg = err instanceof Error ? err.stack : String(err);
       store.appendLog('swarm_dispatch.log', `Background dispatch threw an error: ${errMsg}`);
    });

    return {
      result: `Swarm dispatch initiated asynchronously for ${count} workers. The SessionPoller daemon will monitor their execution. Follow progress in .swarm/swarm_dispatch.log.`
    };
  },

  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    try {
      // Re-add the closing brace for parsing
      const jsonString = '{' + invocation.trim() + (invocation.trim().endsWith('}') ? '' : '}');
      const params = JSON.parse(jsonString);
      return { success: true, params };
    } catch (e) {
      return {
        success: false,
        error: `Invalid JSON payload for SWARM_DISPATCH: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }
};
