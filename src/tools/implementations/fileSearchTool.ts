/**
 * Copyright 2026 Reto Meier & Antigravitish contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MultiAgentTool } from '../multiAgentTool.js';
import { findInFiles } from '../../utils/fileAnalysis.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.swarm',
  '.gemini',
  '.vscode',
  '.idea',
  'target',
  'obj',
  'bin',
]);

const MAX_SEARCH_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit per file

interface SearchMatch {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Recursively search live disk for matching content and filenames.
 */
async function searchLiveDisk(
  rootDir: string,
  query: string,
  maxMatches: number = 100
): Promise<{ contentMatches: SearchMatch[]; nameMatches: string[] }> {
  const contentMatches: SearchMatch[] = [];
  const nameMatches: string[] = [];
  const lowerQuery = query.toLowerCase();

  async function walk(dir: string, depth: number = 0) {
    if (depth > 12 || contentMatches.length >= maxMatches) return;

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (contentMatches.length >= maxMatches) break;

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          await walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

          // Check filename match
          if (entry.name.toLowerCase().includes(lowerQuery) || relativePath.toLowerCase().includes(lowerQuery)) {
            nameMatches.push(relativePath);
          }

          // Check file content match for text/code files
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > MAX_SEARCH_FILE_SIZE || stat.size === 0) continue;

            const content = await fs.promises.readFile(fullPath, 'utf8');
            // Quick check before splitting lines
            if (content.toLowerCase().includes(lowerQuery)) {
              const lines = content.split('\n');
              let fileMatchCount = 0;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(lowerQuery)) {
                  contentMatches.push({
                    file: relativePath,
                    line: i + 1,
                    snippet: lines[i].trim().slice(0, 180),
                  });
                  fileMatchCount++;
                  if (fileMatchCount >= 5 || contentMatches.length >= maxMatches) break;
                }
              }
            }
          } catch {
            // Binary or unreadable file, ignore
          }
        }
      }
    } catch {
      // Permission or inaccessible directory, ignore
    }
  }

  await walk(rootDir);
  return { contentMatches, nameMatches };
}

/**
 * Implements the File Search Tool with live disk traversal and in-memory cache lookup.
 */
export const fileSearchTool: MultiAgentTool = {
  displayName: "File Search",
  name: 'FILESEARCH{query: "',

  /**
   * Executes the file search tool.
   */
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const rawQuery = (params.query || params.search || params.pattern || params.text || '').trim();

    if (!rawQuery) {
      return {
        result: `Error: 'query' parameter is missing or empty for ${this.displayName} tool.`,
      };
    }

    context.sendMessage({
      type: 'PROGRESS_UPDATE',
      message: `Searching filesystem and memory for \`${rawQuery}\`...`,
    });

    const results: string[] = [];
    const matchedFiles = new Set<string>();

    // 1. Search in-memory fileMap
    const memoryMatches = findInFiles(rawQuery, context.fileMap) || [];
    for (const file of memoryMatches) {
      matchedFiles.add(file);
    }

    // 2. Search live filesystem at active workspace directories
    const primaryDir = params.workspace_path || params.dir || process.env.MOMO_WORKING_DIR || (process.cwd().includes('Antigravity IDE') ? path.resolve(__dirname, '../../..') : process.cwd());
    const candidateDirs = [
      path.resolve(primaryDir),
      'C:/Users/Joe/source/MoMoA-Antigravitish',
      'C:/Users/Joe/source/QIS',
    ];
    const uniqueSearchDirs = Array.from(new Set(candidateDirs)).filter(d => fs.existsSync(d));
    const fileToSnippets = new Map<string, Array<{ line: number; snippet: string }>>();
    const allNameMatches: string[] = [];
    let totalContentMatches = 0;

    for (const searchDir of uniqueSearchDirs) {
      const { contentMatches, nameMatches } = await searchLiveDisk(searchDir, rawQuery, 60);

      for (const match of nameMatches) {
        matchedFiles.add(match);
        allNameMatches.push(match);
        if (!context.fileMap.has(match)) {
          context.fileMap.set(match, '');
        }
      }

      for (const match of contentMatches) {
        matchedFiles.add(match.file);
        totalContentMatches++;
        if (!fileToSnippets.has(match.file)) {
          fileToSnippets.set(match.file, []);
        }
        fileToSnippets.get(match.file)!.push({ line: match.line, snippet: match.snippet });

        if (!context.fileMap.has(match.file)) {
          context.fileMap.set(match.file, '');
        }
      }
    }

    // Format output
    if (fileToSnippets.size > 0) {
      results.push(`### Content Matches (${totalContentMatches} matches in ${fileToSnippets.size} files):`);
      for (const [file, snippets] of fileToSnippets.entries()) {
        results.push(`\n📁 **\`${file}\`**`);
        for (const s of snippets) {
          results.push(`  - Line ${s.line}: \`${s.snippet}\``);
        }
      }
    }

    // Add filename-only matches
    const nameOnlyMatches = allNameMatches.filter(f => !fileToSnippets.has(f));
    if (nameOnlyMatches.length > 0) {
      results.push(`\n### Filename Matches (${nameOnlyMatches.length} files):`);
      for (const file of nameOnlyMatches.slice(0, 30)) {
        results.push(`  - 📄 \`${file}\``);
      }
      if (nameOnlyMatches.length > 30) {
        results.push(`  ... and ${nameOnlyMatches.length - 30} more matching filenames.`);
      }
    }

    const outputText = results.length > 0
      ? results.join('\n')
      : `No matches found for query '${rawQuery}' in workspace: ${primaryDir}`;

    context.sendMessage({
      type: 'PROGRESS_UPDATE',
      message: `\`\`\`\n${outputText.slice(0, 500)}\n...\`\`\``,
    });

    return {
      result: outputText,
      transcriptReplacementID: rawQuery,
      transcriptReplacementString: `---FILE SEARCH FOR '${rawQuery}' (${matchedFiles.size} files found)---`,
    };
  },

  /**
   * Extract parameters from tool invocation string or JSON object.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    try {
      const parsed = JSON.parse(invocation.trim());
      const query = parsed.query || parsed.search || parsed.pattern || parsed.text;
      if (query) {
        return { success: true, params: { query: String(query).trim() } };
      }
    } catch {}

    const toolCallEndMarker = '" END_QUERY}';
    const endQueryMarkerIndex = invocation.indexOf(toolCallEndMarker);

    if (endQueryMarkerIndex !== -1) {
      const extractedQuery = invocation.substring(0, endQueryMarkerIndex).trim();
      if (extractedQuery) {
        return { success: true, params: { query: extractedQuery } };
      }
    }

    const raw = invocation.trim().replace(/^\{?["']?query["']?\s*:\s*["']?/, '').replace(/["']?\}?$/, '').trim();
    if (raw) {
      return { success: true, params: { query: raw } };
    }

    return {
      success: false,
      error: `Unable to search files: query string was empty. Provide a query string or JSON object.`,
    };
  },
};
