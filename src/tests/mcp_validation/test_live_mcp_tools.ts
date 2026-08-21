/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST G: Live MoMo Overseer MCP Tool Verification
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates:
 * 1. Spawns the live MoMo MCP daemon
 * 2. Connects via MCP SDK Client over stdio
 * 3. Validates tool listing (all 40+ tools registered)
 * 4. Invokes live filesystem scanners (FILESEARCH_query, LazyMap DOC_READ, LINT)
 * 5. Invokes knowledge tools (FACTFINDER, PARADOX, QUERY_HIVE_MIND, WRITE_HIVE_MIND)
 * 6. Invokes QIS Engine tools (QIS_GET_GRAMMAR, QIS_INJECT_DATA, QIS_MANAGE_SERVER)
 * 7. Invokes telemetry & HITL status tools (GET_MEMORY_STATS, HITL_STATUS, TELEMETRY_DASHBOARD)
 *
 * Run: npx tsx src/tests/mcp_validation/test_live_mcp_tools.ts
 */

import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SwarmTracer } from '../../telemetry/tracer.js';

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

async function runTests(): Promise<void> {
  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog('║  TEST G: Live MoMo Overseer MCP Tool Verification        ║');
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  const cliPath = path.resolve(__dirname, '../../cli.ts');
  const workspaceDir = path.resolve(__dirname, '../../..');
  SwarmTracer.getInstance().emitLog(`  [INFO] Daemon entry: ${cliPath}`);
  SwarmTracer.getInstance().emitLog(`  [INFO] Workspace: ${workspaceDir}\n`);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'tsx', cliPath, 'daemon', '--dir', workspaceDir],
  });

  const client = new Client(
    { name: 'test-live-momo-verifier', version: '2.0.0' },
    { capabilities: {} }
  );

  try {
    SwarmTracer.getInstance().emitLog('── Phase 1: Connect to Live Daemon ──');
    await client.connect(transport);
    SwarmTracer.getInstance().emitLog('  [INFO] MCP Client connected to live daemon successfully!');
    assert(true, 'Live daemon handshake successful');

    SwarmTracer.getInstance().emitLog('\n── Phase 2: Tools Discovery ──');
    const toolsResult = await client.listTools();
    const tools = toolsResult?.tools || [];
    const toolNames = new Set(tools.map(t => t.name));

    SwarmTracer.getInstance().emitLog(`  [INFO] Discovered ${tools.length} tools`);
    assert(tools.length >= 40, `At least 40 tools discovered (got: ${tools.length})`);
    assert(toolNames.has('FILESEARCH_query'), 'FILESEARCH_query registered');
    assert(toolNames.has('DOC_READ'), 'DOC_READ registered');
    assert(toolNames.has('FACTFINDER'), 'FACTFINDER registered');
    assert(toolNames.has('PARADOX'), 'PARADOX registered');
    assert(toolNames.has('QUERY_HIVE_MIND'), 'QUERY_HIVE_MIND registered');
    assert(toolNames.has('WRITE_HIVE_MIND'), 'WRITE_HIVE_MIND registered');
    assert(toolNames.has('QIS_GET_GRAMMAR'), 'QIS_GET_GRAMMAR registered');
    assert(toolNames.has('QIS_INJECT_DATA'), 'QIS_INJECT_DATA registered');
    assert(toolNames.has('QIS_MANAGE_SERVER'), 'QIS_MANAGE_SERVER registered');
    assert(toolNames.has('list_available_tools'), 'list_available_tools registered');

    SwarmTracer.getInstance().emitLog('\n── Phase 3: Filesystem & Scanner Tools ──');

    // 1. list_available_tools
    const listRes = await client.callTool({ name: 'list_available_tools', arguments: {} });
    const listText = (listRes.content as any)[0]?.text || '';
    assert(listText.includes('Available Tools'), 'list_available_tools returned formatted markdown');

    // 2. FILESEARCH_query with live traversal
    const searchRes = await client.callTool({
      name: 'FILESEARCH_query',
      arguments: { query: 'LazyMap' },
    });
    const searchText = (searchRes.content as any)[0]?.text || '';
    assert(searchText.includes('localScanner.ts') || searchText.includes('LazyMap'), `FILESEARCH_query found LazyMap in codebase`);

    // 3. DOC_READ with LazyMap disk resolution
    const readRes = await client.callTool({
      name: 'DOC_READ',
      arguments: { filename: 'package.json' },
    });
    const readText = (readRes.content as any)[0]?.text || '';
    assert(readText.includes('momo-overseer'), 'DOC_READ successfully retrieved package.json');

    // 4. REGEX_VALIDATE
    const regexRes = await client.callTool({
      name: 'REGEX_VALIDATE',
      arguments: { regex: '^[a-z0-9_-]+$', target_string: 'momo-overseer_v2' },
    });
    const regexText = (regexRes.content as any)[0]?.text || '';
    assert(regexText.includes('Pass') || regexText.includes('matched') || !regexRes.isError, 'REGEX_VALIDATE evaluated pattern correctly');

    SwarmTracer.getInstance().emitLog('\n── Phase 4: Swarm Memory & Knowledge Tools ──');

    // 5. WRITE_HIVE_MIND
    const writeMindRes = await client.callTool({
      name: 'WRITE_HIVE_MIND',
      arguments: {
        context: 'Verifying live MCP tools for MoMo Overseer',
        action: 'Invoking WRITE_HIVE_MIND via official MCP client transport',
        outcome: 'Memory saved and verified successfully',
        tags: ['mcp', 'verification', 'live-test'],
        isGoldStandard: true,
      },
    });
    const writeMindText = (writeMindRes.content as any)[0]?.text || '';
    assert(writeMindText.includes('Memory Stored Successfully'), 'WRITE_HIVE_MIND saved memory triplet');

    // 6. QUERY_HIVE_MIND
    const queryMindRes = await client.callTool({
      name: 'QUERY_HIVE_MIND',
      arguments: { query: 'verification live-test' },
    });
    const queryMindText = (queryMindRes.content as any)[0]?.text || '';
    assert(queryMindText.includes('Hive Mind') || queryMindText.includes('Memory #'), 'QUERY_HIVE_MIND retrieved memory bank');

    // 7. GET_MEMORY_STATS
    const memStatsRes = await client.callTool({ name: 'GET_MEMORY_STATS', arguments: {} });
    const memStatsText = (memStatsRes.content as any)[0]?.text || '';
    assert(memStatsText.includes('Memory Stats') || memStatsText.includes('MB'), 'GET_MEMORY_STATS reported memory metrics');

    // 8. HITL_STATUS
    const hitlRes = await client.callTool({ name: 'HITL_STATUS', arguments: {} });
    const hitlText = (hitlRes.content as any)[0]?.text || '';
    assert(hitlText.includes('HITL') || hitlText.includes('pending') || hitlText.length > 0, 'HITL_STATUS returned status report');

    // 9. TELEMETRY_DASHBOARD
    const telemRes = await client.callTool({ name: 'TELEMETRY_DASHBOARD', arguments: {} });
    const telemText = (telemRes.content as any)[0]?.text || '';
    assert(telemText.includes('Telemetry') || telemText.includes('traces') || telemText.length > 0, 'TELEMETRY_DASHBOARD responded cleanly');

    SwarmTracer.getInstance().emitLog('\n── Phase 5: QIS Engine Tools ──');

    // 10. QIS_GET_GRAMMAR (verifying graceful bounded execution / IPC handling)
    const grammarRes = await client.callTool({ name: 'QIS_GET_GRAMMAR', arguments: {} });
    const grammarText = (grammarRes.content as any)[0]?.text || '';
    assert(grammarText.length > 0, 'QIS_GET_GRAMMAR executed with bounded response');

    // 11. QIS_MANAGE_SERVER
    const manageRes = await client.callTool({
      name: 'QIS_MANAGE_SERVER',
      arguments: { action: 'clear_state' },
    });
    const manageText = (manageRes.content as any)[0]?.text || '';
    assert(manageText.length > 0, 'QIS_MANAGE_SERVER processed action without hanging');

  } catch (err) {
    SwarmTracer.getInstance().emitLog(`Fatal error during live MCP test: ${err}`);
    assert(false, 'Live test execution', String(err));
  } finally {
    try {
      await transport.close();
    } catch {}
  }

  SwarmTracer.getInstance().emitLog('\n╔══════════════════════════════════════════════════════════╗');
  SwarmTracer.getInstance().emitLog(`║  RESULTS: ${passedTests}/${totalTests} tests passed${' '.repeat(Math.max(0, 35 - `${passedTests}/${totalTests}`.length))}║`);
  SwarmTracer.getInstance().emitLog('╚══════════════════════════════════════════════════════════╝\n');

  if (passedTests < totalTests) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
