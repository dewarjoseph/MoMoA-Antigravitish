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
      } else {
        console.log(`[MergeSupervisor] AI rejected diff for ${branchName}. Reasoning: ${decision.reasoning}`);
      }

      return decision;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[MergeSupervisor] Evaluation failed: ${errorMsg}`);
      return { approved: false, reasoning: `System error during evaluation: ${errorMsg}` };
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
