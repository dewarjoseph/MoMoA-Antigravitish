/**
 * MCP Server for MoMo Overseer.
 * Exposes local tools from src/tools/implementations/ over stdio transport
 * for integration with Claude, Gemini CLI, and other MCP clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import tool registry
import { getToolNames, getTool } from './tools/multiAgentToolRegistry.js';
import type { MultiAgentToolContext, MultiAgentToolResult } from './momoa_core/types.js';
import { GeminiClient } from './services/geminiClient.js';
import { ApiPolicyManager } from './services/apiPolicyManager.js';
import { TranscriptManager } from './services/transcriptManager.js';
import { ConcreteInfrastructureContext } from './services/infrastructure.js';
import type { UserSecrets } from './shared/model.js';
import { scanLocalDirectory } from './utils/localScanner.js';

/**
 * Build a MultiAgentToolContext for local MCP operation.
 * This provides the minimum viable context for tool execution
 * without requiring the full orchestrator stack.
 */
async function buildLocalContext(projectDir: string): Promise<MultiAgentToolContext> {
  const secrets: UserSecrets = {
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    julesApiKey: process.env.JULES_API_KEY ?? '',
    githubToken: process.env.GITHUB_TOKEN ?? '',
    stitchApiKey: '',
    e2BApiKey: '',
    githubScratchPadRepo: process.env.GITHUB_SCRATCHPAD_REPO ?? '',
  };

  const infraContext = new ConcreteInfrastructureContext();
  const apiPolicyManager = new ApiPolicyManager();

  const geminiClient = new GeminiClient(
    { apiKey: secrets.geminiApiKey, context: infraContext },
    apiPolicyManager,
  );

  const transcript = new TranscriptManager({ context: infraContext });

  process.stderr.write(`[MoMo-MCP] Scanning local directory: ${projectDir}\n`);
  const { fileMap, binaryFileMap } = await scanLocalDirectory(projectDir);
  process.stderr.write(`[MoMo-MCP] Loaded ${fileMap.size} text files and ${binaryFileMap.size} binary files into memory.\n`);

  return {
    initialPrompt: '[MCP Server - local tool execution]',
    fileMap,
    binaryFileMap,
    editedFilesSet: new Set<string>(),
    originalFilesSet: new Set<string>(),
    originalFileMap: new Map<string, string>(fileMap),
    originalBinaryFileMap: new Map<string, string>(binaryFileMap),
    sendMessage: (msg: string) => {
      // In headless mode, log to stderr so it doesn't interfere with MCP stdio
      // process.stderr.write(`[MCP-TOOL] ${msg}\n`);
      try {
        const parsed = JSON.parse(msg);
        if (parsed.status === 'APPLY_FILE_CHANGE' && parsed.data?.filename && parsed.data?.content !== undefined) {
           const fullPath = path.join(projectDir, parsed.data.filename);
           const decoded = Buffer.from(parsed.data.content, 'base64');
           fs.mkdirSync(path.dirname(fullPath), { recursive: true });
           fs.writeFileSync(fullPath, decoded);
           process.stderr.write(`[MCP-TOOL] Saved changes to disk: ${fullPath}\n`);
        } else if (parsed.status === 'PROGRESS_UPDATES') {
           process.stderr.write(`[MCP-TOOL] Progress: ${parsed.completed_status_message}\n`);
        } else if (parsed.status === 'WORK_LOG') {
           process.stderr.write(`[MCP-TOOL] Log: ${parsed.message}\n`);
        }
      } catch (e) {
        // Not a JSON message, ignore quietly
      }
    },
    multiAgentGeminiClient: geminiClient,
    experts: [],
    transcriptsToUpdate: [transcript],
    transcriptForContext: transcript,
    overseer: undefined,
    saveFileResolver: null,
    infrastructureContext: infraContext,
    saveFiles: true,
    secrets,
  };
}

/**
 * Create and configure the MCP server with all available tools.
 */
export async function createMcpServer(projectDir: string): Promise<McpServer> {
  const server = new McpServer({
    name: 'momo-overseer',
    version: '1.0.0',
  });

  const context = await buildLocalContext(projectDir);

  // Register each tool from the registry as an MCP tool
  const toolNames = getToolNames();

  for (const toolName of toolNames) {
    const tool = getTool(toolName);
    if (!tool) continue;

    // Sanitize the tool name to comply with ^[a-zA-Z0-9_-]{1,64}$
    const mcpToolName = toolName
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/_$/, '');

    // Register with a generic params schema — tools parse their own params
    server.tool(
      mcpToolName,
      `[${tool.displayName}] Execute the ${toolName} tool`,
      {
        params: z.string().describe('JSON-encoded parameters for the tool'),
      },
      async (args) => {
        try {
          const params = JSON.parse(args.params);
          const result: MultiAgentToolResult = await tool.execute(params, context);
          return {
            content: [{ type: 'text' as const, text: result.result }],
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${errorMsg}` }],
            isError: true,
          };
        }
      }
    );
  }

  // Add a special "list_tools" resource for discoverability
  server.tool(
    'list_available_tools',
    'List all tools registered in the MoMo Overseer',
    {},
    async () => {
      const names = getToolNames();
      const descriptions = names.map(name => {
        const t = getTool(name);
        return `- **${t?.displayName ?? name}** (\`${name}\`)`;
      });
      return {
        content: [{ type: 'text' as const, text: `# Available Tools\n\n${descriptions.join('\n')}` }],
      };
    }
  );

  return server;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startMcpServer(projectDir: string): Promise<void> {
  const server = await createMcpServer(projectDir);
  const transport = new StdioServerTransport();

  process.stderr.write('[MoMo-MCP] Starting MCP server on stdio...\n');
  process.stderr.write(`[MoMo-MCP] Project directory: ${projectDir}\n`);
  process.stderr.write(`[MoMo-MCP] Registered tools: ${getToolNames().join(', ')}\n`);

  await server.connect(transport);
  process.stderr.write('[MoMo-MCP] MCP server connected and ready.\n');
}
