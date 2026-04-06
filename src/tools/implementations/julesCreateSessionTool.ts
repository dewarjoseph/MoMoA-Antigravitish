import { MultiAgentTool } from "../multiAgentTool.js";
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../../momoa_core/types.js";
import { JulesClient } from "../../services/julesClient.js";

export const julesCreateSessionTool: MultiAgentTool = {
  displayName: "Jules Create Session Tool",
  name: "JULES_CREATE_SESSION",

  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const client = new JulesClient();
    
    let args;
    try {
      args = JSON.parse(params.jsonArgs);
    } catch {
      return { result: "Failed to parse arguments for JULES_CREATE_SESSION. Expected JSON string." };
    }

    const sourceContext = {
      source: args.sourceId?.startsWith("sources/") ? args.sourceId : `sources/${args.sourceId}`,
      githubRepoContext: {
        startingBranch: args.branch || "main"
      }
    };

    context.sendMessage(`[Jules REST] Creating session on ${sourceContext.source} (branch: ${sourceContext.githubRepoContext.startingBranch})...`);

    try {
      const session = await client.createSession(args.prompt, sourceContext, args.title, args.requirePlanApproval);
      context.sendMessage(`[Jules REST] Session created! ID: ${session.id} | URL: ${session.url}`);
      return {
        result: JSON.stringify({
          status: "SUCCESS",
          session: session
        }, null, 2)
      };
    } catch (e: any) {
      context.sendMessage(`[Jules REST Error] Failed to create session: ${e.message}`);
      return { result: `Failed: ${e.message}` };
    }
  },

  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    if (invocation.trim()) {
      return {
        success: true, 
        params: { jsonArgs: invocation.trim() }
      };
    } else {
      return {
        success: false, 
        error: `Invalid syntax. Please provide JSON args payload.`
      };
    }
  }
};
