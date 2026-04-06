/**
 * ReadMcpResourceTool — Allows agents to pull live resources from any
 * connected downstream MCP server. Useful for reading database schemas,
 * API docs, or any resource a connected MCP server exposes.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';

export const readMcpResourceTool: MultiAgentTool = {
  displayName: 'Read MCP Resource',
  name: 'READ_MCP_RESOURCE',

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const manager = context.mcpClientManager;
    if (!manager) {
      return { result: 'Error: No MCP Client Manager available. Dynamic MCP is not initialized.' };
    }

    const serverName = params['server'] as string;
    const uri = params['uri'] as string;

    // If no server specified, list all available resources across all servers
    if (!serverName && !uri) {
      try {
        const allResources = await manager.listAllResources();
        if (allResources.length === 0) {
          return { result: 'No resources available from any connected MCP server.' };
        }
        const lines = allResources.map(
          r => `[${r.server}] ${r.uri} — ${r.name}${r.description ? `: ${r.description}` : ''}`
        );
        return { result: `Available MCP Resources:\n${lines.join('\n')}` };
      } catch (err: any) {
        return { result: `Error listing resources: ${err.message}` };
      }
    }

    if (!serverName || !uri) {
      return { result: "Error: Both 'server' and 'uri' are required to read a resource. Omit both to list all resources." };
    }

    context.sendMessage(
      JSON.stringify({
        status: 'PROGRESS_UPDATES',
        completed_status_message: `Reading resource '${uri}' from MCP server '${serverName}'...`,
      })
    );

    try {
      const content = await manager.readResource(serverName, uri);
      return { result: content };
    } catch (err: any) {
      return { result: `Error reading resource from '${serverName}': ${err.message}` };
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
      return { success: false, error: 'Invalid JSON parameters for READ_MCP_RESOURCE.' };
    }
  },
};
