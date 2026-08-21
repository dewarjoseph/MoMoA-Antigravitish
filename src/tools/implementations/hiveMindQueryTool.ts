/**
 * QUERY_HIVE_MIND Tool — Semantic search across persistent swarm memory
 * with automatic workspace documentation seeding and fallback discovery.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { HiveMind } from '../../memory/hiveMind.js';

async function autoSeedWorkspaceDocs(hiveMind: HiveMind, workspaceRoot: string): Promise<number> {
  let seeded = 0;
  const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.swarm', '.gemini', 'target', 'bin', 'obj']);
  const DOC_EXTS = new Set(['.md', '.txt', '.rst', '.h']);

  async function walk(dir: string, depth: number = 0) {
    if (depth > 6 || seeded >= 20) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (seeded >= 20) break;
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          await walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const baseName = entry.name.toLowerCase();
          if (DOC_EXTS.has(ext) || baseName.startsWith('readme') || baseName.startsWith('architecture') || baseName.startsWith('config')) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
            try {
              const stat = await fs.promises.stat(fullPath);
              if (stat.size > 2 * 1024 * 1024 || stat.size === 0) continue;
              const content = await fs.promises.readFile(fullPath, 'utf8');
              const excerpt = content.slice(0, 1000).trim();
              if (excerpt) {
                await hiveMind.write(
                  `Project architecture & documentation file: ${relativePath}`,
                  `Indexed repository file ${relativePath} into Hive Mind memory bank`,
                  `File summary:\n${excerpt}`,
                  {
                    tags: ['workspace-doc', ext.slice(1) || 'doc', path.basename(relativePath, ext)],
                    confidence: 0.85,
                  }
                );
                seeded++;
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  await walk(workspaceRoot);
  return seeded;
}

async function searchWorkspaceDocsFallback(query: string, workspaceRoot: string): Promise<string[]> {
  const matches: string[] = [];
  const rawTerms = query
    .replace(/[^\w\s\.-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);

  const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.swarm', '.gemini', 'target', 'bin', 'obj']);

  async function walk(dir: string, depth: number = 0) {
    if (depth > 6 || matches.length >= 10) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= 10) break;
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          await walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.md', '.h', '.txt', '.c', '.vhd', '.json'].includes(ext)) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
            try {
              const stat = await fs.promises.stat(fullPath);
              if (stat.size > 2 * 1024 * 1024 || stat.size === 0) continue;
              const content = await fs.promises.readFile(fullPath, 'utf8');
              const lowerContent = content.toLowerCase();
              if (rawTerms.some(t => lowerContent.includes(t.toLowerCase()))) {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length && matches.length < 10; i++) {
                  if (rawTerms.some(t => lines[i].toLowerCase().includes(t.toLowerCase()))) {
                    const start = Math.max(0, i - 1);
                    const end = Math.min(lines.length - 1, i + 2);
                    matches.push(`📄 **\`${relativePath}\`** (Line ${i + 1}):\n\`\`\`\n${lines.slice(start, end + 1).join('\n')}\n\`\`\``);
                    i = end;
                  }
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  await walk(workspaceRoot);
  return matches;
}

export const hiveMindQueryTool: MultiAgentTool = {
  displayName: 'Hive Mind Query',
  name: 'QUERY_HIVE_MIND',

  async execute(
    params: Record<string, unknown>,
    _context: MultiAgentToolContext
  ): Promise<MultiAgentToolResult> {
    const rawQuery = (params.query || params.search || params.text || (typeof params === 'string' ? params : '')) as string;
    const query = String(rawQuery).trim();
    const topK = (params.topK as number) || 5;
    const tags = (params.tags as string[]) || undefined;

    if (!query) {
      return { result: 'Error: "query" parameter is required.' };
    }

    try {
      const workspaceRoot = process.env.MOMO_WORKING_DIR || process.cwd();
      const hiveMind = HiveMind.getInstance();

      // If Hive Mind is completely empty, auto-seed key docs from workspace
      if (hiveMind.getMemoryCount() === 0) {
        await autoSeedWorkspaceDocs(hiveMind, workspaceRoot);
      }

      let results = await hiveMind.query(query, topK, tags);

      // If still no results, attempt auto-seed if memory count is low
      if (results.length === 0 && hiveMind.getMemoryCount() < 10) {
        await autoSeedWorkspaceDocs(hiveMind, workspaceRoot);
        results = await hiveMind.query(query, topK, tags);
      }

      if (results.length > 0) {
        const formatted = results.map((r, i) => {
          const t = r.triplet;
          return `### Memory #${i + 1} (Similarity: ${(r.similarity * 100).toFixed(1)}%, Confidence: ${(t.confidence * 100).toFixed(0)}%)
**Context:** ${t.context.substring(0, 400)}
**Action:** ${t.action.substring(0, 400)}
**Outcome:** ${t.outcome.substring(0, 400)}
**Tags:** ${t.tags.join(', ') || 'none'}
**Gold Standard:** ${t.isGoldStandard ? '⭐ Yes' : 'No'}
**Hit Count:** ${t.hitCount}`;
        });

        const stats = hiveMind.getStats();

        return {
          result: `# Hive Mind Query Results\n\n**Query:** "${query.substring(0, 100)}"\n**Results:** ${results.length} of ${stats.total} total memories\n\n${formatted.join('\n\n---\n\n')}`,
        };
      }

      // Fallback: search workspace documentation and code directly
      const fallbackDocs = await searchWorkspaceDocsFallback(query, workspaceRoot);
      if (fallbackDocs.length > 0) {
        return {
          result: `# Hive Mind Query\n\nNo stored swarm memory triplets matched query: "${query}".\n\n### Grounded Workspace Documentation & Definitions Found:\n\n${fallbackDocs.join('\n\n')}`,
        };
      }

      return {
        result: `No relevant memories found in the Hive Mind for query: "${query}" in workspace (${workspaceRoot}).`,
      };
    } catch (err: any) {
      return { result: `Hive Mind query failed: ${err.message}` };
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
      return { success: true, params: { query: invocation.trim() } };
    }
  },
};
