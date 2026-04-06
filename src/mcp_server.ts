/**
 * MCP Server for MoMo Overseer.
 * Exposes local tools from src/tools/implementations/ over stdio transport
 * for integration with Claude, Gemini CLI, and other MCP clients.
 *
 * Phase 2: Now supports dynamic MCP client connections via McpClientManager,
 * resource/prompt endpoints, and bi-directional MCP hosting.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import tool registry
import { getToolNames, getTool, registerDynamicMcpTools } from './tools/multiAgentToolRegistry.js';
import type { MultiAgentToolContext, MultiAgentToolResult } from './momoa_core/types.js';
import { GeminiClient } from './services/geminiClient.js';
import { ApiPolicyManager } from './services/apiPolicyManager.js';
import { TranscriptManager } from './services/transcriptManager.js';
import { ConcreteInfrastructureContext } from './services/infrastructure.js';
import type { UserSecrets } from './shared/model.js';
import { scanLocalDirectory } from './utils/localScanner.js';
import { McpClientManager } from './mcp/mcpClientManager.js';
import { DynamicMcpTool } from './tools/implementations/dynamicMcpTool.js';

/**
 * Build a MultiAgentToolContext for local MCP operation.
 * This provides the minimum viable context for tool execution
 * without requiring the full orchestrator stack.
 */
async function buildLocalContext(
  projectDir: string,
  mcpManager?: McpClientManager
): Promise<MultiAgentToolContext> {
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
    mcpClientManager: mcpManager,
  };
}

/**
 * Create and configure the MCP server with all available tools.
 * Now supports dynamic MCP client initialization via mcpConfigPath.
 */
export async function createMcpServer(
  projectDir: string,
  mcpConfigPath?: string
): Promise<McpServer> {
  const server = new McpServer({
    name: 'momo-overseer',
    version: '2.0.0',
  });

  // --- Dynamic MCP Client Manager ---
  let mcpManager: McpClientManager | undefined;
  const resolvedConfigPath = mcpConfigPath || path.join(projectDir, 'mcp_servers.json');

  try {
    mcpManager = new McpClientManager(resolvedConfigPath);

    // Wire hot-reload: when tools change, re-register them
    mcpManager.setOnToolsChanged(async () => {
      registerDynamicMcpTools(mcpManager!);
      process.stderr.write(`[MoMo-MCP] Dynamic tool landscape updated. Total tools: ${getToolNames().length}\n`);
    });

    await mcpManager.initFromConfig();
  } catch (err) {
    process.stderr.write(`[MoMo-MCP] Dynamic MCP init error (non-fatal): ${err}\n`);
  }

  const context = await buildLocalContext(projectDir, mcpManager);

  const toolNames = getToolNames();
  const legacyNlpTools = new Set(['PHONEAFRIEND', 'PARADOX', 'RESTART_PROJECT{', 'UPDATE_RESEARCH_LOG', 'FACTFINDER']);

  for (const toolName of toolNames) {
    if (legacyNlpTools.has(toolName)) continue;
    
    const tool = getTool(toolName);
    if (!tool) continue;

    // Sanitize the tool name to comply with ^[a-zA-Z0-9_-]{1,64}$
    const mcpToolName = toolName
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/_$/, '');

    let toolSchema: Record<string, z.ZodTypeAny> = {
      params: z.string().describe('JSON-encoded parameters for the tool'),
    };

    // --- Native Tool Schemas ---
    if (mcpToolName === 'DOC_READ') {
        toolSchema = { filename: z.string().describe("Target file path to read") };
    } else if (mcpToolName === 'DOC_EDIT') {
        toolSchema = { filename: z.string().describe("Target file path to edit"), editRequest: z.string().describe("Instructions or code block specifying the edit") };
    } else if (mcpToolName === 'FILESEARCH_query') {
        toolSchema = { query: z.string().describe("Search string, glob, or regex pattern to search across the codebase") };
    } else if (mcpToolName === 'RUN') {
        toolSchema = { 
            files: z.array(z.string()).optional().describe("Files to stage or execute"),
            command: z.string().optional().describe("Shell or build command (e.g., 'make firmware', 'gcc main.c -o main')"),
        };
    } else if (mcpToolName === 'LINT') {
        toolSchema = { filename: z.string().describe("Target file path to lint") };
    } else if (mcpToolName === 'DOC_REVERT') {
        toolSchema = { filename: z.string().describe("Target file path to revert to original state") };
    } else if (mcpToolName === 'URL_FETCH') {
        toolSchema = { url: z.string().url().describe("Target URL to fetch") };
    } else if (mcpToolName === 'REGEX_VALIDATE') {
        toolSchema = { target_string: z.string(), regex: z.string() };
    } else if (mcpToolName === 'MOVE_FILE_OR_FOLDER_SOURCE') {
        toolSchema = { source: z.string(), destination: z.string() };
    } else if (mcpToolName === 'OPTIMIZE') {
        toolSchema = { 
            evaluator_script: z.string().describe("Target driver script to execute evaluations"),
            search_space: z.string().describe("JSON stringified grid space (e.g. {'chunk_size': [100, 200]})"),
            goal: z.enum(['min', 'max']).optional().describe("Objective function direction"),
            budget: z.number().optional().describe("Number of random search trials (0 = full grid search)"),
            trials: z.number().optional().describe("Number of repititions per parameter set"),
            dependencies: z.string().optional().describe("JSON stringified array of required pip modules or files")
        };
    } else if (mcpToolName === 'READ_MCP_RESOURCE') {
        toolSchema = {
            server: z.string().optional().describe("MCP server name to read resource from. Omit to list all resources."),
            uri: z.string().optional().describe("Resource URI to read."),
        };
    } else if (mcpToolName === 'GET_MCP_PROMPT') {
        toolSchema = {
            server: z.string().optional().describe("MCP server name to get prompt from. Omit to list all prompts."),
            prompt_name: z.string().optional().describe("Name of the prompt to retrieve."),
            args: z.record(z.string(), z.string()).optional().describe("Arguments to pass to the prompt template."),
        };
    } else if (tool instanceof DynamicMcpTool) {
        // Dynamic MCP tools: build schema from discovered inputSchema
        toolSchema = buildZodSchemaFromJson(tool.getInputSchema());
    }

    server.tool(
      mcpToolName,
      `[${tool.displayName}] native overseer binding`,
      toolSchema,
      async (args) => {
        try {
          // If we mapped specific properties, `args` carries them natively inside an object.
          // Fallback legacy if params string is present, otherwise use native args object.
          let executeParams: any = args;
          if (args.params && typeof args.params === 'string') {
              try { executeParams = JSON.parse(args.params); } catch { executeParams = args; }
          }
          
          const result: MultiAgentToolResult = await tool.execute(executeParams, context);
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

  // --- Discoverability Tool ---
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

  // --- Resource Endpoints (Directive 3 & 4) ---
  // Expose project files as MCP resources for external agents
  server.resource(
    'project-files',
    'file://project/files',
    async (uri) => {
      const fileList = [...context.fileMap.keys()].join('\n');
      return {
        contents: [{
          uri: uri.href,
          text: `# Project Files\n\n${fileList}`,
          mimeType: 'text/plain',
        }],
      };
    }
  );

  return server;
}

/**
 * Build a Zod schema from a JSON Schema object (basic conversion for MCP tool registration).
 * Handles common types: string, number, integer, boolean, array, object.
 */
function buildZodSchemaFromJson(
  jsonSchema: Record<string, unknown>
): Record<string, z.ZodTypeAny> {
  const properties = (jsonSchema.properties as Record<string, any>) || {};
  const required = new Set((jsonSchema.required as string[]) || []);
  const zodSchema: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
      case 'integer':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.any());
        break;
      case 'object':
        zodType = z.record(z.string(), z.any());
        break;
      default:
        zodType = z.any();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.has(key)) {
      zodType = zodType.optional();
    }

    zodSchema[key] = zodType;
  }

  // Fallback: if no properties were extracted, use a generic params field
  if (Object.keys(zodSchema).length === 0) {
    zodSchema['params'] = z.string().optional().describe('JSON-encoded parameters');
  }

  return zodSchema;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startMcpServer(
  projectDir: string,
  mcpConfigPath?: string
): Promise<void> {
  const server = await createMcpServer(projectDir, mcpConfigPath);
  const transport = new StdioServerTransport();

  process.stderr.write('[MoMo-MCP] Starting MCP server on stdio...\n');
  process.stderr.write(`[MoMo-MCP] Project directory: ${projectDir}\n`);
  process.stderr.write(`[MoMo-MCP] Registered tools: ${getToolNames().join(', ')}\n`);

  await server.connect(transport);
  process.stderr.write('[MoMo-MCP] MCP server connected and ready.\n');
}
