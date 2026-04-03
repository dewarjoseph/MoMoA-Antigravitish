import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolResult, MultiAgentToolContext, ToolParsingResult } from '../../momoa_core/types.js';
import { spawn } from 'child_process';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * A proxy class allowing MoMo-Overseer to instantiate and bridge capabilities to external 
 * Google Labs MCP implementations like StitchMCP or browsermcp dynamically for the `Jules` swarm.
 */
export class ProxyMcpTool implements MultiAgentTool {
    displayName: string;
    name: string;
    endToken: string;
    
    private mcpCommand: string;
    private mcpArgs: string[];
    
    constructor(toolName: string, mcpCommand: string, mcpArgs: string[]) {
        this.displayName = `${toolName} Bridge Tool`;
        this.name = toolName + '{';
        this.endToken = '}' + toolName;
        this.mcpCommand = mcpCommand;
        this.mcpArgs = mcpArgs;
    }

    async execute(params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        context.sendMessage(JSON.stringify({
             status: 'PROGRESS_UPDATES',
             completed_status_message: `Initializing External MCP Server: ${this.mcpCommand} ${this.mcpArgs.join(" ")}`,
        }));

        try {
            // Establish Stdio Transport to the external Google Labs / Third Party MCP binary
            const transport = new StdioClientTransport({
                command: this.mcpCommand,
                args: this.mcpArgs,
                env: process.env as Record<string, string>
            });

            const client = new Client({
                name: "momo-overseer-proxy",
                version: "1.0.0",
            }, { capabilities: {} });

            await client.connect(transport);

            // Execute requested generic tool bridging from Swarm -> External
            const targetToolName = params['tool_name'] as string;
            const targetArgs = params['args'] as Record<string, unknown>;

            const result = await client.callTool({
                name: targetToolName,
                arguments: targetArgs,
            });

            await transport.close();

            const typedContent = result.content as Array<{ type: string; text?: string }>;
            const stringResult = typedContent.map(c => 
                c.type === 'text' ? c.text : '[Unsupported Artifact Content]'
            ).join('\n');

            return { result: stringResult };

        } catch (error: any) {
             return { result: `Proxy Tool Execution Failed: ${error.message}` };
        }
    }

    async extractParameters(invocation: string): Promise<ToolParsingResult> {
        const trimmed = invocation.trim();
        if (!trimmed.endsWith(this.endToken!)) return { success: false, error: `Invalid syntax.` };
        const content = trimmed.substring(0, trimmed.lastIndexOf(this.endToken!));
        
        try {
            const parsed = JSON.parse(content);
            if (!parsed.tool_name) return { success: false, error: 'Missing tool_name' };
            return {
                success: true,
                params: {
                    tool_name: parsed.tool_name,
                    args: parsed.args || {},
                }
            };
        } catch {
            return { success: false, error: `Invalid JSON proxy schema.` };
        }
    }
}
