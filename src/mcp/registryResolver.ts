/**
 * MCP Registry Resolver — Dynamic server discovery and installation.
 *
 * When the swarm encounters a capability gap, this module searches
 * MCP registries (Smithery.ai, local cache) for compatible servers
 * and generates the configuration needed to hot-plug them.
 *
 * Security: All dynamic installations are gated through HITL for approval.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { McpServerConfig } from './mcpClientManager.js';

// ─── Types ──────────────────────────────────────────────────────────────

/** A registry entry describing an available MCP server */
export interface RegistryEntry {
  /** Server package name (e.g., @modelcontextprotocol/server-github) */
  packageName: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of capabilities */
  description: string;
  /** Capabilities this server provides */
  capabilities: string[];
  /** Install command (e.g., npx -y @server/github) */
  installCommand: string;
  /** Default args */
  defaultArgs: string[];
  /** Required environment variables */
  requiredEnv: string[];
  /** Source registry (smithery, local, manual) */
  source: 'smithery' | 'local' | 'manual';
  /** Confidence score for this match (0-1) */
  matchScore: number;
}

/** Registry configuration */
export interface RegistryConfig {
  /** Smithery.ai API endpoint */
  smitheryUrl: string;
  /** Local registry cache directory */
  localRegistryDir: string;
  /** Whether to search Smithery automatically */
  enableSmithery: boolean;
}

const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  smitheryUrl: 'https://registry.smithery.ai/api/v1',
  localRegistryDir: '.swarm/mcp_registry',
  enableSmithery: true,
};

// ─── Resolver ───────────────────────────────────────────────────────────

export class RegistryResolver {
  private config: RegistryConfig;
  private localRegistry: RegistryEntry[] = [];

  constructor(config?: Partial<RegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.loadLocalRegistry();
  }

  /**
   * Search for MCP servers matching a capability description.
   * Searches local cache first, then Smithery.ai if enabled.
   */
  async searchRegistry(capability: string): Promise<RegistryEntry[]> {
    const results: RegistryEntry[] = [];

    // 1. Search local registry first (instant)
    const localResults = this.searchLocal(capability);
    results.push(...localResults);

    // 2. Search Smithery.ai if enabled
    if (this.config.enableSmithery) {
      try {
        const smitheryResults = await this.searchSmithery(capability);
        results.push(...smitheryResults);
      } catch (err) {
        process.stderr.write(`[Registry] Smithery search failed: ${err}\n`);
      }
    }

    // 3. Deduplicate and sort by match score
    const seen = new Set<string>();
    const deduped = results.filter(entry => {
      if (seen.has(entry.packageName)) return false;
      seen.add(entry.packageName);
      return true;
    });

    return deduped.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Generate the McpServerConfig needed to hot-plug a registry entry.
   */
  resolveToConfig(entry: RegistryEntry): McpServerConfig {
    return {
      command: entry.installCommand.split(' ')[0],
      args: [
        ...entry.installCommand.split(' ').slice(1),
        ...entry.defaultArgs,
      ],
      env: entry.requiredEnv.reduce((acc, envVar) => {
        acc[envVar] = process.env[envVar] || '';
        return acc;
      }, {} as Record<string, string>),
    };
  }

  /**
   * Add a server entry to the local registry cache.
   * Used when the Hive Mind remembers a previously used server.
   */
  cacheEntry(entry: RegistryEntry): void {
    const existing = this.localRegistry.findIndex(
      e => e.packageName === entry.packageName
    );

    if (existing >= 0) {
      this.localRegistry[existing] = entry;
    } else {
      this.localRegistry.push(entry);
    }

    this.persistLocalRegistry();
  }

  /**
   * List all cached server entries.
   */
  getLocalRegistry(): RegistryEntry[] {
    return [...this.localRegistry];
  }

  // ─── Local Search ──────────────────────────────────────────────────────

  private searchLocal(capability: string): RegistryEntry[] {
    const query = capability.toLowerCase();
    const words = query.split(/\s+/);

    return this.localRegistry
      .map(entry => {
        const searchText = `${entry.displayName} ${entry.description} ${entry.capabilities.join(' ')}`.toLowerCase();

        // Simple word-match scoring
        let score = 0;
        for (const word of words) {
          if (searchText.includes(word)) score += 1 / words.length;
        }

        return { ...entry, matchScore: score, source: 'local' as const };
      })
      .filter(entry => entry.matchScore > 0.2);
  }

  // ─── Smithery Search ───────────────────────────────────────────────────

  private async searchSmithery(capability: string): Promise<RegistryEntry[]> {
    try {
      const url = `${this.config.smitheryUrl}/search?q=${encodeURIComponent(capability)}&limit=5`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        process.stderr.write(`[Registry] Smithery returned ${response.status}\n`);
        return [];
      }

      const data = await response.json() as any;
      const servers = data?.servers || data?.results || [];

      return servers.map((server: any) => ({
        packageName: server.qualifiedName || server.name || 'unknown',
        displayName: server.displayName || server.name || 'Unknown Server',
        description: server.description || '',
        capabilities: server.tools?.map((t: any) => t.name) || [],
        installCommand: `npx -y ${server.qualifiedName || server.name}`,
        defaultArgs: [],
        requiredEnv: server.connections?.[0]?.configSchema?.required || [],
        source: 'smithery' as const,
        matchScore: server.score || 0.5,
      }));
    } catch (err) {
      process.stderr.write(`[Registry] Smithery API error: ${err}\n`);
      return [];
    }
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  private getRegistryPath(): string {
    return path.join(this.config.localRegistryDir, 'known_servers.json');
  }

  private loadLocalRegistry(): void {
    try {
      const filePath = this.getRegistryPath();
      if (fs.existsSync(filePath)) {
        this.localRegistry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        process.stderr.write(
          `[Registry] Loaded ${this.localRegistry.length} cached server entries.\n`
        );
      }
    } catch (err) {
      process.stderr.write(`[Registry] Failed to load local registry: ${err}\n`);
      this.localRegistry = [];
    }
  }

  private persistLocalRegistry(): void {
    try {
      fs.mkdirSync(this.config.localRegistryDir, { recursive: true });
      fs.writeFileSync(
        this.getRegistryPath(),
        JSON.stringify(this.localRegistry, null, 2),
        'utf-8'
      );
    } catch (err) {
      process.stderr.write(`[Registry] Failed to persist local registry: ${err}\n`);
    }
  }
}
