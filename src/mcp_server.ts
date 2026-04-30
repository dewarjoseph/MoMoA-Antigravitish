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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Console } from 'node:console';

// Redirect global console completely to stderr, protecting MCP stdio transport JSON-RPC.
global.console = new Console(process.stderr, process.stderr);

// Import tool registry
import { getToolNames, getTool, registerDynamicMcpTools, startHotReloader } from './tools/multiAgentToolRegistry.js';
import type { MultiAgentToolContext, MultiAgentToolResult } from './momoa_core/types.js';
import { GeminiClient } from './services/geminiClient.js';
import { ApiPolicyManager } from './services/apiPolicyManager.js';
import { TranscriptManager } from './services/transcriptManager.js';
import { ConcreteInfrastructureContext } from './services/infrastructure.js';
import type { UserSecrets } from './shared/model.js';
import { scanLocalDirectory } from './utils/localScanner.js';
import { McpClientManager } from './mcp/mcpClientManager.js';
import { getMcpToolSchema } from './mcp/toolSchemas.js';
import { runBootDiagnostics } from './telemetry/bootDiagnostics.js';
import { SwarmTracer } from './telemetry/tracer.js';
import { processRegistry } from './utils/processRegistry.js';

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
      } catch {
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
): Promise<{ server: McpServer; mcpManager?: McpClientManager }> {
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

    const toolSchema = getMcpToolSchema(mcpToolName, tool);

    server.tool(
      mcpToolName,
      `[${tool.displayName}] native overseer binding`,
      toolSchema,
      async (args) => {
        try {
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
          
          const activeTool = getTool(toolName) || tool;
          const result: MultiAgentToolResult = await activeTool.execute(executeParams, context);
          return {
            content: [{ type: 'text' as const, text: result.result }],
          };
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ 
              type: 'text' as const, 
              text: JSON.stringify({
                error: true,
                message: errorMsg,
                suggestion: "Check parameter syntax and run LINT or SEARCH_MCP_REGISTRY if the capability appears missing."
              })
            }],
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

  return { server, mcpManager };
}



/**
 * Start the MCP server on stdio transport.
 */
export async function startMcpServer(
  projectDir: string,
  mcpConfigPath?: string
): Promise<void> {
  const { server, mcpManager } = await createMcpServer(projectDir, mcpConfigPath);
  const transport = new StdioServerTransport();

  process.stderr.write('[MoMo-MCP] Starting MCP server on stdio...\n');
  process.stderr.write(`[MoMo-MCP] Project directory: ${projectDir}\n`);
  process.stderr.write(`[MoMo-MCP] Registered tools: ${getToolNames().join(', ')}\n`);

  startHotReloader(); // Initialize tool fs.watch

  await server.connect(transport);
  process.stderr.write('[MoMo-MCP] MCP server connected and ready.\n');

  // OUROBOROS Cycle 2: Post-startup boot diagnostics
  // Run in background (non-blocking) to avoid delaying server readiness
  runBootDiagnostics(10, 5)
    .then(report => process.stderr.write(`${report}\n`))
    .catch(err => process.stderr.write(`[Boot Diagnostics] Failed: ${err}\n`));

  // OUROBOROS Cycle 3: Shutdown cascade — flush telemetry on graceful exit
  let shutdownInProgress = false;
  const gracefulShutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    process.stderr.write(`[MoMo-MCP] Received ${signal}. Flushing telemetry and shutting down child servers...\n`);

        if (mcpManager) {
      await mcpManager.shutdown().catch(err => process.stderr.write(`[MoMo-MCP] manager shutdown error: ${err}\n`));
    }

    // Shutdown the process registry to terminate all child processes
    await processRegistry.shutdown().catch(err => process.stderr.write(`[MoMo-MCP] ProcessRegistry shutdown error: ${err}\n`));

    try {
      const tracer = SwarmTracer.getInstance();
      await tracer.shutdown(); // Await the tracer shutdown
    } catch (err) {
      process.stderr.write(`[MoMo-MCP] Tracer shutdown error: ${err}\n`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.stdin.on('close', () => gracefulShutdown('STDIN_CLOSE'));
  process.stdin.on('end', () => gracefulShutdown('STDIN_END'));
}
