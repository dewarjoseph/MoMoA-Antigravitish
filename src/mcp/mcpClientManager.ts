/**
 * McpClientManager — Dynamic Universal MCP Client & Hot-Plugging Engine
 *
 * Replaces hardcoded MCP server registrations with a configuration-driven
 * approach. Reads `mcp_servers.json` (Claude Desktop schema), spawns and
 * pools persistent connections to downstream MCP servers, and dynamically
 * registers their tools into MoMo's tool registry.
 *
 * Cross-platform spawn hardening inherits the proven `shell: true` +
 * Windows `.cmd` resolution pattern from CodeRunnerTool/OptimizerTool.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SwarmTracer } from '../telemetry/tracer.js';
import { SpanKind, SpanStatus } from '../telemetry/types.js';
import { measurePayload } from '../telemetry/tokenAccounting.js';
import type { TraceContext } from '../telemetry/types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Schema for a single MCP server entry (mirrors Claude Desktop / Antigravity config) */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Top-level config file schema */
export interface McpServersConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/** Schema for a discovered tool from a downstream MCP server */
export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Internal connection state for a single MCP server */
export interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  config: McpServerConfig;
  tools: Map<string, DiscoveredMcpTool>;
  connected: boolean;
}

// ─── Manager ────────────────────────────────────────────────────────────────

export class McpClientManager {
  private connections: Map<string, McpConnection> = new Map();
  private configPath: string;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onToolsChanged: (() => Promise<void>) | null = null;
  private _isInitialized = false;
  private _isShuttingDown = false;

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
  }

  /** Whether the manager has completed initial configuration loading */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /** All active server names */
  get serverNames(): string[] {
    return [...this.connections.keys()];
  }

  /** Get all discovered tools across all servers, prefixed with server name */
  getAllTools(): Map<string, { serverName: string; tool: DiscoveredMcpTool }> {
    const result = new Map<string, { serverName: string; tool: DiscoveredMcpTool }>();
    for (const [serverName, conn] of this.connections) {
      if (!conn.connected) continue;
      for (const [toolName, toolSchema] of conn.tools) {
        // Prefix with server name to avoid collisions across servers
        const qualifiedName = `${serverName}__${toolName}`;
        result.set(qualifiedName, { serverName, tool: toolSchema });
      }
    }
    return result;
  }

  /**
   * Registers a callback invoked whenever the tool landscape changes
   * (server connected/disconnected, config hot-reloaded).
   */
  setOnToolsChanged(handler: () => Promise<void>): void {
    this.onToolsChanged = handler;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize: read config, connect to all servers, start file watcher.
   */
  async initFromConfig(): Promise<void> {
    const config = this.readConfigFile();
    if (!config) {
      process.stderr.write(`[MCP-Manager] No config found at ${this.configPath}, starting with zero MCP servers.\n`);
      this._isInitialized = true;
      return;
    }

    const serverEntries = Object.entries(config.mcpServers || {});
    process.stderr.write(`[MCP-Manager] Loading ${serverEntries.length} MCP server(s) from config.\n`);

    // Connect to each server in parallel
    const results = await Promise.allSettled(
      serverEntries.map(([name, cfg]) => this.connectServer(name, cfg))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const name = serverEntries[i][0];
      if (result.status === 'rejected') {
        process.stderr.write(`[MCP-Manager] Failed to connect to '${name}': ${result.reason}\n`);
      }
    }

    this._isInitialized = true;

    // Start watching for config changes (hot-reload)
    this.startWatcher();

    if (this.onToolsChanged) {
      await this.onToolsChanged();
    }
  }

  /**
   * Gracefully shut down all connections and stop the file watcher.
   */
  async shutdown(): Promise<void> {
    this._isShuttingDown = true;
    this.stopWatcher();
    const disconnects = [...this.connections.keys()].map(name =>
      this.disconnectServer(name).catch(err =>
        process.stderr.write(`[MCP-Manager] Error disconnecting '${name}': ${err}\n`)
      )
    );
    await Promise.all(disconnects);
    process.stderr.write('[MCP-Manager] All connections shut down.\n');
  }

  // ─── Connection Management ──────────────────────────────────────────────

  /**
   * Connect to a single MCP server and discover its tools.
   */
  async connectServer(name: string, config: McpServerConfig): Promise<void> {
    // Disconnect existing connection if any
    if (this.connections.has(name)) {
      await this.disconnectServer(name);
    }

    process.stderr.write(`[MCP-Manager] Connecting to '${name}': ${config.command} ${(config.args || []).join(' ')}\n`);

    // Cross-platform command resolution
    const resolvedCommand = this.resolveCommand(config.command);

    // Build environment: merge process.env + server-specific env
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(config.env || {}),
    };

    const transport = new StdioClientTransport({
      command: resolvedCommand,
      args: config.args || [],
      env,
    });

    const client = new Client(
      { name: 'momo-overseer-dynamic', version: '2.0.0' },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
    } catch (err) {
      throw new Error(`Connection failed for '${name}': ${err}`);
    }

    // Discover tools
    const tools = new Map<string, DiscoveredMcpTool>();
    try {
      const toolList = await client.listTools();
      if (toolList?.tools) {
        for (const t of toolList.tools) {
          tools.set(t.name, {
            name: t.name,
            description: t.description || `Tool from ${name}`,
            inputSchema: (t.inputSchema as Record<string, unknown>) || {},
          });
        }
      }
      process.stderr.write(`[MCP-Manager] '${name}': discovered ${tools.size} tool(s): ${[...tools.keys()].join(', ')}\n`);
    } catch (err) {
      process.stderr.write(`[MCP-Manager] '${name}': tools/list failed (${err}), connected with zero tools.\n`);
    }

    this.connections.set(name, {
      client,
      transport,
      config,
      tools,
      connected: true,
    });
  }

  /**
   * Disconnect and clean up a single server connection.
   */
  async disconnectServer(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    conn.connected = false;
    try {
      await conn.transport.close();
    } catch (err) {
      // Transport may already be closed
    }
    this.connections.delete(name);
    process.stderr.write(`[MCP-Manager] Disconnected '${name}'.\n`);
  }

  // ─── Tool / Resource / Prompt Proxy ─────────────────────────────────────

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    traceContext?: TraceContext
  ): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.connected) {
      throw new Error(`MCP server '${serverName}' is not connected.`);
    }

    // --- Glass Swarm Telemetry: create child span ---
    let span;
    try {
      const tracer = SwarmTracer.getInstance();
      if (traceContext) {
        span = tracer.startSpan(traceContext, `${serverName}/${toolName}`, SpanKind.MCP_CALL, {
          'mcp.server': serverName,
          'mcp.tool': toolName,
        });
        const requestTokens = measurePayload(args);
        span.tokensSent = requestTokens;
      }
    } catch {
      // Telemetry is non-critical; proceed without it
    }

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });

      const typedContent = result.content as Array<{ type: string; text?: string }>;
      const output = typedContent
        .map(c => (c.type === 'text' ? c.text : '[Unsupported Artifact Content]'))
        .join('\n');

      // --- Glass Swarm Telemetry: end span ---
      if (span) {
        try {
          const tracer = SwarmTracer.getInstance();
          span.tokensReceived = measurePayload(output);
          tracer.endSpan(span, SpanStatus.OK);
        } catch { /* non-critical */ }
      }

      return output;
    } catch (err) {
      // --- Glass Swarm Telemetry: record error ---
      if (span) {
        try {
          const tracer = SwarmTracer.getInstance();
          tracer.endSpan(span, SpanStatus.ERROR, {
            'error': String(err),
          });
        } catch { /* non-critical */ }
      }
      throw err;
    }
  }

  /**
   * List resources from a specific MCP server.
   */
  async listResources(serverName: string): Promise<Array<{ uri: string; name: string; description?: string }>> {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.connected) {
      throw new Error(`MCP server '${serverName}' is not connected.`);
    }

    try {
      const result = await conn.client.listResources();
      return (result?.resources || []).map(r => ({
        uri: r.uri,
        name: r.name || r.uri,
        description: r.description,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Read a specific resource from a specific MCP server.
   */
  async readResource(serverName: string, uri: string): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.connected) {
      throw new Error(`MCP server '${serverName}' is not connected.`);
    }

    const result = await conn.client.readResource({ uri });
    const contents = result?.contents || [];
    return contents
      .map((c: any) => {
        if (c.text) return c.text;
        if (c.blob) return `[Binary resource: ${c.mimeType || 'unknown'}]`;
        return '[Empty resource]';
      })
      .join('\n');
  }

  /**
   * List prompts from a specific MCP server.
   */
  async listPrompts(serverName: string): Promise<Array<{ name: string; description?: string }>> {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.connected) {
      throw new Error(`MCP server '${serverName}' is not connected.`);
    }

    try {
      const result = await conn.client.listPrompts();
      return (result?.prompts || []).map(p => ({
        name: p.name,
        description: p.description,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get a specific prompt from a specific MCP server.
   */
  async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.connected) {
      throw new Error(`MCP server '${serverName}' is not connected.`);
    }

    const result = await conn.client.getPrompt({
      name: promptName,
      arguments: args,
    });

    const messages = result?.messages || [];
    return messages
      .map((m: any) => {
        if (m.content?.text) return m.content.text;
        if (typeof m.content === 'string') return m.content;
        return JSON.stringify(m.content);
      })
      .join('\n\n');
  }

  /**
   * List all resources across ALL connected servers.
   */
  async listAllResources(): Promise<Array<{ server: string; uri: string; name: string; description?: string }>> {
    const all: Array<{ server: string; uri: string; name: string; description?: string }> = [];
    for (const [serverName, conn] of this.connections) {
      if (!conn.connected) continue;
      try {
        const resources = await this.listResources(serverName);
        for (const r of resources) {
          all.push({ server: serverName, ...r });
        }
      } catch {
        // Skip servers that don't support resources
      }
    }
    return all;
  }

  /**
   * List all prompts across ALL connected servers.
   */
  async listAllPrompts(): Promise<Array<{ server: string; name: string; description?: string }>> {
    const all: Array<{ server: string; name: string; description?: string }> = [];
    for (const [serverName, conn] of this.connections) {
      if (!conn.connected) continue;
      try {
        const prompts = await this.listPrompts(serverName);
        for (const p of prompts) {
          all.push({ server: serverName, ...p });
        }
      } catch {
        // Skip servers that don't support prompts
      }
    }
    return all;
  }

  // ─── Hot-Reload ─────────────────────────────────────────────────────────

  /**
   * Reload config from disk and reconcile connections.
   */
  async reload(): Promise<void> {
    if (this._isShuttingDown) return;
    const config = this.readConfigFile();
    if (!config) {
      process.stderr.write('[MCP-Manager] Config file not found during reload, disconnecting all.\n');
      await this.shutdown();
      return;
    }

    const newServerNames = new Set(Object.keys(config.mcpServers || {}));
    const existingServerNames = new Set(this.connections.keys());

    // Disconnect servers removed from config
    for (const name of existingServerNames) {
      if (!newServerNames.has(name)) {
        process.stderr.write(`[MCP-Manager] Hot-unplug: removing '${name}'.\n`);
        await this.disconnectServer(name);
      }
    }

    // Connect new servers or reconnect changed ones
    for (const [name, cfg] of Object.entries(config.mcpServers || {})) {
      const existing = this.connections.get(name);
      const configChanged = existing && JSON.stringify(existing.config) !== JSON.stringify(cfg);

      if (!existing || configChanged) {
        process.stderr.write(`[MCP-Manager] Hot-plug: ${existing ? 'reconnecting' : 'adding'} '${name}'.\n`);
        try {
          await this.connectServer(name, cfg);
        } catch (err) {
          process.stderr.write(`[MCP-Manager] Hot-plug failed for '${name}': ${err}\n`);
        }
      }
    }

    if (this.onToolsChanged) {
      await this.onToolsChanged();
    }
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  private readConfigFile(): McpServersConfigFile | null {
    try {
      if (!fs.existsSync(this.configPath)) return null;
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw) as McpServersConfigFile;
    } catch (err) {
      process.stderr.write(`[MCP-Manager] Error reading config: ${err}\n`);
      return null;
    }
  }

  /**
   * Resolve a command for cross-platform execution.
   * On Windows, npx/node commands need .cmd extension resolution.
   */
  private resolveCommand(command: string): string {
    if (os.platform() !== 'win32') return command;

    // On Windows, append .cmd for known Node-based launchers
    const cmdBinaries = ['npx', 'node', 'npm', 'tsx', 'pnpm', 'yarn', 'bunx'];
    const baseName = path.basename(command).toLowerCase();

    if (cmdBinaries.includes(baseName) && !baseName.endsWith('.cmd')) {
      return `${command}.cmd`;
    }

    return command;
  }

  private startWatcher(): void {
    if (this.watcher) return;

    const configDir = path.dirname(this.configPath);
    const configFile = path.basename(this.configPath);

    // Ensure the directory exists before watching
    if (!fs.existsSync(configDir)) {
      process.stderr.write(`[MCP-Manager] Config directory does not exist, skipping watcher: ${configDir}\n`);
      return;
    }

    try {
      this.watcher = fs.watch(configDir, (eventType, filename) => {
        if (filename !== configFile) return;

        // Debounce: wait 500ms after last change (editors often write multiple times)
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          process.stderr.write('[MCP-Manager] Config file changed, hot-reloading...\n');
          this.reload().catch(err =>
            process.stderr.write(`[MCP-Manager] Hot-reload error: ${err}\n`)
          );
        }, 500);
      });

      process.stderr.write(`[MCP-Manager] Watching for config changes: ${this.configPath}\n`);
    } catch (err) {
      process.stderr.write(`[MCP-Manager] Failed to start watcher: ${err}\n`);
    }
  }

  private stopWatcher(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // ─── Dynamic Hot-Plugging ──────────────────────────────────────────────

  /**
   * Hot-plug a new MCP server mid-session.
   * Spawns the server, connects, discovers tools, and notifies the registry.
   */
  async hotPlugServer(name: string, config: McpServerConfig): Promise<string[]> {
    // Disconnect if already connected
    if (this.connections.has(name)) {
      await this.disconnectServer(name);
    }

    process.stderr.write(`[MCP-Manager] Hot-plugging server '${name}'...\n`);
    await this.connectServer(name, config);

    const conn = this.connections.get(name);
    if (!conn) {
      throw new Error(`Failed to hot-plug server '${name}'`);
    }

    const toolNames = [...conn.tools.keys()];
    process.stderr.write(`[MCP-Manager] Hot-plug complete: '${name}' with ${toolNames.length} tool(s)\n`);

    // Notify the onToolsChanged callback if registered
    if (this.onToolsChanged) {
      this.onToolsChanged();
    }

    return toolNames;
  }

  /**
   * Hot-unplug an MCP server mid-session.
   * Gracefully disconnects and removes all tools from the pool.
   */
  async hotUnplugServer(name: string): Promise<void> {
    process.stderr.write(`[MCP-Manager] Hot-unplugging server '${name}'...\n`);
    await this.disconnectServer(name);

    // Notify the onToolsChanged callback
    if (this.onToolsChanged) {
      this.onToolsChanged();
    }
  }

  /**
   * Check if a server is currently connected and healthy.
   */
  isServerConnected(name: string): boolean {
    const conn = this.connections.get(name);
    return conn?.connected ?? false;
  }
}
