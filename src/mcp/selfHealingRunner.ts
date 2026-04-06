/**
 * SelfHealingRunner — Autonomous error recovery middleware.
 *
 * Intercepts failed tool executions (CodeRunner, Optimizer) and attempts
 * autonomous repair by:
 * 1. Capturing stderr/stdout from the failure
 * 2. Piping the error into a sequential-thinking MCP server for fix hypothesis
 * 3. Applying the fix via file editing
 * 4. Re-executing the original tool
 *
 * Respects max-retry threshold and degrades gracefully when sequential-thinking
 * is not available.
 */

import type { McpClientManager } from './mcpClientManager.js';
import type {
  MultiAgentToolContext,
  MultiAgentToolResult,
} from '../momoa_core/types.js';
import { executeTool } from '../tools/multiAgentToolRegistry.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 5;
const HEALABLE_TOOLS = new Set(['RUN{', 'OPTIMIZE{']);

// Error patterns that indicate a recoverable failure
const ERROR_PATTERNS = [
  /Error: Process exited with code (?!0)/i,
  /Error: Execution timed out/i,
  /Compilation Failed/i,
  /Dry Run Crashed/i,
  /Dry Run Failed/i,
  /System Error:/i,
  /Tool Execution Error:/i,
  /Rust Compilation Failed/i,
];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SelfHealingConfig {
  enabled: boolean;
  maxRetries: number;
  mcpManager: McpClientManager | null;
}

export interface HealingAttempt {
  attempt: number;
  error: string;
  hypothesis: string;
  fixed: boolean;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export class SelfHealingRunner {
  private config: SelfHealingConfig;
  private healingLog: HealingAttempt[] = [];

  constructor(config?: Partial<SelfHealingConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      maxRetries: config?.maxRetries ??
        (parseInt(process.env.MOMO_MAX_SELF_HEAL_RETRIES || '', 10) ||
        DEFAULT_MAX_RETRIES),
      mcpManager: config?.mcpManager ?? null,
    };
  }

  /**
   * Resolve the McpClientManager — checks constructor config first,
   * then falls back to the tool context's mcpClientManager.
   * This lazy resolution ensures the self-healing loop works even when
   * the runner is created before McpClientManager is initialized.
   */
  private resolveManager(context?: MultiAgentToolContext): McpClientManager | null {
    return this.config.mcpManager ?? context?.mcpClientManager ?? null;
  }

  /** Get the healing log for the last execution */
  getHealingLog(): HealingAttempt[] {
    return [...this.healingLog];
  }

  /**
   * Execute a tool with automatic self-healing on failure.
   *
   * If the tool is in the HEALABLE_TOOLS set and fails, this method will
   * attempt to fix the underlying issue using sequential-thinking and retry.
   */
  async executeWithHealing(
    toolName: string,
    params: Record<string, unknown>,
    context: MultiAgentToolContext,
    progressCallback?: (message: string) => void
  ): Promise<MultiAgentToolResult> {
    this.healingLog = [];

    // Check if this tool is eligible for self-healing
    if (!this.config.enabled || !HEALABLE_TOOLS.has(toolName)) {
      return executeTool(toolName, params, context);
    }

    // Resolve MCP manager lazily (config > context > null)
    const manager = this.resolveManager(context);

    // Check if sequential-thinking MCP is available
    const sequentialThinkingServer = this.findSequentialThinkingServer(manager);
    if (!sequentialThinkingServer) {
      // Graceful degradation: no sequential-thinking available, run normally
      return executeTool(toolName, params, context);
    }

    let lastResult = await executeTool(toolName, params, context);
    let attempt = 0;

    while (attempt < this.config.maxRetries && this.isRecoverableError(lastResult.result)) {
      attempt++;

      const errorSummary = this.extractErrorSummary(lastResult.result);

      const log = (msg: string) => {
        if (progressCallback) progressCallback(msg);
        process.stderr.write(`[SelfHeal] ${msg}\n`);
      };

      log(`Attempt ${attempt}/${this.config.maxRetries}: Detected recoverable error. Engaging sequential-thinking...`);

      // Build the reasoning prompt
      let reasoningPrompt = this.buildReasoningPrompt(
        toolName,
        params,
        errorSummary,
        attempt
      );

      // Paradox Resolution Logic:
      // If we've failed twice with the same exact error and hypothesis cycle, break the loop
      if (attempt >= 3 && this.healingLog.length >= 2) {
        const prev1 = this.healingLog[this.healingLog.length - 1];
        const prev2 = this.healingLog[this.healingLog.length - 2];
        if (prev1.error === errorSummary || prev1.hypothesis === prev2.hypothesis) {
          log(`Paradoxical loop detected. Engaging PARADOX tool for resolution synthesis...`);
          try {
            const paradoxResponse = await executeTool('PARADOX', {
               paradox: `The tool ${toolName} continuously fails with: ${errorSummary}. I tried: ${prev1.hypothesis}. But the error persists. Provide a synthesized workaround or new approach.`
            }, context);
            log(`PARADOX resolution: ${paradoxResponse.result.substring(0, 200)}...`);
            
            // Allow the prompt to incorporate the paradox workaround
            reasoningPrompt += `\n\n## PARADOX RESOLUTION GUIDANCE:\n${paradoxResponse.result}`;
          } catch (pErr: any) {
            log(`Paradox resolution failed: ${pErr.message}`);
          }
        }
      }

      let hypothesis = '';
      try {
        // Call sequential-thinking to generate a fix hypothesis
        hypothesis = await this.callSequentialThinking(
          sequentialThinkingServer,
          reasoningPrompt,
          manager!
        );

        log(`Fix hypothesis generated: ${hypothesis.substring(0, 200)}...`);
      } catch (err: any) {
        log(`Sequential-thinking call failed: ${err.message}. Stopping self-healing.`);
        this.healingLog.push({
          attempt,
          error: errorSummary,
          hypothesis: `[Failed to generate hypothesis: ${err.message}]`,
          fixed: false,
        });
        break;
      }

      // Attempt to apply the fix
      const fixApplied = await this.applyFix(hypothesis, params, context);

      this.healingLog.push({
        attempt,
        error: errorSummary,
        hypothesis: hypothesis.substring(0, 500),
        fixed: false, // Will be updated if re-execution succeeds
      });

      if (!fixApplied) {
        log(`Could not apply fix hypothesis. Stopping self-healing.`);
        break;
      }

      // Re-execute the tool
      log(`Re-executing ${toolName} after applying fix...`);
      lastResult = await executeTool(toolName, params, context);

      if (!this.isRecoverableError(lastResult.result)) {
        log(`Self-healing succeeded on attempt ${attempt}!`);
        this.healingLog[this.healingLog.length - 1].fixed = true;
      }
    }

    // Append healing log to result if any attempts were made
    if (this.healingLog.length > 0) {
      const logSummary = this.healingLog
        .map(h => `[Attempt ${h.attempt}] ${h.fixed ? '✅' : '❌'} Error: ${h.error.substring(0, 100)}...`)
        .join('\n');

      lastResult.result += `\n\n--- Self-Healing Log (${this.healingLog.length} attempt(s)) ---\n${logSummary}`;
    }

    return lastResult;
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  private isRecoverableError(resultText: string): boolean {
    return ERROR_PATTERNS.some(pattern => pattern.test(resultText));
  }

  private extractErrorSummary(resultText: string): string {
    // Extract the most relevant error info (stderr section if available)
    const stderrMatch = resultText.match(/--- STDERR ---\n([\s\S]*?)(?=\n---|$)/);
    const errorLine = resultText.match(/Error:.*$/m);

    let summary = '';
    if (stderrMatch) {
      summary = stderrMatch[1].trim().substring(0, 1000);
    } else if (errorLine) {
      summary = errorLine[0].substring(0, 500);
    } else {
      summary = resultText.substring(0, 500);
    }

    return summary;
  }

  private buildReasoningPrompt(
    toolName: string,
    params: Record<string, unknown>,
    errorSummary: string,
    attempt: number
  ): string {
    const files = (params['files'] as string[]) || [];
    const command = (params['command'] as string) || '';

    return `You are debugging a failed script execution. This is self-healing attempt ${attempt}.

## Tool: ${toolName}
## Command/Files: ${command || files.join(', ')}

## Error Output:
\`\`\`
${errorSummary}
\`\`\`

## Task:
1. Analyze the error carefully
2. Identify the root cause
3. Suggest a CONCRETE fix — either a code change or a command modification
4. Express your fix as a clear, actionable instruction

Be specific. If it's a code fix, output exactly a \`@DOC/EDIT{filename}\` block with \`TO_REPLACE:{}\` and \`NEW_TEXT:{}\`.
If it's a command issue, output the corrected command enclosed in \`\`\`bash\`\`\`.
If it's a missing dependency, instruct using \`install <dependency>\`.

Respond with ONLY the fix instruction, no preamble.`;
  }

  /**
   * Find a connected sequential-thinking MCP server.
   * Looks for common server name patterns.
   */
  private findSequentialThinkingServer(manager?: McpClientManager | null): string | null {
    const mgr = manager ?? this.config.mcpManager;
    if (!mgr) return null;

    const serverNames = mgr.serverNames;
    const candidates = [
      'sequential-thinking',
      'sequentialthinking',
      'sequential_thinking',
      'thinking',
    ];

    for (const candidate of candidates) {
      const found = serverNames.find(
        name => name.toLowerCase().includes(candidate)
      );
      if (found) return found;
    }

    return null;
  }

  /**
   * Call the sequential-thinking MCP server to reason about a fix.
   */
  private async callSequentialThinking(
    serverName: string,
    prompt: string,
    manager: McpClientManager
  ): Promise<string> {
    // Try to find the 'sequentialthinking' tool on the server
    const allTools = manager.getAllTools();
    let targetToolName: string | null = null;

    for (const [qualifiedName, { serverName: sn }] of allTools) {
      if (sn === serverName) {
        // Use the first tool we find on this server
        const parts = qualifiedName.split('__');
        targetToolName = parts.length > 1 ? parts.slice(1).join('__') : qualifiedName;
        break;
      }
    }

    if (!targetToolName) {
      throw new Error(`No tools found on server '${serverName}'`);
    }

    const result = await manager.callTool(
      serverName,
      targetToolName,
      {
        thought: prompt,
        nextThoughtNeeded: false,
        thoughtNumber: 1,
        totalThoughts: 1,
      }
    );

    return result;
  }

  /**
   * Attempt to apply a fix based on the hypothesis.
   * Currently supports modifying command parameters.
   * Full file-editing integration would use SmartFileEditorTool.
   */
  private async applyFix(
    hypothesis: string,
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<boolean> {
    // Strategy 1: If the hypothesis suggests a command change,
    // try to extract and update the command parameter
    const commandMatch = hypothesis.match(/```(?:bash|shell|sh)?\n([^\n]+)\n```/);
    if (commandMatch && params['command']) {
      const newCommand = commandMatch[1].trim();
      if (newCommand && newCommand !== params['command']) {
        params['command'] = newCommand;
        process.stderr.write(`[SelfHeal] Updated command to: ${newCommand}\n`);
        return true;
      }
    }

    // Strategy 2: Check for a DOC_EDIT block
    if (hypothesis.includes('@DOC/EDIT{')) {
      const docEditMatch = hypothesis.match(/@DOC\/EDIT{([A-Za-z0-9_.-]+)}/i);
      if (docEditMatch) {
         const targetFile = docEditMatch[1];
         const fullBlock = hypothesis.substring(hypothesis.indexOf('@DOC/EDIT{'));
         const editRequestBlock = fullBlock.split(/\r?\n/).slice(1).join('\n').trim();
         try {
           const result = await executeTool('DOC/EDIT{', { filename: targetFile, editRequest: editRequestBlock }, context);
           process.stderr.write(`[SelfHeal] Executed DOC_EDIT on ${targetFile}: ${result.result.substring(0, 100)}...\n`);
           return true; // We always return true here to allow a re-run of the original tool, even if DOC_EDIT partially failed, the re-run will confirm.
         } catch (e: any) {
           process.stderr.write(`[SelfHeal] DOC_EDIT execution failed internally: ${e}\n`);
         }
      }
    }

    // Strategy 3: If the hypothesis suggests adding a dependency,
    // try to modify the dependencies parameter
    const depMatch = hypothesis.match(/(?:install|add|require)\s+[`"']?(\w[\w-]*)[`"']?/i);
    if (depMatch && params['dependencies']) {
      const dep = depMatch[1];
      const currentDeps = params['dependencies'] as string;
      try {
        const depsArray = JSON.parse(currentDeps);
        if (Array.isArray(depsArray) && !depsArray.includes(dep)) {
          depsArray.push(dep);
          params['dependencies'] = JSON.stringify(depsArray);
          process.stderr.write(`[SelfHeal] Added dependency: ${dep}\n`);
          return true;
        }
      } catch {
        // Not JSON, try string append
      }
    }

    process.stderr.write(`[SelfHeal] Could not extract actionable fix from hypothesis.\n`);
    return false;
  }
}
