/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST A: Dynamic Configuration Loader — MCP Hot-Plugging Validation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates:
 * 1. McpClientManager reads mcp_servers.json correctly
 * 2. Connects to a live mock MCP server over stdio
 * 3. Discovers tools via tools/list and maps them into DiscoveredMcpTool objects
 * 4. Can call a discovered tool and receive a valid response
 * 5. Hot-reload: detects config changes and reconciles connections
 *
 * Run: npx tsx src/tests/mcp_validation/test_mcp_hotplug.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpClientManager } from '../../mcp/mcpClientManager.js';

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

// ── Test Setup ──────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST A: Dynamic MCP Hot-Plug Configuration Loader      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Create temp directory for test config
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-hotplug-test-'));
  const configPath = path.join(tempDir, 'mcp_servers.json');

  // Resolve the path to our mock MCP server
  const mockServerPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
    'mock_mcp_server.ts'
  );

  // Write test config pointing to mock server
  const testConfig = {
    mcpServers: {
      'mock-test': {
        command: 'npx',
        args: ['-y', 'tsx', mockServerPath],
      },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
  console.log(`[Setup] Config written to ${configPath}`);
  console.log(`[Setup] Mock server path: ${mockServerPath}\n`);

  // ── Test 1: Config Parsing ──────────────────────────────────────────────
  console.log('── Phase 1: Configuration Parsing ──');

  const manager = new McpClientManager(configPath);
  assert(!manager.isInitialized, 'Manager not initialized before initFromConfig()');
  assert(manager.serverNames.length === 0, 'No server names before init');

  // ── Test 2: Connection & Tool Discovery ─────────────────────────────────
  console.log('\n── Phase 2: Connection & Tool Discovery ──');
  console.log('  [INFO] Connecting to mock MCP server (this may take a few seconds)...');

  try {
    await manager.initFromConfig();

    assert(manager.isInitialized, 'Manager initialized after initFromConfig()');
    assert(manager.serverNames.length === 1, `1 server connected (got: ${manager.serverNames.length})`);
    assert(manager.serverNames[0] === 'mock-test', `Server name is 'mock-test' (got: '${manager.serverNames[0]}')`);

    // ── Test 3: Tool Schema Discovery ───────────────────────────────────────
    console.log('\n── Phase 3: Tool Schema Validation ──');
    const allTools = manager.getAllTools();
    const toolNames = [...allTools.keys()];

    assert(allTools.size >= 3, `Discovered at least 3 tools (got: ${allTools.size})`);

    console.log(`\n  [INFO] Discovered tool schemas:`);
    for (const [qualifiedName, { serverName, tool }] of allTools) {
      console.log(`    📦 ${qualifiedName}`);
      console.log(`       Server: ${serverName}`);
      console.log(`       Description: ${tool.description}`);
      console.log(`       Schema: ${JSON.stringify(tool.inputSchema, null, 6).substring(0, 200)}`);
    }

    // Verify specific tools exist
    const hasEcho = toolNames.some(n => n.includes('echo'));
    const hasCalc = toolNames.some(n => n.includes('calculate'));
    const hasTimestamp = toolNames.some(n => n.includes('get_timestamp'));

    assert(hasEcho, "Discovered 'echo' tool");
    assert(hasCalc, "Discovered 'calculate' tool");
    assert(hasTimestamp, "Discovered 'get_timestamp' tool");

    // ── Test 4: Tool Invocation ─────────────────────────────────────────────
    console.log('\n── Phase 4: Remote Tool Invocation ──');

    const echoResult = await manager.callTool('mock-test', 'echo', { text: 'Hello from MoMo!' });
    console.log(`  [INFO] echo result: "${echoResult}"`);
    assert(echoResult.includes('ECHO: Hello from MoMo!'), 'Echo tool returned correct response');

    const calcResult = await manager.callTool('mock-test', 'calculate', { operation: 'add', a: 17, b: 25 });
    console.log(`  [INFO] calculate result: "${calcResult}"`);
    assert(calcResult.includes('42'), 'Calculate tool returned correct result (17+25=42)');

    // ── Test 5: Resource Discovery ────────────────────────────────────────
    console.log('\n── Phase 5: Resource & Prompt Discovery ──');

    try {
      const resources = await manager.listResources('mock-test');
      console.log(`  [INFO] Resources found: ${resources.length}`);
      for (const r of resources) {
        console.log(`    📄 ${r.uri} — ${r.name}`);
      }
      assert(resources.length >= 2, `Discovered at least 2 resources (got: ${resources.length})`);

      if (resources.length > 0) {
        const content = await manager.readResource('mock-test', resources[0].uri);
        console.log(`  [INFO] Resource content (first 100 chars): "${content.substring(0, 100)}"`);
        assert(content.length > 0, 'Resource content is non-empty');
      }
    } catch (err: any) {
      console.log(`  [WARN] Resource listing not supported: ${err.message}`);
    }

    try {
      const prompts = await manager.listPrompts('mock-test');
      console.log(`  [INFO] Prompts found: ${prompts.length}`);
      for (const p of prompts) {
        console.log(`    💬 ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      }
      assert(prompts.length >= 2, `Discovered at least 2 prompts (got: ${prompts.length})`);
    } catch (err: any) {
      console.log(`  [WARN] Prompt listing not supported: ${err.message}`);
    }

    // ── Test 6: Hot-Reload Simulation ───────────────────────────────────────
    console.log('\n── Phase 6: Hot-Reload Simulation ──');

    // Add a second server to the config
    const updatedConfig = {
      mcpServers: {
        'mock-test': testConfig.mcpServers['mock-test'],
        'mock-test-2': {
          command: 'npx',
          args: ['-y', 'tsx', mockServerPath],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
    console.log('  [INFO] Updated config with second server, triggering reload...');

    await manager.reload();

    assert(manager.serverNames.length === 2, `2 servers after reload (got: ${manager.serverNames.length})`);
    assert(manager.serverNames.includes('mock-test-2'), "Second server 'mock-test-2' connected");

    const allToolsAfterReload = manager.getAllTools();
    assert(allToolsAfterReload.size >= 6, `At least 6 tools after reload (3×2 servers, got: ${allToolsAfterReload.size})`);

    // Remove the second server
    const reducedConfig = {
      mcpServers: {
        'mock-test': testConfig.mcpServers['mock-test'],
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(reducedConfig, null, 2));
    console.log('  [INFO] Removed second server from config, triggering reload...');
    await manager.reload();

    assert(manager.serverNames.length === 1, `Back to 1 server after removal (got: ${manager.serverNames.length})`);
    assert(!manager.serverNames.includes('mock-test-2'), "Second server cleaned up");

  } catch (err: any) {
    console.log(`\n  ${FAIL} — Unexpected error: ${err.message}`);
    console.log(err.stack);
  } finally {
    // Cleanup
    console.log('\n── Cleanup ──');
    await manager.shutdown();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    console.log('  [INFO] Connections shut down, temp files cleaned.');
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passedTests}/${totalTests} tests passed${' '.repeat(Math.max(0, 35 - `${passedTests}/${totalTests}`.length))}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
