import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
// GeminiClient will be dynamically imported during execution to avoid circular dependencies

interface SuperviseMergeArgs {
  branch: string;
  sessionTitle: string;
  repoPath?: string;
  sessionId?: string;
}

export const superviseMergeTool: MultiAgentTool = {
  displayName: "Supervise Merge",
  name: 'SUPERVISE_MERGE{',
  endToken: '}',

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const args = params as unknown as SuperviseMergeArgs;
    
    if (!args.branch) {
       return { result: "[ERROR] 'branch' parameter is required for Supervise Merge." };
    }

    const targetDir = args.repoPath || process.env.MOMO_WORKING_DIR || process.cwd();
    const sessionId = args.sessionId || `manual_trigger_${Date.now()}`;
    const { GeminiClient } = await import('../../services/geminiClient.js');
    const { ConcreteInfrastructureContext } = await import('../../services/infrastructure.js');
    const { ApiPolicyManager } = await import('../../services/apiPolicyManager.js');

    const geminiClient = new GeminiClient(
      { apiKey: process.env.GEMINI_API_KEY ?? '', context: new ConcreteInfrastructureContext() },
      new ApiPolicyManager()
    );

    try {
      context.sendMessage(JSON.stringify({
        status: "EVALUATING",
        message: `[Supervise Merge] Using Gemini to validate diff on branch: ${args.branch}`
      }));

      const { MergeSupervisor } = await import('../../swarm/merge_supervisor.js');
      const supervisor = new MergeSupervisor(geminiClient, context);
      const result = await supervisor.evaluateAndMerge(
         args.branch, 
         sessionId, 
         targetDir, 
         args.sessionTitle || "No title provided"
      );
      
      return {
        result: JSON.stringify(result, null, 2)
      };
    } catch (err) {
      return {
        result: `[ERROR] Supervise Merge failed: ${err instanceof Error ? err.stack : String(err)}`
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
        error: `Invalid JSON payload for SUPERVISE_MERGE: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }
};
