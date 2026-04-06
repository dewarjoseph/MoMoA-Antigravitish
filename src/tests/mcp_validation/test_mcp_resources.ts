/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST C: Protocol Parity — MCP Resources & Prompts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates:
 * 1. ReadMcpResourceTool correctly lists all resources across servers
 * 2. ReadMcpResourceTool correctly reads specific resources
 * 3. GetMcpPromptTool correctly lists all prompts across servers
 * 4. GetMcpPromptTool correctly retrieves prompt content
 * 5. Error handling: missing server, missing resource, no manager
 *
 * Run: npx tsx src/tests/mcp_validation/test_mcp_resources.ts
 */

import { readMcpResourceTool } from '../../tools/implementations/readMcpResourceTool.js';
import { getMcpPromptTool } from '../../tools/implementations/getMcpPromptTool.js';
import type { McpClientManager } from '../../mcp/mcpClientManager.js';
import type { MultiAgentToolContext } from '../../momoa_core/types.js';

// ── Utilities ───────────────────────────────────────────────────────────────

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${PASS} — ${testName}`);
  } else {
    console.log(`  ${FAIL} — ${testName}${details ? ` (${details})` : ''}`);
  }
}

// ── Mock Factories ──────────────────────────────────────────────────────────

function createMockManager(): McpClientManager {
  return {
    serverNames: ['mock-server-1', 'mock-server-2'],
    isInitialized: true,

    listAllResources: async () => [
      { server: 'mock-server-1', uri: 'file://docs/api', name: 'API Documentation', description: 'API reference docs' },
      { server: 'mock-server-1', uri: 'file://docs/schema', name: 'Database Schema', description: 'DB schema reference' },
      { server: 'mock-server-2', uri: 'config://app/settings', name: 'App Settings' },
    ],

    readResource: async (serverName: string, uri: string) => {
      if (serverName === 'mock-server-1' && uri === 'file://docs/api') {
        return '# API Documentation\n\n## GET /users\nReturns a list of users.';
      }
      if (serverName === 'mock-server-1' && uri === 'file://docs/schema') {
        return 'CREATE TABLE users (id INT PRIMARY KEY, name TEXT);';
      }
      if (serverName === 'mock-server-2' && uri === 'config://app/settings') {
        return JSON.stringify({ theme: 'dark', language: 'en' });
      }
      throw new Error(`Resource not found: ${uri}`);
    },

    listResources: async (server: string) => {
      if (server === 'mock-server-1') {
        return [
          { uri: 'file://docs/api', name: 'API Documentation', description: 'API reference docs' },
          { uri: 'file://docs/schema', name: 'Database Schema', description: 'DB schema reference' },
        ];
      }
      return [{ uri: 'config://app/settings', name: 'App Settings' }];
    },

    listAllPrompts: async () => [
      { server: 'mock-server-1', name: 'debug-assistant', description: 'Helps debug code issues' },
      { server: 'mock-server-1', name: 'code-reviewer', description: 'Reviews code quality' },
      { server: 'mock-server-2', name: 'summarizer', description: 'Summarizes text content' },
    ],

    getPrompt: async (serverName: string, promptName: string, args?: Record<string, string>) => {
      if (serverName === 'mock-server-1' && promptName === 'debug-assistant') {
        const errorLog = args?.errorLog || 'No error provided';
        return `Please analyze this error and suggest fixes:\n\n${errorLog}`;
      }
      if (serverName === 'mock-server-2' && promptName === 'summarizer') {
        const text = args?.text || '';
        return `Summarize the following text concisely:\n\n${text}`;
      }
      throw new Error(`Prompt not found: ${promptName}`);
    },

    listPrompts: async () => [],
    getAllTools: () => new Map(),
    callTool: async () => '',
    initFromConfig: async () => {},
    shutdown: async () => {},
    connectServer: async () => {},
    disconnectServer: async () => {},
    setOnToolsChanged: () => {},
    reload: async () => {},
  } as unknown as McpClientManager;
}

function createMockContext(manager?: McpClientManager): MultiAgentToolContext {
  return {
    initialPrompt: '[Test]',
    fileMap: new Map(),
    binaryFileMap: new Map(),
    editedFilesSet: new Set(),
    originalFilesSet: new Set(),
    originalFileMap: new Map(),
    originalBinaryFileMap: new Map(),
    sendMessage: () => {},
    multiAgentGeminiClient: {} as any,
    experts: [],
    transcriptsToUpdate: [],
    transcriptForContext: {} as any,
    overseer: undefined,
    saveFileResolver: null,
    infrastructureContext: {
      getToolNames: () => [],
      getToolResultPrefix: async () => '',
      getToolResultSuffix: async () => '',
      getAssetString: async () => '',
      getSessionId: () => 'test',
    },
    saveFiles: false,
    secrets: {
      geminiApiKey: '', julesApiKey: '', githubToken: '',
      stitchApiKey: '', e2BApiKey: '', githubScratchPadRepo: '',
    },
    mcpClientManager: manager,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST C: Protocol Parity — Resources & Prompts          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const mockManager = createMockManager();

  // ── Test 1: No Manager ────────────────────────────────────────────────
  console.log('── Phase 1: Error Handling (No Manager) ──');

  const noMgrCtx = createMockContext(undefined);
  const noMgrResult = await readMcpResourceTool.execute({}, noMgrCtx);
  assert(noMgrResult.result.includes('No MCP Client Manager'), 'ReadMcpResource fails gracefully without manager');

  const noMgrPrompt = await getMcpPromptTool.execute({}, noMgrCtx);
  assert(noMgrPrompt.result.includes('No MCP Client Manager'), 'GetMcpPrompt fails gracefully without manager');

  // ── Test 2: List All Resources ────────────────────────────────────────
  console.log('\n── Phase 2: List All Resources ──');

  const ctx = createMockContext(mockManager);
  const listResult = await readMcpResourceTool.execute({}, ctx);
  console.log(`  [INFO] Resource listing:\n${listResult.result.split('\n').map(l => '    ' + l).join('\n')}`);

  assert(listResult.result.includes('mock-server-1'), 'Lists resources from server 1');
  assert(listResult.result.includes('mock-server-2'), 'Lists resources from server 2');
  assert(listResult.result.includes('API Documentation'), 'Lists API Documentation resource');
  assert(listResult.result.includes('App Settings'), 'Lists App Settings resource');

  // ── Test 3: Read Specific Resource ────────────────────────────────────
  console.log('\n── Phase 3: Read Specific Resource ──');

  const readResult = await readMcpResourceTool.execute(
    { server: 'mock-server-1', uri: 'file://docs/api' },
    ctx
  );
  console.log(`  [INFO] Resource content:\n${readResult.result.split('\n').map(l => '    ' + l).join('\n')}`);
  assert(readResult.result.includes('GET /users'), 'Read API resource returns correct content');

  const schemaResult = await readMcpResourceTool.execute(
    { server: 'mock-server-1', uri: 'file://docs/schema' },
    ctx
  );
  assert(schemaResult.result.includes('CREATE TABLE'), 'Read schema resource returns SQL');

  // ── Test 4: Read Resource Error Handling ─────────────────────────────
  console.log('\n── Phase 4: Resource Error Handling ──');

  const missingResource = await readMcpResourceTool.execute(
    { server: 'mock-server-1', uri: 'file://nonexistent' },
    ctx
  );
  assert(missingResource.result.includes('Error'), 'Returns error for nonexistent resource');

  const partialParams = await readMcpResourceTool.execute(
    { server: 'mock-server-1' },
    ctx
  );
  assert(partialParams.result.includes('required'), 'Returns error when URI is missing');

  // ── Test 5: List All Prompts ──────────────────────────────────────────
  console.log('\n── Phase 5: List All Prompts ──');

  const promptList = await getMcpPromptTool.execute({}, ctx);
  console.log(`  [INFO] Prompt listing:\n${promptList.result.split('\n').map(l => '    ' + l).join('\n')}`);

  assert(promptList.result.includes('debug-assistant'), 'Lists debug-assistant prompt');
  assert(promptList.result.includes('code-reviewer'), 'Lists code-reviewer prompt');
  assert(promptList.result.includes('summarizer'), 'Lists summarizer prompt');
  assert(promptList.result.includes('mock-server-1'), 'Shows server name in listing');

  // ── Test 6: Get Specific Prompt ───────────────────────────────────────
  console.log('\n── Phase 6: Get Specific Prompt ──');

  const promptResult = await getMcpPromptTool.execute(
    { server: 'mock-server-1', prompt_name: 'debug-assistant', args: { errorLog: 'TypeError: Cannot read property x' } },
    ctx
  );
  console.log(`  [INFO] Prompt content:\n${promptResult.result.split('\n').map(l => '    ' + l).join('\n')}`);
  assert(promptResult.result.includes('TypeError'), 'Prompt interpolates arguments correctly');

  const summarizerResult = await getMcpPromptTool.execute(
    { server: 'mock-server-2', prompt_name: 'summarizer', args: { text: 'Long text here...' } },
    ctx
  );
  assert(summarizerResult.result.includes('Summarize'), 'Summarizer prompt returns correct template');

  // ── Test 7: Prompt Error Handling ─────────────────────────────────────
  console.log('\n── Phase 7: Prompt Error Handling ──');

  const missingPrompt = await getMcpPromptTool.execute(
    { server: 'mock-server-1', prompt_name: 'nonexistent' },
    ctx
  );
  assert(missingPrompt.result.includes('Error'), 'Returns error for nonexistent prompt');

  const partialPrompt = await getMcpPromptTool.execute(
    { server: 'mock-server-1' },
    ctx
  );
  assert(partialPrompt.result.includes('required'), 'Returns error when prompt_name is missing');

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passedTests}/${totalTests} tests passed${' '.repeat(Math.max(0, 35 - `${passedTests}/${totalTests}`.length))}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
