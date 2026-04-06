/**
 * DynamicMcpTool — A tool implementation that proxies calls to a dynamically
 * discovered MCP server tool via the McpClientManager connection pool.
 *
 * Unlike the old ProxyMcpTool which spawned a new process per call, this uses
 * persistent connections managed by McpClientManager for zero-overhead routing.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import type { McpClientManager, DiscoveredMcpTool } from '../../mcp/mcpClientManager.js';

export class DynamicMcpTool implements MultiAgentTool {
  readonly displayName: string;
  readonly name: string;
  readonly endToken?: string;

  private serverName: string;
  private remoteName: string;
  private manager: McpClientManager;
  private schema: DiscoveredMcpTool;

  constructor(
    serverName: string,
    remoteTool: DiscoveredMcpTool,
    manager: McpClientManager
  ) {
    this.serverName = serverName;
    this.remoteName = remoteTool.name;
    this.manager = manager;
    this.schema = remoteTool;

    // Qualified name for registry: "serverName__toolName"
    // Sanitze for MCP naming rules: ^[a-zA-Z0-9_-]{1,64}$
    this.name = `${serverName}__${remoteTool.name}`
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 64);

    this.displayName = `${remoteTool.name} (${serverName})`;
  }

  /** Get the JSON schema for this tool's input parameters */
  getInputSchema(): Record<string, unknown> {
    return this.schema.inputSchema;
  }

  /** Get the tool description */
  getDescription(): string {
    return this.schema.description;
  }

  async execute(
    params: Record<string, unknown>,
    context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    context.sendMessage(
      JSON.stringify({
        status: 'PROGRESS_UPDATES',
        completed_status_message: `Executing ${this.serverName}/${this.remoteName}...`,
      })
    );

    try {
      const result = await this.manager.callTool(
        this.serverName,
        this.remoteName,
        params
      );
      return { result };
    } catch (error: any) {
      return {
        result: `Dynamic MCP Tool Execution Failed (${this.serverName}/${this.remoteName}): ${error.message}`,
      };
    }
  }

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    // Dynamic tools are called via structured MCP params, not inline text parsing
    const trimmed = invocation.trim();
    try {
      const parsed = JSON.parse(trimmed);
      return { success: true, params: parsed };
    } catch {
      // Fallback: treat entire string as a single params blob
      return {
        success: true,
        params: { input: trimmed },
      };
    }
  }
}
