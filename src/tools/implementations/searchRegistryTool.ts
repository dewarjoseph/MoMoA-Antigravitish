/**
 * SEARCH_MCP_REGISTRY Tool — Dynamic MCP server discovery and hot-plugging.
 *
 * Searches MCP registries (Smithery.ai, local cache) for servers matching
 * a capability description. Optionally hot-plugs the best match.
 */

import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { RegistryResolver } from '../../mcp/registryResolver.js';

export const searchRegistryTool: MultiAgentTool = {
  displayName: 'Search MCP Registry',
  name: 'SEARCH_MCP_REGISTRY',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const capability = (params.capability as string) || '';
    const autoInstall = (params.autoInstall as boolean) || false;

    if (!capability) {
      return { result: 'Error: "capability" parameter is required.' };
    }

    try {
      const resolver = new RegistryResolver();
      const results = await resolver.searchRegistry(capability);

      if (results.length === 0) {
        return { result: `No MCP servers found matching capability: "${capability}"` };
      }

      let output = `# MCP Registry Search Results\n\n**Query:** "${capability}"\n**Found:** ${results.length} server(s)\n\n`;

      for (const entry of results) {
        output += `### ${entry.displayName}\n`;
        output += `- **Package:** \`${entry.packageName}\`\n`;
        output += `- **Description:** ${entry.description.substring(0, 200)}\n`;
        output += `- **Capabilities:** ${entry.capabilities.slice(0, 5).join(', ')}\n`;
        output += `- **Install:** \`${entry.installCommand}\`\n`;
        output += `- **Source:** ${entry.source}\n`;
        output += `- **Match Score:** ${(entry.matchScore * 100).toFixed(0)}%\n`;
        if (entry.requiredEnv.length > 0) {
          output += `- **Required Env:** ${entry.requiredEnv.join(', ')}\n`;
        }
        output += '\n';
      }

      if (autoInstall && results.length > 0) {
        const best = results[0];
        output += `\n## ⚠️ Auto-Install Requested\n\n`;
        output += `The best match is **${best.displayName}** (\`${best.packageName}\`).\n`;
        output += `**SECURITY NOTE:** Dynamic hot-plugging of unknown servers requires HITL approval.\n`;
        output += `Use the ASK_HUMAN tool to request permission before installing.\n`;

        // Cache the entry in local registry for future reference
        resolver.cacheEntry(best);
      }

      return { result: output };
    } catch (err: any) {
      return { result: `Registry search failed: ${err.message}` };
    }
  },

  async extractParameters(
    invocation: string,
    _context: MultiAgentToolContext
  ): Promise<ToolParsingResult> {
    try {
      return { success: true, params: JSON.parse(invocation.trim()) };
    } catch {
      return { success: true, params: { capability: invocation.trim() } };
    }
  },
};
