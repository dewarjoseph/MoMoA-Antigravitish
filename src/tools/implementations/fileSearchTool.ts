/**
 * Copyright 2026 Reto Meier
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

import { MultiAgentTool } from '../multiAgentTool.js';
import { findInFiles } from '../../utils/fileAnalysis.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';

/**
 * Implements the File Reader Tool, providing functionality to read file content
 * from an in-memory collection of files (Map). This tool does NOT read from disk.
 */
export const fileSearchTool: MultiAgentTool = {
  displayName: "File Search",
  name: 'FILESEARCH{query: "',

  /**
   * Executes the file reader tool.
   * @param params The parameters for the tool's execution, expecting a 'filename' property.
   * @param context The ToolContext object containing necessary runtime information.
   * @returns A promise that resolves to the file's content or an error message.
   */
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const query = params.query;
    const projectRoot = process.env.MOMO_WORKING_DIR || process.cwd();

    context.sendMessage(JSON.stringify({
      status: "PROGRESS_UPDATES",
      completed_status_message: `Searching filesystem for \`${query}\``,
    }));

    const searchResults = new Set<string>();
    
    try {
        const { exec } = await import('child_process');
        const util = await import('util');
        const execAsync = util.promisify(exec);

        // Try `git grep` first as it strictly ignores .git and binaries efficiently.
        // -i: ignore case, -I: ignore binary files, -n: line numbers
        // We wrap query in quotes safely by escaping existing double quotes.
        const safeQuery = query.replace(/"/g, '\\"');
        
        try {
            const { stdout } = await execAsync(`git grep -i -I -n "${safeQuery}"`, { cwd: projectRoot, maxBuffer: 1024 * 1024 * 10 });
            if (stdout) {
                const lines = stdout.split('\n').filter(l => l.trim().length > 0);
                lines.forEach(l => searchResults.add(l));
            }
        } catch (gitErr: any) {
            // git grep exits with code 1 if no matches exist.
            if (gitErr.code === 1 && !gitErr.stderr) {
                 // Nothing found natively, silent ignore.
            } else {
                 // Fallback to basic fileMap check if git fails directly!
                 // Fallback to basic fileMap check if git fails directly!
                 const allFilenames = [...context.fileMap.keys()];
                 for (const filename of allFilenames) {
                     if (filename.toLowerCase().includes(query.toLowerCase())) {
                          searchResults.add(`[Filename Match]: ${filename}`);
                     }
                     const content = context.fileMap.get(filename);
                     if (content) {
                          const lowerQuery = query.toLowerCase();
                          const lines = content.split('\n');
                          for (let i = 0; i < lines.length; i++) {
                              if (lines[i].toLowerCase().includes(lowerQuery)) {
                                  searchResults.add(`${filename}:${i+1}:${lines[i].trim()}`);
                              }
                          }
                     }
                 }
            }
        }
    } catch (e: any) {
        searchResults.add(`[Error during native search]: ${e.message}`);
    }

    const finalResultArray = Array.from(searchResults).slice(0, 500); // cap to 500 results to avoid massive context explosion
    const replacementString = `---FILE SEARCH RESULTS INTENTIONALLY REMOVED---`;

    let result = finalResultArray.length > 0 ? finalResultArray.join('\n') : `No matches found for your query.`;
    if (searchResults.size > 500) result += `\n... (Capped at 500 results)`;

    context.sendMessage(JSON.stringify({
      status: "PROGRESS_UPDATES",
      completed_status_message: `\`\`\`\n${result.substring(0, 300)}...\n\`\`\``,
    }));

    return {
      result: result,
      transcriptReplacementID: query,
      transcriptReplacementString: replacementString
    };
  },

  /**
   * Extract parameters from the tool invocation string.
   * @param invocation The string used to invoke the tool.
   * @returns The parameter names and corresponding values.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {

    const toolCallEndMarker = '" END_QUERY}';
    const endQueryMarkerIndex = invocation.indexOf(toolCallEndMarker);

    if (endQueryMarkerIndex === -1) {
      return { 
        success: false,
        error: `Unable to search the files because you provided invalid syntax. Please pay close attention to the required syntax before trying again.`
      }
    }

    const extractedQuery = invocation.substring(0, endQueryMarkerIndex);
    if (!extractedQuery.trim()) {
      return { 
        success: false,
        error: `Unable to search the files because the provided query string was empty, which is invalid. Please pay close attention to the required syntax before trying again.`
      }
    }

    return {
      success: true,
      params: {
        query: extractedQuery.trim()
      }
    }
  }
};