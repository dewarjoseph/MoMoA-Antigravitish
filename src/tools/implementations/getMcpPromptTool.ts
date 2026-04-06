/**
 * GetMcpPromptTool — Allows agents to discover and retrieve prompts from
 * any connected downstream MCP server. Useful for dynamically pulling
 * pre-configured prompt templates from specialized MCP servers.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';

export const getMcpPromptTool: MultiAgentTool = {
  displayName: 'Get MCP Prompt',
  name: 'GET_MCP_PROMPT',

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const manager = context.mcpClientManager;
    if (!manager) {
      return { result: 'Error: No MCP Client Manager available. Dynamic MCP is not initialized.' };
    }

    const serverName = params['server'] as string;
    const promptName = params['prompt_name'] as string;
    const promptArgs = params['args'] as Record<string, string> | undefined;

    // If no server specified, list all available prompts across all servers
    if (!serverName && !promptName) {
      try {
        const allPrompts = await manager.listAllPrompts();
        if (allPrompts.length === 0) {
          return { result: 'No prompts available from any connected MCP server.' };
        }
        const lines = allPrompts.map(
          p => `[${p.server}] ${p.name}${p.description ? ` — ${p.description}` : ''}`
        );
        return { result: `Available MCP Prompts:\n${lines.join('\n')}` };
      } catch (err: any) {
        return { result: `Error listing prompts: ${err.message}` };
      }
    }

    if (!serverName || !promptName) {
      return { result: "Error: Both 'server' and 'prompt_name' are required to get a prompt. Omit both to list all prompts." };
    }

    context.sendMessage(
      JSON.stringify({
        status: 'PROGRESS_UPDATES',
        completed_status_message: `Fetching prompt '${promptName}' from MCP server '${serverName}'...`,
      })
    );

    try {
      const content = await manager.getPrompt(serverName, promptName, promptArgs);
      return { result: content };
    } catch (err: any) {
      return { result: `Error getting prompt from '${serverName}': ${err.message}` };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    try {
      const parsed = JSON.parse(invocation.trim());
      return { success: true, params: parsed };
    } catch {
      return { success: false, error: 'Invalid JSON parameters for GET_MCP_PROMPT.' };
    }
  },
};
