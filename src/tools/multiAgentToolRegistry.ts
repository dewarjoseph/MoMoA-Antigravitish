/**
 * Copyright 2026 Reto Meier
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { MultiAgentTool } from './multiAgentTool.js';
import { fileReaderTool } from './implementations/fileReaderTool.js';
import { smartFileEditorTool } from './implementations/smartFileEditorTool.js';
import { askExpertTool } from './implementations/askExpertTool.js';
import { fileSearchTool } from './implementations/fileSearchTool.js';
import { paradoxResolutionTool } from './implementations/paradoxResolutionTool.js';
import { moveFolderTool } from './implementations/renameFolderTool.js';
import { MultiAgentToolContext, MultiAgentToolResult } from '../momoa_core/types.js';
import { getAssetString } from '../services/promptManager.js';
import { regexValidatorTool } from './implementations/regexValidatorTool.js';
import { restartProjectTool } from './implementations/projectRestartTool.js';
import { revertFileTool } from './implementations/revertFileTool.js';
import { urlFetchTool } from './implementations/urlFetchTool.js';
import { LintTool } from './implementations/LintTool.js';
import { factFinderTool } from './implementations/FactFinderTool.js';
import { OptimizerTool } from './implementations/optimizerTool.js';
import { CodeRunnerTool } from './implementations/codeRunnerTool.js';
import { researchLogTool } from './implementations/researchLogTool.js';
import { swarmDispatchTool } from './implementations/swarmDispatchTool.js';
import { superviseMergeTool } from './implementations/superviseMergeTool.js';
import { swarmStatusTool } from './implementations/swarmStatusTool.js';
import { swarmCleanupTool } from './implementations/swarmCleanupTool.js';
import { julesCreateSessionTool } from './implementations/julesCreateSessionTool.js';
import { julesMonitorSessionTool } from './implementations/julesMonitorSessionTool.js';
import { julesAutoTriageTool } from './implementations/julesAutoTriageTool.js';
import { memoryStatsTool } from './implementations/memoryStatsTool.js';
import { hiveMindQueryTool } from './implementations/hiveMindQueryTool.js';
import { hiveMindWriteTool } from './implementations/hiveMindWriteTool.js';
import { askHumanTool } from './implementations/askHumanTool.js';
import { respondToHumanTool } from './implementations/respondToHumanTool.js';
import { hitlStatusTool } from './implementations/hitlStatusTool.js';
import { searchRegistryTool } from './implementations/searchRegistryTool.js';
import { telemetryDashboardTool } from './implementations/telemetryDashboardTool.js';
import { autoToolGeneratorTool } from './implementations/autoToolGeneratorTool.js';
import { promptEvolutionTool } from './implementations/promptEvolutionTool.js';
import { EvolutionSynthesizerTool } from './implementations/evolutionSynthesizerTool.js';
import * as ts from 'typescript';

// The state is a module-level constant, making it private to this module.
const tools = new Map<string, MultiAgentTool>();

/**
 * Registers a tool with the registry. This function is not exported,
 * so it's private to the module.
 * @param tool The tool instance to register.
 */
function registerTool(tool: MultiAgentTool): void {
  if (tools.has(tool.name)) {
    console.warn(`Tool "${tool.name}" is already registered. Overwriting.`);
  }
  tools.set(tool.name, tool);
}

/**
 * Registers a tool dynamically by transpiling TypeScript code to JS, encoding as an ESM Data URI,
 * and loading it without accessing the filesystem or cache.
 * Returns the loaded MultiAgentTool schema to gracefully resume.
 */
export async function generateAndLoadTool(tsCode: string): Promise<MultiAgentTool> {
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  
  const encodedJs = Buffer.from(jsCode).toString('base64');
  const dataUri = `data:text/javascript;base64,${encodedJs}`;
  
  const dynamicModule = await import(dataUri);
  const newTool: MultiAgentTool = dynamicModule.default || dynamicModule.tool || Object.values(dynamicModule)[0];
  
  if (!newTool || !newTool.name || !newTool.execute) {
    throw new Error("Generated code does not export a valid MultiAgentTool schema.");
  }
  
  registerTool(newTool);
  return newTool;
}

/**
 * Returns an array of the names of all registered tools.
 * @returns {string[]} An array of tool names.
 */
export function getToolNames(): string[] {
  return [...tools.keys()];
}

/**
 * Retrieves a tool by its name.
 * @param {string} toolName The name of the tool to retrieve.
 * @returns {Tool | undefined} The tool instance or undefined if not found.
 */
export function getTool(toolName: string): MultiAgentTool | undefined {
  return tools.get(toolName);
}

/**
 * Executes a registered tool by its name with the given parameters and context.
 * If the tool is not registered, it returns an error message.
 *
 * @param toolName The name of the tool to execute.
 * @param params The parameters for the tool's execution.
 * @param context The ToolContext object containing necessary runtime information.
 * @returns A promise that resolves to the tool's output string or an error message.
 */
export async function executeTool(
  toolName: string | undefined,
  params: Record<string, unknown> | undefined,
  context: MultiAgentToolContext
): Promise<MultiAgentToolResult> {
  const toolResultPrefix = await getAssetString('tool-result-prefix');
  const toolResultSuffix = await getAssetString('tool-result-suffix');

  if (!toolName) {
    return {result: 'No valid tool name was provided.'};
  }

  const tool = tools.get(toolName);

  if (!tool) {
    return {result: `Error: Tool '${toolName}' is not implemented yet.`};
  }

  if (!params) {
    return {result: `No valid parameters were found for ${tool?.displayName}.`};
  }

  const MAX_HOTPATCH_RETRIES = 1;
  let retryCount = 0;

  while(true) {
    try {
      const activeTool = tools.get(toolName);
      if (!activeTool) {
         return {result: `Error: Tool '${toolName}' is not implemented yet.`};
      }
      const toolResult = await activeTool.execute(params, context);
      return {
        result: `${toolResultPrefix}\n${toolResult.result}\n${toolResultSuffix}`,
        transcriptReplacementID: toolResult.transcriptReplacementID,
        transcriptReplacementString: `${toolResultPrefix}\n${toolResult.transcriptReplacementString}\n${toolResultSuffix}`
      }
    } catch (error: unknown) {
      let errorMessage: string = (error instanceof Error) ? error.message : String(error);

      if (retryCount >= MAX_HOTPATCH_RETRIES) {
        return {
          result: `${toolResultPrefix}\nError executing ${tool?.displayName} tool (After Autonomic Hot-Patching): ${errorMessage}\n${toolResultSuffix}`,
        }
      }

      // Autonomic Pulse: Hot-Patching
      process.stderr.write(`[Autonomic Pulse] Trapped failure in ${toolName}: ${errorMessage}\n[Autonomic Pulse] Synthesizing hot-fix using Gemini...\n`);
      if (context.tracer) {
         context.tracer.emitLog(`[Autonomic Pulse] Trapped failure in ${toolName}. Synthesizing hot-fix...`);
      }

      const fixPrompt = `You are the Autonomic Pulse subsystem of MoMoA. The tool ${toolName} just failed with this runtime exception:
\n${errorMessage}\n
Write a patched TypeScript version of this tool. For context, you must export a singleton instance of the tool implementing the MultiAgentTool schema. 
Output ONLY valid TypeScript code. Do NOT include markdown code fences or explanations. Return raw TS source code.`;

      try {
        const fixResponse = await context.multiAgentGeminiClient.sendOneShotMessage(fixPrompt);
        const fixCode = fixResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanCode = fixCode.replace(/^```(typescript|ts)?\n|^```$/gm, '').trim();
        await generateAndLoadTool(cleanCode);
        process.stderr.write(`[Autonomic Pulse] Hot-patch dynamically injected for ${toolName}. Retrying execution in same tick...\n`);
        retryCount++;
      } catch(fixErr) {
        process.stderr.write(`[Autonomic Pulse] Hot-patch synthesis failed: ${fixErr}\n`);
        return {
          result: `${toolResultPrefix}\nError executing ${tool?.displayName} tool: ${errorMessage}\n${toolResultSuffix}`,
        }
      }
    }
  }
}

// --- Module Initialization ---
registerTool(fileReaderTool);
registerTool(smartFileEditorTool);
registerTool(askExpertTool);
registerTool(fileSearchTool);
registerTool(paradoxResolutionTool);
registerTool(moveFolderTool);
registerTool(regexValidatorTool);
registerTool(restartProjectTool);
registerTool(revertFileTool);
registerTool(urlFetchTool);
registerTool(LintTool);
registerTool(factFinderTool);
registerTool(OptimizerTool);
registerTool(CodeRunnerTool);
registerTool(researchLogTool);
registerTool(swarmDispatchTool);
registerTool(superviseMergeTool);
registerTool(swarmStatusTool);
registerTool(swarmCleanupTool);
registerTool(julesCreateSessionTool);
registerTool(julesMonitorSessionTool);
registerTool(julesAutoTriageTool);
registerTool(memoryStatsTool);

// --- Phase 5: Four Pillars Tools ---
registerTool(hiveMindQueryTool);
registerTool(hiveMindWriteTool);
registerTool(askHumanTool);
registerTool(respondToHumanTool);
registerTool(hitlStatusTool);
registerTool(searchRegistryTool);
registerTool(telemetryDashboardTool);
registerTool(autoToolGeneratorTool);
registerTool(promptEvolutionTool);

// --- MCP Resource & Prompt Tools ---
import { readMcpResourceTool } from './implementations/readMcpResourceTool.js';
import { getMcpPromptTool } from './implementations/getMcpPromptTool.js';
registerTool(readMcpResourceTool);
registerTool(getMcpPromptTool);

// --- Dynamic MCP Tool Registration ---
import { DynamicMcpTool } from './implementations/dynamicMcpTool.js';
import type { McpClientManager } from '../mcp/mcpClientManager.js';

/**
 * Unregisters a tool by name. Used for hot-unplug when MCP servers disconnect.
 */
export function unregisterTool(toolName: string): boolean {
  return tools.delete(toolName);
}

/**
 * Registers all tools discovered from connected MCP servers via the McpClientManager.
 * Clears any previously registered dynamic MCP tools first to handle hot-reload cleanly.
 */
export function registerDynamicMcpTools(manager: McpClientManager): number {
  // Remove any existing dynamic MCP tools (those containing '__' separator)
  const toRemove: string[] = [];
  for (const name of tools.keys()) {
    if (name.includes('__')) {
      toRemove.push(name);
    }
  }
  for (const name of toRemove) {
    tools.delete(name);
  }

  // Register fresh tools from all connected servers
  const allTools = manager.getAllTools();
  let count = 0;

  for (const [_qualifiedName, { serverName, tool: remoteTool }] of allTools) {
    const dynamicTool = new DynamicMcpTool(serverName, remoteTool, manager);
    registerTool(dynamicTool);
    count++;
  }

  if (count > 0) {
    process.stderr.write(`[MCP-Registry] Registered ${count} dynamic MCP tool(s).\n`);
  }

  return count;
}