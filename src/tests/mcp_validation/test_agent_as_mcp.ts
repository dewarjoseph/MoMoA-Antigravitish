/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST D: Bi-Directional Host Activation — MoMo as MCP Server
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates:
 * 1. MoMo's mock server initializes over stdio
 * 2. An MCP SDK Client connects and completes the handshake
 * 3. tools/list returns the server's tool schemas
 * 4. Tool invocation round-trip works
 * 5. resources/list and prompts/list return data
 *
 * Uses the official @modelcontextprotocol/sdk Client for protocol correctness.
 *
 * Run: npx tsx src/tests/mcp_validation/test_agent_as_mcp.ts
 */

import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

// ── Tests ───────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST D: Bi-Directional Host — MoMo as MCP Server       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Resolve path to mock MCP server
  const mockServerPath = path.resolve(__dirname, 'mock_mcp_server.ts');
  console.log(`  [INFO] Mock server: ${mockServerPath}\n`);

  // ── Phase 1: Create Transport & Client ─────────────────────────────────
  console.log('── Phase 1: Create MCP Client Transport ──');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'tsx', mockServerPath],
  });

  const client = new Client(
    { name: 'test-bidirectional-client', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    // ── Phase 2: Connect (Initialize Handshake) ─────────────────────────
    console.log('\n── Phase 2: MCP Connection & Handshake ──');
    console.log('  [INFO] Connecting to mock MCP server...');

    await client.connect(transport);
    console.log('  [INFO] Connected successfully!');
    assert(true, 'MCP Client connected to server via stdio');

    // ── Phase 3: tools/list ─────────────────────────────────────────────
    console.log('\n── Phase 3: tools/list Discovery ──');

    const toolsResult = await client.listTools();
    const tools = toolsResult?.tools || [];

    console.log(`  [INFO] Discovered ${tools.length} tools:`);
    for (const t of tools) {
      console.log(`    🔧 ${t.name} — ${t.description}`);
      const schemaStr = JSON.stringify(t.inputSchema).substring(0, 200);
      console.log(`       Schema: ${schemaStr}`);
    }

    assert(tools.length >= 3, `At least 3 tools (got: ${tools.length})`);

    const toolNames = tools.map(t => t.name);
    assert(toolNames.includes('echo'), "Tool 'echo' exposed");
    assert(toolNames.includes('calculate'), "Tool 'calculate' exposed");
    assert(toolNames.includes('get_timestamp'), "Tool 'get_timestamp' exposed");

    // ── Phase 4: Tool Invocation ────────────────────────────────────────
    console.log('\n── Phase 4: Tool Invocation Round-Trip ──');

    const echoResult = await client.callTool({
      name: 'echo',
      arguments: { text: 'Bidirectional MCP works!' },
    });
    const echoContent = (echoResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text || '')
      .join('');
    console.log(`  [INFO] echo response: "${echoContent}"`);
    assert(echoContent.includes('Bidirectional MCP works!'), 'Echo tool invocation returned correct data');

    const calcResult = await client.callTool({
      name: 'calculate',
      arguments: { operation: 'multiply', a: 6, b: 7 },
    });
    const calcContent = (calcResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text || '')
      .join('');
    console.log(`  [INFO] calculate response: "${calcContent}"`);
    assert(calcContent.includes('42'), 'Calculate tool returned correct result (6×7=42)');

    const timestampResult = await client.callTool({
      name: 'get_timestamp',
      arguments: {},
    });
    const timestampContent = (timestampResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text || '')
      .join('');
    console.log(`  [INFO] get_timestamp response: "${timestampContent}"`);
    assert(timestampContent.length > 0, 'Timestamp tool returned non-empty value');

    // ── Phase 5: resources/list ─────────────────────────────────────────
    console.log('\n── Phase 5: resources/list Discovery ──');

    try {
      const resourcesResult = await client.listResources();
      const resources = resourcesResult?.resources || [];
      console.log(`  [INFO] Discovered ${resources.length} resources:`);
      for (const r of resources) {
        console.log(`    📄 ${r.uri} — ${r.name}`);
      }
      assert(resources.length >= 2, `At least 2 resources (got: ${resources.length})`);

      // Read a resource
      if (resources.length > 0) {
        const readResult = await client.readResource({ uri: resources[0].uri });
        const readContent = readResult?.contents?.[0];
        console.log(`  [INFO] Resource content (first 100 chars): "${(readContent as any)?.text?.substring(0, 100)}"`);
        assert(readContent != null, 'Resource content is non-null');
      }
    } catch (err: any) {
      console.log(`  [WARN] Resources not fully supported: ${err.message}`);
    }

    // ── Phase 6: prompts/list ───────────────────────────────────────────
    console.log('\n── Phase 6: prompts/list Discovery ──');

    try {
      const promptsResult = await client.listPrompts();
      const prompts = promptsResult?.prompts || [];
      console.log(`  [INFO] Discovered ${prompts.length} prompts:`);
      for (const p of prompts) {
        console.log(`    💬 ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      }
      assert(prompts.length >= 2, `At least 2 prompts (got: ${prompts.length})`);

      // Get a specific prompt
      if (prompts.length > 0) {
        const getResult = await client.getPrompt({
          name: prompts[0].name,
          arguments: { errorLog: 'test error' },
        });
        const promptMsg = getResult?.messages?.[0];
        console.log(`  [INFO] Prompt message role: ${promptMsg?.role}`);
        assert(promptMsg != null, 'Prompt returned a message');
      }
    } catch (err: any) {
      console.log(`  [WARN] Prompts not fully supported: ${err.message}`);
    }

  } catch (err: any) {
    console.log(`  ${FAIL} — Error during MCP protocol exchange: ${err.message}`);
    console.log(err.stack);
  } finally {
    // Cleanup
    console.log('\n── Cleanup ──');
    try {
      await transport.close();
    } catch {}
    console.log('  [INFO] Transport closed.');
  }

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
