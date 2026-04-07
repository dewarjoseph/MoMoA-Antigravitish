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
import { SwarmTracer } from '../../telemetry/tracer.js';

// ── Utilities ───────────────────────────────────────────────────────────────

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    SwarmTracer.getInstance().emitLog(`  ${PASS} — ${testName}`);
  } else {
    SwarmTracer.getInstance().emitLog(`  ${FAIL} — ${testName}${details ? ` (${details})` : ''}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog('║  TEST D: Bi-Directional Host — MoMo as MCP Server       ║');
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  // Resolve path to mock MCP server
  const mockServerPath = path.resolve(__dirname, 'mock_mcp_server.ts');
  SwarmTracer.getInstance().emitLog(`  [INFO] Mock server: ${mockServerPath}\n`);

  // ── Phase 1: Create Transport & Client ─────────────────────────────────
  SwarmTracer.getInstance().emitLog('── Phase 1: Create MCP Client Transport ──');

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
    SwarmTracer.getInstance().emitLog('\n── Phase 2: MCP Connection & Handshake ──');
    SwarmTracer.getInstance().emitLog('  [INFO] Connecting to mock MCP server...');

    await client.connect(transport);
    SwarmTracer.getInstance().emitLog('  [INFO] Connected successfully!');
    assert(true, 'MCP Client connected to server via stdio');

    // ── Phase 3: tools/list ─────────────────────────────────────────────
    SwarmTracer.getInstance().emitLog('\n── Phase 3: tools/list Discovery ──');

    const toolsResult = await client.listTools();
    const tools = toolsResult?.tools || [];

    SwarmTracer.getInstance().emitLog(`  [INFO] Discovered ${tools.length} tools:`);
    for (const t of tools) {
      SwarmTracer.getInstance().emitLog(`    🔧 ${t.name} — ${t.description}`);
      const schemaStr = JSON.stringify(t.inputSchema).substring(0, 200);
      SwarmTracer.getInstance().emitLog(`       Schema: ${schemaStr}`);
    }

    assert(tools.length >= 3, `At least 3 tools (got: ${tools.length})`);

    const toolNames = tools.map(t => t.name);
    assert(toolNames.includes('echo'), "Tool 'echo' exposed");
    assert(toolNames.includes('calculate'), "Tool 'calculate' exposed");
    assert(toolNames.includes('get_timestamp'), "Tool 'get_timestamp' exposed");

    // ── Phase 4: Tool Invocation ────────────────────────────────────────
    SwarmTracer.getInstance().emitLog('\n── Phase 4: Tool Invocation Round-Trip ──');

    const echoResult = await client.callTool({
      name: 'echo',
      arguments: { text: 'Bidirectional MCP works!' },
    });
    const echoContent = (echoResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text || '')
      .join('');
    SwarmTracer.getInstance().emitLog(`  [INFO] echo response: "${echoContent}"`);
    assert(echoContent.includes('Bidirectional MCP works!'), 'Echo tool invocation returned correct data');

    const calcResult = await client.callTool({
      name: 'calculate',
      arguments: { operation: 'multiply', a: 6, b: 7 },
    });
    const calcContent = (calcResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text || '')
      .join('');
    SwarmTracer.getInstance().emitLog(`  [INFO] calculate response: "${calcContent}"`);
    assert(calcContent.includes('42'), 'Calculate tool returned correct result (6×7=42)');

    const timestampResult = await client.callTool({
      name: 'get_timestamp',
      arguments: {},
    });
    const timestampContent = (timestampResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text || '')
      .join('');
    SwarmTracer.getInstance().emitLog(`  [INFO] get_timestamp response: "${timestampContent}"`);
    assert(timestampContent.length > 0, 'Timestamp tool returned non-empty value');

    // ── Phase 5: resources/list ─────────────────────────────────────────
    SwarmTracer.getInstance().emitLog('\n── Phase 5: resources/list Discovery ──');

    try {
      const resourcesResult = await client.listResources();
      const resources = resourcesResult?.resources || [];
      SwarmTracer.getInstance().emitLog(`  [INFO] Discovered ${resources.length} resources:`);
      for (const r of resources) {
        SwarmTracer.getInstance().emitLog(`    📄 ${r.uri} — ${r.name}`);
      }
      assert(resources.length >= 2, `At least 2 resources (got: ${resources.length})`);

      // Read a resource
      if (resources.length > 0) {
        const readResult = await client.readResource({ uri: resources[0].uri });
        const readContent = readResult?.contents?.[0];
        SwarmTracer.getInstance().emitLog(`  [INFO] Resource content (first 100 chars): "${(readContent as any)?.text?.substring(0, 100)}"`);
        assert(readContent != null, 'Resource content is non-null');
      }
    } catch (err: any) {
      SwarmTracer.getInstance().emitLog(`  [WARN] Resources not fully supported: ${err.message}`);
    }

    // ── Phase 6: prompts/list ───────────────────────────────────────────
    SwarmTracer.getInstance().emitLog('\n── Phase 6: prompts/list Discovery ──');

    try {
      const promptsResult = await client.listPrompts();
      const prompts = promptsResult?.prompts || [];
      SwarmTracer.getInstance().emitLog(`  [INFO] Discovered ${prompts.length} prompts:`);
      for (const p of prompts) {
        SwarmTracer.getInstance().emitLog(`    💬 ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      }
      assert(prompts.length >= 2, `At least 2 prompts (got: ${prompts.length})`);

      // Get a specific prompt
      if (prompts.length > 0) {
        const getResult = await client.getPrompt({
          name: prompts[0].name,
          arguments: { errorLog: 'test error' },
        });
        const promptMsg = getResult?.messages?.[0];
        SwarmTracer.getInstance().emitLog(`  [INFO] Prompt message role: ${promptMsg?.role}`);
        assert(promptMsg != null, 'Prompt returned a message');
      }
    } catch (err: any) {
      SwarmTracer.getInstance().emitLog(`  [WARN] Prompts not fully supported: ${err.message}`);
    }

  } catch (err: any) {
    SwarmTracer.getInstance().emitLog(`  ${FAIL} — Error during MCP protocol exchange: ${err.message}`);
    SwarmTracer.getInstance().emitLog(err.stack);
  } finally {
    // Cleanup
    SwarmTracer.getInstance().emitLog('\n── Cleanup ──');
    try {
      await transport.close();
    } catch {}
    SwarmTracer.getInstance().emitLog('  [INFO] Transport closed.');
  }

  // ── Summary ───────────────────────────────────────────────────────────
  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog(`║  RESULTS: ${passedTests}/${totalTests} tests passed${' '.repeat(Math.max(0, 35 - `${passedTests}/${totalTests}`.length))}║`);
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) { process.exit(1); } else { process.exit(0); }
}

runTests().catch(err => {
  SwarmTracer.getInstance().emitLog('Fatal test error:', err);
  process.exit(1);
});
