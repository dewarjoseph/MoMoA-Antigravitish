import { MultiAgentTool } from "../multiAgentTool.js";
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../../momoa_core/types.js";
import { JulesClient } from "../../services/julesClient.js";
import { DEFAULT_GEMINI_PRO_MODEL } from "../../config/models.js";

export const julesAutoTriageTool: MultiAgentTool = {
  displayName: "Jules Autonomous Swarm Auto-Triage Tool",
  name: "JULES_AUTO_TRIAGE",

  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const client = new JulesClient();
    
    let args;
    try {
      args = JSON.parse(params.jsonArgs);
    } catch {
      return { result: "Failed to parse arguments for JULES_AUTO_TRIAGE. Expected JSON string." };
    }

    const sessionIdRaw = args.sessionId;
    if (!sessionIdRaw) return { result: "sessionId is required." };
    const sessionId = sessionIdRaw.startsWith("sessions/") ? sessionIdRaw : `sessions/${sessionIdRaw}`;

    context.sendMessage(`[Jules Triage] Investigating stalled session: ${sessionId}...`);

    try {
      const session = await client.getSession(sessionId) as any;
      const actsWrapper = await client.listActivities(sessionId, 10) as any;
      const acts = actsWrapper.activities || [];

      if (session.state === "AWAITING_PLAN_APPROVAL") {
         context.sendMessage(`[Jules Triage] Session is AWAITING_PLAN_APPROVAL. Auto-Evaluating...`);
         
         const planActivity = acts.find((a: any) => a.planGenerated);
         if (!planActivity) return { result: "Failed to locate generated plan in recent activities." };
         
         const planStructure = JSON.stringify(planActivity.planGenerated.plan.steps, null, 2);
         const prompt = `You are the MoMo Overseer. A Jules AI worker has proposed this plan:\n${planStructure}\nEvaluate if this plan is safe to execute on the repository without manual human review. Only reply with the exact text YES or NO.`;
         
         const evalResponse = await context.multiAgentGeminiClient.sendOneShotMessage(prompt, { model: DEFAULT_GEMINI_PRO_MODEL });
         
         if (evalResponse?.text && evalResponse.text.trim().toUpperCase() === "YES") {
             context.sendMessage(`[Jules Triage] AI Safety Evaluation passed. Approving plan over REST via server-side bridging...`);
             await client.approvePlan(sessionId);
             return { result: `Triage Complete: Plan Approved automatically via AI supervision.` };
         } else {
             return { result: `Triage Blocked: Plan did not pass AI automatic safety grading. Requires manual User Review.` };
         }
      }

      if (session.state === "AWAITING_USER_FEEDBACK") {
         context.sendMessage(`[Jules Triage] Session is AWAITING_USER_FEEDBACK. Analyzing question...`);
         const msgActivity = acts.find((a: any) => a.agentMessaged);
         if (!msgActivity) return { result: "Failed to locate agent message in recent activities." };

         const question = msgActivity.agentMessaged.agentMessage;
         context.sendMessage(`[Jules Triage] Jules asked: "${question}"`);

         const prompt = `You are a Senior Lead Developer. Your subordinate AI agent asked you: "${question}". Provide a decisive, clear, and unblocked instruction to keep them moving based dynamically on standard best practices. Avoid pleasantries, just command them.`;
         const directCommand = await context.multiAgentGeminiClient.sendOneShotMessage(prompt, { model: DEFAULT_GEMINI_PRO_MODEL });

         if (directCommand?.text) {
             context.sendMessage(`[Jules Triage] Providing auto-guided command: \\n${directCommand.text}`);
             await client.sendMessage(sessionId, directCommand.text);
             return { result: `Triage Complete: Dynamically answered block with instruction.` };
         } else {
             return { result: `Triage Error: Local Gemini instance failed to format an answer.` };
         }
      }

      if (session.state === "FAILED") {
          context.sendMessage(`[Jules Triage] Session has FAILED fatally. Generating post-mortem...`);
          const failAct = acts.find((a: any) => a.sessionFailed);
          const reason = failAct ? failAct.sessionFailed.reason : "Unknown failure";
          
          const prompt = `A subordinate Jules worker failed building with the exception: "${reason}". Please summarize what caused it and generate a 1 sentence instruction for resolving it on a recursive retry.`;
          const recoverySteps = await context.multiAgentGeminiClient.sendOneShotMessage(prompt, { model: DEFAULT_GEMINI_PRO_MODEL });
          
          return { result: `Triage Complete (Fatal): ${recoverySteps?.text}` };
      }

      return { result: `Triage N/A: Session is in state ${session.state}. No auto-triage required.` };

    } catch (e: any) {
      context.sendMessage(`[Jules REST Error] Triage pipeline crashed: ${e.message}`);
      return { result: `Triage Failed: ${e.message}` };
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
