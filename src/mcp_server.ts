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
import { Console } from 'node:console';

// Redirect global console completely to stderr, protecting MCP stdio transport JSON-RPC.
global.console = new Console(process.stderr, process.stderr);

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
import { runBootDiagnostics } from './telemetry/bootDiagnostics.js';
import { SwarmTracer } from './telemetry/tracer.js';

/**
 * Build a MultiAgentToolContext for local MCP operation.
 * This provides the minimum viable context for tool execution
 * without requiring the full orchestrator stack.
 */
async function buildLocalContext(
  projectDir: string,
  mcpManager?: McpClientManager
): Promise<MultiAgentToolContext> {
  // Aggressively load local .env variables to ensure keys like GEMINI_API_KEY are available
  // out-of-band when VSCode spawns the daemon cleanly.
  try {
      const envPath = path.join(projectDir, '.env');
      if (fs.existsSync(envPath)) {
          const envRaw = fs.readFileSync(envPath, 'utf8');
          for (const line of envRaw.split('\n')) {
              const matched = line.trim().match(/^([^=]+)=(.*)$/);
              if (matched) {
                  process.env[matched[1].trim()] = matched[2].trim();
              }
          }
      }
  } catch (e) {
      process.stderr.write(`[MoMo-MCP] Failed to parse .env silently: ${e}\n`);
  }

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

  for (const toolName of toolNames) {
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
    } else if (mcpToolName === 'JULES_CREATE_SESSION') {
        toolSchema = {
            prompt: z.string().describe("The task description for Jules to execute."),
            sourceId: z.string().describe("The source repository ID. Example: sources/123"),
            branch: z.string().optional().describe("Optional starting branch. Defaults to main."),
            title: z.string().optional().describe("Optional title for the session."),
            requirePlanApproval: z.boolean().optional().describe("If true, plans require standard manual approval."),
        };
    } else if (mcpToolName === 'JULES_MONITOR_SESSION') {
        toolSchema = {
            sessionId: z.string().describe("The session ID. Example: sessions/123"),
        };
    } else if (mcpToolName === 'JULES_AUTO_TRIAGE') {
        toolSchema = {
            sessionId: z.string().describe("The session ID waiting for approval/triage."),
        };
    } else if (mcpToolName === 'GET_MEMORY_STATS') {
        toolSchema = {}; // No params needed, purely an internal invocation
    } else if (mcpToolName === 'UPDATE_RESEARCH_LOG') {
        toolSchema = {
            entry: z.string().describe("The research log text to boldly append to RESEARCH_LOG.md"),
        };
    } else if (mcpToolName === 'SWARM_DISPATCH') {
        toolSchema = {
            count: z.number().describe("Number of autonomous agent streams to spawn in parallel."),
            repo: z.string().describe("Target GitHub repository (e.g., moongate-engineering/MoMoA-Antigravitish)"),
            basePrompt: z.string().optional().describe("Core instruction provided to all agents"),
            branch: z.string().optional().describe("Branch name to apply changes to"),
            strategies: z.array(z.string()).optional().describe("Assign strategy prefixes to spawned agents"),
            promptDir: z.string().optional().describe("Optional path overriding basePrompt mapping"),
        };
    } else if (mcpToolName === 'SUPERVISE_MERGE') {
        toolSchema = {
            branch: z.string().describe("Feature branch containing unmerged changes"),
            sessionTitle: z.string().describe("Descriptive title mapping to the original task goal"),
            repoPath: z.string().optional().describe("Local path to the repository directory"),
            sessionId: z.string().optional().describe("A tracking ID to associate with the merge context"),
        };
    } else if (mcpToolName === 'SWARM_STATUS') {
        toolSchema = {
            targetDir: z.string().optional().describe("Optional explicit repo directory to poll for logs"),
        };
    } else if (mcpToolName === 'SWARM_CLEANUP') {
        toolSchema = {
            targetDir: z.string().optional().describe("Local working directory to wipe previous runs from"),
        };
    } else if (mcpToolName === 'PHONEAFRIEND') {
        toolSchema = {
            question: z.string().describe("The question, issue summary, and any RELEVANT_FILES block for the expert."),
        };
    } else if (mcpToolName === 'PARADOX') {
        toolSchema = {
            paradox: z.string().describe("The paradox statement or conflicting instructions to synthesize."),
        };
    } else if (mcpToolName === 'RESTART_PROJECT') {
        toolSchema = {
            instruction: z.string().describe("The reason and scope for restarting the project context."),
        };
    } else if (mcpToolName === 'FACTFINDER') {
        toolSchema = {
            question: z.string().describe("The question requiring web lookup or deep knowledge mining."),
        };
    // --- Phase 5: Four Pillars Tool Schemas ---
    } else if (mcpToolName === 'QUERY_HIVE_MIND') {
        toolSchema = {
            query: z.string().describe("The text to search for in the Hive Mind memory."),
            topK: z.number().optional().describe("Number of results to return (default: 5)."),
            tags: z.array(z.string()).optional().describe("Filter results by tags."),
        };
    } else if (mcpToolName === 'WRITE_HIVE_MIND') {
        toolSchema = {
            context: z.string().describe("What the swarm was trying to accomplish."),
            action: z.string().describe("What tool/prompt/approach was used."),
            outcome: z.string().describe("Whether it succeeded, failed, and the resolution."),
            tags: z.array(z.string()).optional().describe("Searchable tags for categorization."),
            isGoldStandard: z.boolean().optional().describe("Whether this is a human-sourced gold standard solution."),
        };
    } else if (mcpToolName === 'ASK_HUMAN') {
        toolSchema = {
            question: z.string().describe("The question or issue requiring human input."),
            context: z.string().optional().describe("Additional context (error logs, trace links)."),
            urgency: z.enum(['low', 'medium', 'high', 'critical']).optional().describe("How urgent the request is."),
            traceId: z.string().optional().describe("Associated trace ID for telemetry correlation."),
        };
    } else if (mcpToolName === 'HITL_STATUS') {
        toolSchema = {}; // No params needed
    } else if (mcpToolName === 'RESPOND_TO_HUMAN') {
        toolSchema = {
            requestId: z.string().describe("The HITL request ID from ASK_HUMAN output."),
            answer: z.string().describe("The human's response to the pending question."),
        };
    } else if (mcpToolName === 'SEARCH_MCP_REGISTRY') {
        toolSchema = {
            capability: z.string().describe("Description of the capability to search for."),
            autoInstall: z.boolean().optional().describe("Whether to auto-install the best match (requires HITL approval)."),
        };
    } else if (mcpToolName === 'TELEMETRY_DASHBOARD') {
        toolSchema = {
            traceId: z.string().optional().describe("Specific trace ID to view in detail."),
            last: z.number().optional().describe("Number of recent traces to show (default: 10)."),
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
          require('fs').appendFileSync('mcp_debug.log', `[MoMo-MCP] EXECUTING TOOL ${mcpToolName} with ARGS: ${JSON.stringify(args)}\n`);
          process.stderr.write(`[MoMo-MCP] EXECUTING TOOL ${mcpToolName} with ARGS: ${JSON.stringify(args)}\n`);
          // If we mapped specific properties, `args` carries them natively inside an object.
          // Fallback legacy if params string is present, otherwise use native args object.
          let executeParams: any = args;
          if (args.params && typeof args.params === 'string') {
              try { executeParams = JSON.parse(args.params); } catch { executeParams = args; }
          }
          
          if (mcpToolName === 'REGEX_VALIDATE' && args.regex && args.target_string) {
              executeParams = {
                  regExString: `{SoRegEx}${args.regex}{EoRegEx}`,
                  flags: '',
                  testCases: [{
                      input: args.target_string,
                      expected: true,
                      type: 'validate'
                  }]
              };
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

  // OUROBOROS Cycle 2: Post-startup boot diagnostics
  // Run in background (non-blocking) to avoid delaying server readiness
  runBootDiagnostics(10, 5)
    .then(report => process.stderr.write(`${report}\n`))
    .catch(err => process.stderr.write(`[Boot Diagnostics] Failed: ${err}\n`));

  // OUROBOROS Cycle 3: Shutdown cascade — flush telemetry on graceful exit
  let shutdownInProgress = false;
  const gracefulShutdown = (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    process.stderr.write(`[MoMo-MCP] Received ${signal}. Flushing telemetry...\n`);
    try {
      const tracer = SwarmTracer.getInstance();
      tracer.shutdown();
    } catch (err) {
      process.stderr.write(`[MoMo-MCP] Tracer shutdown error: ${err}\n`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
