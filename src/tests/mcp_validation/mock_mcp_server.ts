/**
 * Mock MCP Server — A minimal, self-contained MCP server for testing.
 *
 * Exposes dummy tools, resources, and prompts over stdio.
 * Used by test_mcp_hotplug.ts and test_mcp_resources.ts.
 *
 * Run: npx tsx src/tests/mcp_validation/mock_mcp_server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'mock-test-server',
  version: '1.0.0',
});

// ── Dummy Tools ─────────────────────────────────────────────────────────────

server.tool(
  'echo',
  'Echoes back the input text',
  { text: z.string().describe('Text to echo back') },
  async ({ text }) => ({
    content: [{ type: 'text' as const, text: `ECHO: ${text}` }],
  })
);

server.tool(
  'calculate',
  'Performs basic arithmetic',
  {
    operation: z.enum(['add', 'subtract', 'multiply']).describe('The operation'),
    a: z.number().describe('First operand'),
    b: z.number().describe('Second operand'),
  },
  async ({ operation, a, b }) => {
    let result: number;
    switch (operation) {
      case 'add': result = a + b; break;
      case 'subtract': result = a - b; break;
      case 'multiply': result = a * b; break;
    }
    return {
      content: [{ type: 'text' as const, text: `Result: ${result}` }],
    };
  }
);

server.tool(
  'get_timestamp',
  'Returns the current timestamp',
  {},
  async () => ({
    content: [{ type: 'text' as const, text: new Date().toISOString() }],
  })
);

// ── Resources ───────────────────────────────────────────────────────────────

server.resource(
  'test-readme',
  'file://mock/readme',
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: '# Mock Server README\n\nThis is a test resource exposed by the mock MCP server.',
      mimeType: 'text/markdown',
    }],
  })
);

server.resource(
  'test-config',
  'file://mock/config',
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({ version: '1.0.0', mode: 'test', features: ['hot-plug', 'self-heal'] }),
      mimeType: 'application/json',
    }],
  })
);

// ── Prompts ─────────────────────────────────────────────────────────────────

server.prompt(
  'debug-helper',
  { errorLog: z.string().describe('The error log to analyze') },
  async ({ errorLog }) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `Analyze this error and suggest a fix:\n\n${errorLog}` },
    }],
  })
);

server.prompt(
  'code-review',
  { code: z.string().describe('The code to review') },
  async ({ code }) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `Review this code for bugs and improvements:\n\n${code}` },
    }],
  })
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[MockMCP] Server started on stdio.\n');
}

main().catch(err => {
  process.stderr.write(`[MockMCP] Fatal: ${err}\n`);
  process.exit(1);
});
