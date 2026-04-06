/**
 * AI Merge Supervisor for Jules Swarm
 * Evaluates pulled session diffs to ensure they meet task requirements before auto-merging.
 */

import { GeminiClient } from "../services/geminiClient.js";
import { DEFAULT_GEMINI_PRO_MODEL } from "../config/models.js";
import { getExpertPrompt } from "../services/promptManager.js";
import { removeBacktickFences } from "../utils/markdownUtils.js";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export interface SupervisionResult {
  approved: boolean;
  reasoning: string;
}

export class MergeSupervisor {
  constructor(private geminiClient: GeminiClient) {}

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
        await this.runGitCommand(["rev-parse", "--verify", "main"], repoRoot);
      } catch {
        baseBranch = "master";
      }

      // 1. Get the diff of the new branch against the base branch
      const diffStr = await this.runGitCommand(["diff", `${baseBranch}...${branchName}`], repoRoot);
      
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
        await this.runGitCommand(["checkout", baseBranch], repoRoot);
        const mergeResult = await this.runGitCommand(["merge", branchName, "--no-edit"], repoRoot);
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

  private runGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("git", args, {
        cwd,
        shell: process.platform === 'win32',
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`git ${args.join(" ")} failed w/ code ${code}: ${stderr}`));
      });
      
      proc.on("error", (err) => reject(new Error(`git spawn error: ${err.message}`)));
    });
  }
}
