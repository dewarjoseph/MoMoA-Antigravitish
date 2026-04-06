import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import { LocalStore } from '../../persistence/local_store.js';
import * as path from 'node:path';

interface SwarmStatusArgs {
  targetDir?: string;
}

export const swarmStatusTool: MultiAgentTool = {
  displayName: "Swarm Status Tracker",
  name: 'SWARM_STATUS{',
  endToken: '}',

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const args = params as unknown as SwarmStatusArgs;
    
    // Default target dir is current working dir
    const targetDir = args.targetDir || process.env.MOMO_WORKING_DIR || process.cwd();
    const store = new LocalStore(path.join(targetDir, '.swarm'));

    try {
      context.sendMessage(JSON.stringify({
        status: "PROGRESS_UPDATES",
        message: `[Swarm Status] Fetching live sessions from ${targetDir}/.swarm`
      }));

      const sessions = store.listSessions();
      
      if (sessions.length === 0) {
        return {
          result: `No active swarm sessions found in ${targetDir}.`
        };
      }

      // Format output nicely
      let summary = `**Live Swarm Sessions (${sessions.length})**\\n\\n`;
      summary += `| Session ID | Strategy | Agent | State | Pulled | Approved |\\n`;
      summary += `|---|---|---|---|---|---|\\n`;
      for (const s of sessions) {
        summary += `| ${s.id} | ${s.strategy} | ${s.agentNumber} | ${s.state} | ${s.pulled} | ${s.approved} |\\n`;
      }
      
      return {
        result: summary
      };
    } catch (err) {
      return {
        result: `[ERROR] Failed to read Swarm Status: ${err instanceof Error ? err.stack : String(err)}`
      };
    }
  },

  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    try {
      const jsonString = '{' + invocation.trim() + (invocation.trim().endsWith('}') ? '' : '}');
      const params = JSON.parse(jsonString);
      return { success: true, params };
    } catch (e) {
      return {
        success: false,
        error: `Invalid JSON payload for SWARM_STATUS: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }
};
