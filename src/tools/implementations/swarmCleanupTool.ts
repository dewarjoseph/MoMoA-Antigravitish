import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface SwarmCleanupArgs {
  targetDir?: string;
}

export const swarmCleanupTool: MultiAgentTool = {
  displayName: "Swarm Cleanup",
  name: 'SWARM_CLEANUP{',
  endToken: '}',

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const args = params as unknown as SwarmCleanupArgs;
    
    // Default target dir is current working dir
    const targetDir = args.targetDir || process.env.MOMO_WORKING_DIR || process.cwd();
    const swarmDir = path.join(targetDir, '.swarm');

    try {
      if (!fs.existsSync(swarmDir)) {
         return { result: `No .swarm directory found at ${targetDir}. Nothing to clean.` };
      }

      context.sendMessage(JSON.stringify({
        status: "PROGRESS_UPDATES",
        message: `[Swarm Cleanup] Wiping sessions and logs in ${swarmDir}`
      }));
      
      let deletedCount = 0;

      // Clean sessions
      const sessionsDir = path.join(swarmDir, 'sessions');
      if (fs.existsSync(sessionsDir)) {
          const files = fs.readdirSync(sessionsDir);
          for (const file of files) {
             fs.unlinkSync(path.join(sessionsDir, file));
             deletedCount++;
          }
      }

      // Clean logs
      const logsDir = path.join(swarmDir, 'logs');
      if (fs.existsSync(logsDir)) {
          const files = fs.readdirSync(logsDir);
          for (const file of files) {
             fs.unlinkSync(path.join(logsDir, file));
             deletedCount++;
          }
      }

      return {
        result: `Successfully cleaned up ${deletedCount} tracking artifacts in .swarm.`
      };
    } catch (err) {
      return {
        result: `[ERROR] Failed to clean Swarm state: ${err instanceof Error ? err.stack : String(err)}`
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
        error: `Invalid JSON payload for SWARM_CLEANUP: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }
};
