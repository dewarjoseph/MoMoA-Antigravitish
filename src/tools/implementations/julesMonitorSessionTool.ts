import { MultiAgentTool } from "../multiAgentTool.js";
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../../momoa_core/types.js";
import { JulesClient } from "../../services/julesClient.js";

export const julesMonitorSessionTool: MultiAgentTool = {
  displayName: "Jules Monitor Session Tool",
  name: "JULES_MONITOR_SESSION",

  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const client = new JulesClient();
    
    let args;
    try {
      args = JSON.parse(params.jsonArgs);
    } catch (e: any) {
      return { result: `Failed to parse arguments for JULES_MONITOR_SESSION. Expected JSON string but received: "${params.jsonArgs}". Error: ${e.message}` };
    }

    const sessionId = args.sessionId?.startsWith("sessions/") ? args.sessionId : `sessions/${args.sessionId}`;
    const maxActivities = args.maxActivities || 5;

    context.sendMessage(`[Jules REST] Fetching session status for ${sessionId}...`);

    try {
      const session = await client.getSession(sessionId);
      
      let activitiesContent: any[] = [];
      try {
          const acts = await client.listActivities(sessionId, maxActivities);
          if (acts && acts.activities) {
              activitiesContent = acts.activities.map((a: any) => ({
                 id: a.id,
                 originator: a.originator,
                 description: a.description,
                 ...a.planGenerated ? { planGenerated: true } : {},
                 ...a.agentMessaged ? { message: a.agentMessaged.agentMessage } : {},
                 ...a.progressUpdated ? { progress: a.progressUpdated.title } : {}
              }));
          }
      } catch (err: any) {
          context.sendMessage(`[Jules REST Warning] Could not fetch activities for ${sessionId}: ${err.message}`);
      }

      return {
        result: JSON.stringify({
          status: "SUCCESS",
          sessionState: session.state,
          url: session.url,
          requirePlanApproval: session.requirePlanApproval,
          outputs: session.outputs || [],
          recentActivities: activitiesContent
        }, null, 2)
      };
    } catch (e: any) {
      if (e.name === 'JulesHttpError') {
          context.sendMessage(e.message);
          return { result: `REST API Pipeline Fatally Error'd: \n${e.message}` };
      }
      context.sendMessage(`[Jules REST Fatal] Failed to monitor session dynamically: ${e.message}`);
      return { result: `System execution trace explicitly dropped. Reason: ${e.message}` };
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
