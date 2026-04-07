/**
 * AI Merge Supervisor for Jules Swarm
 * Evaluates pulled session diffs to ensure they meet task requirements before auto-merging.
 */

import { GeminiClient } from "../services/geminiClient.js";
import { DEFAULT_GEMINI_PRO_MODEL } from "../config/models.js";
import { getExpertPrompt } from "../services/promptManager.js";
import { removeBacktickFences } from "../utils/markdownUtils.js";
import type { MultiAgentToolContext } from "../momoa_core/types.js";
import { executeTool } from "../tools/multiAgentToolRegistry.js";
import { HiveMind } from "../memory/hiveMind.js";
import { SwarmTracer } from "../telemetry/tracer.js";
import { SpanKind, SpanStatus } from "../telemetry/types.js";
import * as path from "node:path";
import * as fs from "node:fs";

export interface SupervisionResult {
  approved: boolean;
  reasoning: string;
}

export class MergeSupervisor {
  constructor(private geminiClient: GeminiClient, private context: MultiAgentToolContext) {}

  public async evaluateAndMerge(
    branchName: string,
    sessionId: string,
    repoRoot: string,
    taskTitle: string
  ): Promise<SupervisionResult> {
    try {
      // Determine default branch (main or master)
      let baseBranch = "main";
      try {
        await this.runMcpCommand(`git rev-parse --verify main`, repoRoot);
      } catch {
        baseBranch = "master";
      }

      // 1. Get the diff of the new branch against the base branch
      const diffStr = await this.runMcpCommand(`git diff ${baseBranch}...${branchName}`, repoRoot);
      
      if (!diffStr || diffStr.trim() === "") {
         return { approved: false, reasoning: "Diff was empty or could not be generated." };
      }

      if (diffStr.length > 500000) {
         return { approved: false, reasoning: "Diff too large for AI supervision context window." };
      }

      // 2. Load the overseer expert prompt. We will frame this as an Overseer code review task.
      const { preamble } = await getExpertPrompt("overseer");
      
      const prompt = `
${preamble}

**Task Objective/Title**:
${taskTitle}

**Proposed Git Diff**:
\`\`\`diff
${diffStr}
\`\`\`

Evaluate if this diff successfully implements the task objective without introducing obvious logic errors or destructive changes.
Provide your response strictly in JSON format matching this schema:
{
  "approved": boolean,
  "reasoning": "string"
}`;

      const responseText = (await this.geminiClient.sendOneShotMessage(prompt, {
        model: DEFAULT_GEMINI_PRO_MODEL,
      }))?.text;
      
      const fs = await import('node:fs');
      if (responseText) {
          fs.writeFileSync('raw_ai_response.txt', responseText, 'utf8');
      }

      let decision: SupervisionResult = { approved: false, reasoning: "AI failed to respond with valid format." };

      if (responseText) {
        try {
          const cleanResponse = removeBacktickFences(responseText);
          decision = JSON.parse(cleanResponse);
        } catch (err) {
          console.error(`[MergeSupervisor] Failed to parse AI JSON response: ${err}`);
        }
      }

      // 3. Auto-merge if approved
      if (decision.approved) {
        console.log(`[MergeSupervisor] AI approved diff for ${branchName}. Initiating merge...`);
        // We ensure we are on main
        await this.runMcpCommand(`git checkout ${baseBranch}`, repoRoot);
        const mergeResult = await this.runMcpCommand(`git merge ${branchName} --no-edit`, repoRoot);
        console.log(`[MergeSupervisor] Merge output: ${mergeResult}`);

        // --- Hive Mind: Auto-document successful merge ---
        try {
          const hiveMind = HiveMind.getInstance();
          await hiveMind.write(
            `Merge task: ${taskTitle} (branch: ${branchName})`,
            `AI-supervised merge of session ${sessionId}. Diff size: ${diffStr.length} chars.`,
            `Merge approved and completed. Reasoning: ${decision.reasoning}`,
            { tags: ['merge', 'auto-documented', 'swarm-result'] }
          );
        } catch { /* non-critical */ }
      } else {
        console.log(`[MergeSupervisor] AI rejected diff for ${branchName}. Reasoning: ${decision.reasoning}`);

        // --- Hive Mind: Document rejected merge for pattern learning ---
        try {
          const hiveMind = HiveMind.getInstance();
          await hiveMind.write(
            `Merge rejected: ${taskTitle} (branch: ${branchName})`,
            `AI rejected merge of session ${sessionId}.`,
            `Rejected: ${decision.reasoning}`,
            { tags: ['merge-rejected', 'auto-documented'], confidence: 0.5 }
          );
        } catch { /* non-critical */ }
      }

      return decision;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[MergeSupervisor] Evaluation failed: ${errorMsg}`);
      return { approved: false, reasoning: `System error during evaluation: ${errorMsg}` };
    }
  }

  public async competitivelyEvaluateAndMerge(
    taskId: string,
    branches: string[],
    repoRoot: string,
    taskTitle: string
  ): Promise<SupervisionResult & { winningBranch: string | null }> {
    try {
      let baseBranch = "main";
      try {
        await this.runMcpCommand(`git rev-parse --verify main`, repoRoot);
      } catch {
        baseBranch = "master";
      }

      // Gather all diffs
      const branchDiffs: Record<string, string> = {};
      for (const branch of branches) {
         try {
             const diffStr = await this.runMcpCommand(`git diff ${baseBranch}...${branch}`, repoRoot);
             if (diffStr && diffStr.trim() !== "" && diffStr.length < 500000) {
                 branchDiffs[branch] = diffStr;
             }
         } catch (e) {
             console.log(`[MergeSupervisor] Could not extract diff for ${branch}, skipping.`);
         }
      }

      if (Object.keys(branchDiffs).length === 0) {
          return { approved: false, reasoning: "No valid diffs could be generated across variants.", winningBranch: null };
      }

      const { preamble } = await getExpertPrompt("overseer");
      let multiDiffPrompt = `${preamble}\n\n**Task Objective/Title**:\n${taskTitle}\n\n**Competitive Diffs**:\n`;
      for (const [branch, diff] of Object.entries(branchDiffs)) {
          multiDiffPrompt += `\n--- Branch: ${branch} ---\n\`\`\`diff\n${diff}\n\`\`\`\n`;
      }
      multiDiffPrompt += `
Evaluate which of these diffs is structurally and practically superior.
Respond strictly in JSON format matching this schema:
{
  "approved": boolean,
  "winning_branch_name": "string" | null,
  "reasoning": "string"
}`;

      const responseText = (await this.geminiClient.sendOneShotMessage(multiDiffPrompt, {
        model: DEFAULT_GEMINI_PRO_MODEL,
      }))?.text;

      let decision = { approved: false, winning_branch_name: null as string | null, reasoning: "AI failed to parse." };
      if (responseText) {
        try {
          const cleanResponse = removeBacktickFences(responseText);
          decision = JSON.parse(cleanResponse);
        } catch (err) {
          console.error(`[MergeSupervisor] Failed to parse AI JSON response: ${err}`);
        }
      }

      if (decision.approved && decision.winning_branch_name && branchDiffs[decision.winning_branch_name]) {
         const winner = decision.winning_branch_name;
         console.log(`[MergeSupervisor] Competitive merge winner: ${winner}. Initiating merge...`);
         await this.runMcpCommand(`git checkout ${baseBranch}`, repoRoot);
         await this.runMcpCommand(`git merge ${winner} --no-edit`, repoRoot);
         
         try {
           const hiveMind = HiveMind.getInstance();
           await hiveMind.write(
             `Competitive Merge Winner: ${taskId} (branch: ${winner})`,
             `AI selected ${winner} over siblings.`,
             `Reasoning: ${decision.reasoning}`,
             { tags: ['merge-winner', 'intelligence-loop', 'swarm-result'] }
           );
         } catch {}

         // Delete losers
         for (const branch of branches) {
             if (branch !== winner) {
                 try { await this.runMcpCommand(`git branch -D ${branch}`, repoRoot); } catch {}
             }
         }

         return { approved: true, winningBranch: winner, reasoning: decision.reasoning };
      } else {
         console.log(`[MergeSupervisor] All variants rejected. Reasoning: ${decision.reasoning}`);
         return { approved: false, winningBranch: null, reasoning: decision.reasoning };
      }

    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return { approved: false, winningBranch: null, reasoning: `System error during evaluation: ${errorMsg}` };
    }
  }

  private async runMcpCommand(command: string, cwd: string): Promise<string> {
    const originalDir = process.cwd();
    process.chdir(cwd);
    try {
      const response = await executeTool('RUN', { command }, this.context);
      
      if (response.result.includes("Error:") || response.result.includes("failed")) {
          // Some git commands write to stderr normally, so we need to be careful with blindly throwing. 
          // But our RUN tool prefixes with `--- STDERR ---`
          if (response.result.includes("Process exited with code") && !response.result.includes("code 0")) {
              throw new Error(response.result);
          }
      }
      
      // Clean up the formatting provided by RUN tool
      let output = response.result.replace(/--- STDOUT ---\n|^.*Executing target.*$/gm, '').trim();
      const errMatch = response.result.match(/--- STDERR ---\n([\s\S]*?)(?=\n--- STDOUT|$)/);
      if (errMatch && errMatch[1].trim()) {
        output += '\n' + errMatch[1].trim();
      }

      return output;
    } finally {
      process.chdir(originalDir);
    }
  }
}
