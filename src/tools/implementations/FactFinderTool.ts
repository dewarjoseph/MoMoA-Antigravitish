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
import { addFAQ } from '../../utils/faqs.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolExecutionEnvironmentType, ToolParsingResult } from '../../momoa_core/types.js';
import { DEFAULT_GEMINI_FLASH_MODEL, DEFAULT_GEMINI_LITE_MODEL, DEFAULT_GEMINI_PRO_MODEL } from '../../config/models.js';
import { removeBacktickFences } from '../../utils/markdownUtils.js';
import { getAssetString, getToolPreamblePrompt, replaceRuntimePlaceholders } from '../../services/promptManager.js';
import { TranscriptManager } from '../../services/transcriptManager.js';
import { Part } from '@google/genai';
import { ExecutionRequest } from '../../services/executionProvider.js';
import { LocalExecutionProvider } from '../../services/executionProviders/localExecutionProvider.js';

/**
 * Helper function to fetch content from a URL and summarize it using an LLM.
 */
async function fetchWebInfo(
  url: string,
  question: string,
  context: MultiAgentToolContext
): Promise<string> {
  const webSummaryModel = DEFAULT_GEMINI_FLASH_MODEL;

  let result = `The result from the Internet Lookup tool is:\n`;
 
  try {
    const response = await fetch(url, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
 
    const rawData = await response.text();

    const data = await context.multiAgentGeminiClient.trimToTokenLimit(webSummaryModel, rawData, 0.8);
 
    const request =
`The following text has been obtained from ${url}. Please review it and provide a well formatted short summary that answers the question '${question}' as well as possible given the text available. 

If you're unsure you should say so, it's important that you don't give a false sense of confidence if you're not sure. If the answer is ambiguous and there are likely multiple different answers you should be clear about that If the available text is unrelated to the question, or doesn't provide helpful information then just respond saying 'This webpage doesn't have useful information to answer this question.'

CRITICAL: If the content appears to be a raw data file, source code, or a long list (e.g. word lists, datasets) that is truncated: 
 1. Do NOT try to summarize the content itself.
 2. You MUST explicitly output: "**Target URL:** ${url}".
 3. State clearly that this file contains the requested data and must be downloaded separately.

If the information is coming from the Wikipedia API, each of the "title" elements is the name of a Wikipedia page. If (and only if) the result includes the name of a Wikipedia page that would provide a better answer, you can say that in your response and provide the page title but you MUST NOT do that if the page title isn't CLEARLY and DIRECTLY relevant to the question you're answering.

Here is the text from the website:
${data}`;
 
    const webSummary = (await context.multiAgentGeminiClient.sendOneShotMessage(
      request,
      { model: webSummaryModel, signal: context.signal }
    ))?.text || '';
    
    result += removeBacktickFences(webSummary).trim();
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    result = `It was unable to retrieve any information from ${url} because ${errorMessage}`;
  }
 
  return result;
}

import * as fs from 'node:fs';
import * as path from 'node:path';

async function localLookup(question: string, context: MultiAgentToolContext): Promise<string> {
  context.sendMessage({
    type: "PROGRESS_UPDATE",
    message: `Searching local codebase and documentation for facts relevant to: "${question.slice(0, 80)}"`,
  });

  const workspaceRoot = process.env.MOMO_WORKING_DIR || process.cwd();
  
  // 1. Extract alphanumeric search terms (>= 3 chars) from question
  const stopWords = new Set(['what', 'when', 'where', 'which', 'about', 'explain', 'tell', 'show', 'find', 'how', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'does', 'have', 'been']);
  const rawTerms = question
    .replace(/[^\w\s\.-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !stopWords.has(t.toLowerCase()));

  const matchedSnippets: Array<{ file: string; line: number; snippet: string }> = [];
  const matchedDocs: Array<{ file: string; excerpt: string }> = [];

  const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.swarm', '.gemini', 'target', 'bin', 'obj']);
  const CODE_EXTS = new Set(['.c', '.h', '.cpp', '.hpp', '.vhd', '.vhdl', '.s', '.asm', '.py', '.ts', '.js', '.json', '.md', '.txt', '.ld', '.inc', '.rsc']);

  async function walk(dir: string, depth: number = 0) {
    if (depth > 12 || matchedSnippets.length >= 40) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matchedSnippets.length >= 40) break;
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          await walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!CODE_EXTS.has(ext)) continue;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > 5 * 1024 * 1024 || stat.size === 0) continue;

            const content = await fs.promises.readFile(fullPath, 'utf8');
            const lowerContent = content.toLowerCase();

            // Check if any search terms match
            const matchingTerms = rawTerms.filter(term => lowerContent.includes(term.toLowerCase()));
            if (matchingTerms.length > 0) {
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && matchedSnippets.length < 40; i++) {
                const lineLower = lines[i].toLowerCase();
                if (matchingTerms.some(term => lineLower.includes(term.toLowerCase()))) {
                  const startLine = Math.max(0, i - 2);
                  const endLine = Math.min(lines.length - 1, i + 3);
                  const excerpt = lines.slice(startLine, endLine + 1).join('\n');
                  matchedSnippets.push({
                    file: relativePath,
                    line: i + 1,
                    snippet: excerpt.slice(0, 600),
                  });
                  i = endLine; // skip ahead to avoid overlapping windows
                }
              }

              if (ext === '.md' || ext === '.h' || ext === '.vhdl' || ext === '.vhd') {
                matchedDocs.push({
                  file: relativePath,
                  excerpt: content.slice(0, 1500),
                });
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  await walk(workspaceRoot);

  if (matchedSnippets.length === 0 && matchedDocs.length === 0) {
    return "No directly matching definitions or documentation found in local codebase.";
  }

  // Synthesize local facts using Gemini Flash
  const contextSections = [
    `## Relevant Local Code Snippets (${matchedSnippets.length} matches across workspace):`,
    ...matchedSnippets.slice(0, 20).map(m => `### File: \`${m.file}\` (around line ${m.line})\n\`\`\`\n${m.snippet}\n\`\`\``),
  ];

  if (matchedDocs.length > 0) {
    contextSections.push(`\n## Relevant Document/Header Excerpts:\n` + matchedDocs.slice(0, 4).map(d => `### \`${d.file}\`\n\`\`\`\n${d.excerpt}\n\`\`\``).join('\n'));
  }

  const prompt = `You are an expert engineer inspecting a local embedded systems / hardware / software repository.
Answer the following question directly and factually using ONLY the provided local codebase and document excerpts.
If the information is clearly specified in the local files (e.g. struct layouts, RAM mappings, register addresses, memory sizes, VHDL entity ports), state it with exact references to the filenames and lines.
If the excerpts do not contain enough info, state clearly what is found and what is missing.

Question: ${question}

${contextSections.join('\n\n')}`;

  try {
    const summaryResponse = await context.multiAgentGeminiClient.sendOneShotMessage(
      prompt,
      { model: DEFAULT_GEMINI_FLASH_MODEL, signal: context.signal }
    );
    const text = summaryResponse?.text || '';
    return removeBacktickFences(text).trim();
  } catch (err: any) {
    return contextSections.join('\n\n').slice(0, 3000);
  }
}
 
/**
 * Implements the Fact Finder Tool, which consolidates information from project files (Docs)
 * and external web searches (Internet Lookup) to answer a question.
 */
export const factFinderTool: MultiAgentTool = {
  displayName: "Fact Finder",
  name: 'FACTFINDER',
 
  async execute(params: Record<string, string>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const question = params.question || params.query || params.prompt || params.text || (typeof params === 'string' ? params : JSON.stringify(params));
    const toolPrefix = await getAssetString('tool-prefix');
 
    // Consistent logging helper
    const updateLog = async (message: string, updateOverseerLog: boolean = true) => {
      context.sendMessage(JSON.stringify({
        status: 'WORK_LOG',
        message: message,
      }));
      if (updateOverseerLog) context.overseer?.addLog(message);
    };

    await updateLog(`${this.displayName} Invoked for question: ${question}`);
 
    let internetSearchResult = "Internet Search Provided No Useful Results";
 
    // --- 2. Internet Search Part ---
    try {
      context.sendMessage({
        type: 'PROGRESS_UPDATE',
        message: `Performing multi-turn Internet Search.`,
      });

      const internetLookupToolString = 
`You are an Internet search expert that can use a tool to look up information on the Internet. This is generally limited to URLs that represent APIs that don't require any authentication, and many websites won't be accessible to you. If you try to access a website and get a response that the Fetch Failed you should assume it's because you don't have permission to see it and just accept that you can't see it. Requests for internet lookups require both a URL to look at, and a question you want to get answered from that page.
    
**Use the following tool syntax:**
${toolPrefix}INTERNET/LOOKUP{Full URL,Question you want answered}

You MUST specify both a URL and a question to answer.

**Guidance:**
You can try any website, but one useful site is Wikipedia, which can help you verify factual information. There are two ways to access information from Wikipedia. The first is using the search API URL, which will provide a brief summary from any Wikipedia page that matches the search term. This is the format of the URL to search Wikipedia:
https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&list=search&srsearch=SEARCHTERM

If you know the specific page from Wikipedia you want to look at, the format of the URL to see a particular Wikipedia page is:
https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&prop=revisions&rvprop=content&titles=PAGENAME

You must use the Internet Lookup to try and get factual answers to the question you've been asked to answer. Don't limit yourself to Wikipedia, and NEVER rely on your own knowledge or intuition, you must only provide information based on Internet Lookup results. That will mean providing different questions and / or different websites with different URLs. When you are confident you have a good answer, or that you can't get a good answer, use the ${toolPrefix}RETURN keyword, followed by your best answer to the question based on the Internet Lookup results. Only your response *after* the RETURN keyword will be returned, so make sure that all relevant information is AFTER that return keyword in your response.

It's important that if you can't find useful results that answer your question you simply respond by saying 'Internet Search provided no useful additional context'. Do not speculate on how the information would best be obtained.

**Special Instruction for Files/Datasets:**
If the user asks for a specific file, dataset, or list (e.g., "Wordle word list"), your primary goal is to find the **direct URL** to the raw text or data file.
  1. Search for terms like "raw", "githubusercontent", "txt", "json", or "csv".
  2. Once you find a promising URL, verify it using ${toolPrefix}INTERNET/LOOKUP.
  3. If the lookup confirms it is the correct data, STOP and return that URL as the answer.

**Question to be answered:**
${question}`;
 
      const internetSearchChat = new TranscriptManager({ context: context.infrastructureContext });
      internetSearchChat.addEntry('user', internetLookupToolString);
 
      const lookupRegex = new RegExp(`${toolPrefix}INTERNET/LOOKUP\\{(.*?)\\}`, 's');
      const returnRegex = new RegExp(`${toolPrefix}RETURN`, 's');
 
      const maxTurns = 10;
      let turns = 0;
      let internetSearchIsDone = false;
 
      while (!internetSearchIsDone && turns < maxTurns) {
        const llmResponse = await context.multiAgentGeminiClient.sendTranscriptMessage(
          internetSearchChat,
          { model: DEFAULT_GEMINI_FLASH_MODEL, signal: context.signal }
        );
        let responseText = llmResponse.text || '';
        internetSearchChat.addEntry('model', responseText);
        
        await updateLog(`# Internet search tool\n${responseText}`, false);
 
        let matched = false;
 
        // 1. Check for RETURN tool
        if (returnRegex.test(responseText)) {
          internetSearchIsDone = true;
          internetSearchResult = responseText.split(returnRegex)[1].trim();
          matched = true;
        }
 
        // 2. Check for INTERNET/LOOKUP tool
        if (!matched) {
          const lookupMatch = responseText.match(lookupRegex);
          if (lookupMatch) {
            const requestString = lookupMatch[1].trim();
            const lookupRequest = requestString.split(",", 2);
 
            let webLookupResult: string;
            if (lookupRequest.length === 2) {
              const lookupURL = lookupRequest[0].trim();
              const lookupQuery = lookupRequest[1].trim();
              // Pass a wrapped logger to the helper
              webLookupResult = await fetchWebInfo(lookupURL, lookupQuery, context);
            } else {
              webLookupResult = "Invalid syntax. You must specify a URL and a question, separated by a comma.";
            }

            await updateLog(`Lookup result:\n${webLookupResult}`, false);
            
            internetSearchChat.addEntry('user', webLookupResult);
            matched = true;
          }
        }
 
        turns++;
        if (turns >= maxTurns && !internetSearchIsDone) {
          internetSearchResult = "Internet Search Provided No Useful Results (Max turns reached)";
          internetSearchIsDone = true;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateLog(`Internet Search failed: ${errorMessage}`);
      internetSearchResult = `Internet Search Failed Due to Error: ${errorMessage}`;
    }
 
    const localLookupResult = await localLookup(question, context);
 
    // --- 3. Final Synthesis ---
    context.sendMessage({
      type: 'PROGRESS_UPDATE',
      message: `Synthesizing final answer using all gathered facts.`,
    });

    const replacementValues = {
      ExplicitlyProvided: localLookupResult,
      SearchResults: internetSearchResult,
      Question: question
    };
 
    let factFinderPreamble = await getToolPreamblePrompt('fact-finder-preamble');
    factFinderPreamble = await replaceRuntimePlaceholders(factFinderPreamble, replacementValues);
    updateLog(`#Fact Finder\n${factFinderPreamble}`);
 
    const parts: Part[] = [];
    if (context.initialImage && context.initialImageMimeType) {
      parts.push({
        inlineData: {
          mimeType: context.initialImageMimeType, 
          data: context.initialImage,
        }
      });
    }
    parts.push({ text: factFinderPreamble });

    const resultResponse = await context.multiAgentGeminiClient.sendOneShotMessage(
      parts,
      { model: DEFAULT_GEMINI_PRO_MODEL, enableThinking: true, enableGrounding: true, signal: context.signal }
    );
    
    let result = resultResponse.text || "";
    result = removeBacktickFences(result).trim();

    if (!result) {
      const candidate = resultResponse.candidates?.[0];
      if (candidate) {
        if (candidate.finishReason !== 'STOP') {
            updateLog(`**FactFinder Warning:** Response stopped due to: ${candidate.finishReason}`);
        }
        result = candidate.content?.parts?.map(p => p.text).join('\n').trim() || "";
      }
    }

    if (!result) {
      result = "Fact Finder failed to generate a response.";
    }

    const completed_status_message_prompt = await replaceRuntimePlaceholders(await getAssetString("summarize-progress-start"), {
      LastOrchestratorResponse: result
    });
        
    try {
      const opinionSummary = await context.multiAgentGeminiClient.sendOneShotMessage(
        completed_status_message_prompt,
        { model: DEFAULT_GEMINI_LITE_MODEL, signal: context.signal }
      ).then(msg => msg.text || "");
      context.sendMessage({
        type: "PROGRESS_UPDATE",
        message: opinionSummary,
      });
    } catch (_error) {}
 
    // --- 4. FAQ Update ---
    await addFAQ(question, result, context);
 
    return { result: result };
  },
 
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    if (invocation.trim()) {
      const question = invocation.trim();
      return {
        success: true, 
        params: {
          question
        }
      };
    } else {
      return {
        success: false, 
        error: `Invalid syntax for ${this.displayName} Tool. No question was provided.`
      }
    }
  }
};