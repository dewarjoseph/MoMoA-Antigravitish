import { z } from 'zod';
import { DynamicMcpTool } from '../tools/implementations/dynamicMcpTool.js';

/**
 * Resolves the appropriate Zod schema for a given MoMo overseer MCP tool.
 * Evaluates core tools manually for strong strict typing, falling back
 * to dynamic evaluation for hot-plugged tools.
 */
export function getMcpToolSchema(mcpToolName: string, tool: any): Record<string, z.ZodTypeAny> {
    if (mcpToolName === 'DOC_READ') {
        return { filename: z.string().describe("Target file path to read") };
    } else if (mcpToolName === 'DOC_EDIT') {
        return { filename: z.string().describe("Target file path to edit"), editRequest: z.string().describe("Instructions or code block specifying the edit") };
    } else if (mcpToolName === 'FILESEARCH_query') {
        return { query: z.string().describe("Search string, glob, or regex pattern to search across the codebase") };
    } else if (mcpToolName === 'RUN') {
        return { 
            files: z.array(z.string()).optional().describe("Files to stage or execute"),
            command: z.string().optional().describe("Shell or build command (e.g., 'make firmware', 'gcc main.c -o main')"),
        };
    } else if (mcpToolName === 'LINT') {
        return { filename: z.string().describe("Target file path to lint") };
    } else if (mcpToolName === 'DOC_REVERT') {
        return { filename: z.string().describe("Target file path to revert to original state") };
    } else if (mcpToolName === 'URL_FETCH') {
        return { url: z.string().url().describe("Target URL to fetch") };
    } else if (mcpToolName === 'REGEX_VALIDATE') {
        return { target_string: z.string(), regex: z.string() };
    } else if (mcpToolName === 'MOVE_FILE_OR_FOLDER_SOURCE') {
        return { source: z.string(), destination: z.string() };
    } else if (mcpToolName === 'OPTIMIZE') {
        return { 
            evaluator_script: z.string().describe("Target driver script to execute evaluations"),
            search_space: z.string().describe("JSON stringified grid space (e.g. {'chunk_size': [100, 200]})"),
            goal: z.enum(['min', 'max']).optional().describe("Objective function direction"),
            budget: z.number().optional().describe("Number of random search trials (0 = full grid search)"),
            trials: z.number().optional().describe("Number of repititions per parameter set"),
            dependencies: z.string().optional().describe("JSON stringified array of required pip modules or files")
        };
    } else if (mcpToolName === 'READ_MCP_RESOURCE') {
        return {
            server: z.string().optional().describe("MCP server name to read resource from. Omit to list all resources."),
            uri: z.string().optional().describe("Resource URI to read."),
        };
    } else if (mcpToolName === 'GET_MCP_PROMPT') {
        return {
            server: z.string().optional().describe("MCP server name to get prompt from. Omit to list all prompts."),
            prompt_name: z.string().optional().describe("Name of the prompt to retrieve."),
            args: z.record(z.string(), z.string()).optional().describe("Arguments to pass to the prompt template."),
        };
    } else if (mcpToolName === 'JULES_CREATE_SESSION') {
        return {
            prompt: z.string().describe("The task description for Jules to execute."),
            sourceId: z.string().describe("The source repository ID. Example: sources/123"),
            branch: z.string().optional().describe("Optional starting branch. Defaults to main."),
            title: z.string().optional().describe("Optional title for the session."),
            requirePlanApproval: z.boolean().optional().describe("If true, plans require standard manual approval."),
        };
    } else if (mcpToolName === 'JULES_MONITOR_SESSION') {
        return {
            sessionId: z.string().describe("The session ID. Example: sessions/123"),
        };
    } else if (mcpToolName === 'JULES_AUTO_TRIAGE') {
        return {
            sessionId: z.string().describe("The session ID waiting for approval/triage."),
        };
    } else if (mcpToolName === 'GET_MEMORY_STATS') {
        return {}; // No params needed, purely an internal invocation
    } else if (mcpToolName === 'UPDATE_RESEARCH_LOG') {
        return {
            entry: z.string().describe("The research log text to boldly append to RESEARCH_LOG.md"),
        };
    } else if (mcpToolName === 'SWARM_DISPATCH') {
        return {
            count: z.number().describe("Number of autonomous agent streams to spawn in parallel."),
            repo: z.string().describe("Target GitHub repository (e.g., moongate-engineering/MoMoA-Antigravitish)"),
            basePrompt: z.string().optional().describe("Core instruction provided to all agents"),
            branch: z.string().optional().describe("Branch name to apply changes to"),
            strategies: z.array(z.string()).optional().describe("Assign strategy prefixes to spawned agents"),
            promptDir: z.string().optional().describe("Optional path overriding basePrompt mapping"),
        };
    } else if (mcpToolName === 'SUPERVISE_MERGE') {
        return {
            branch: z.string().describe("Feature branch containing unmerged changes"),
            sessionTitle: z.string().describe("Descriptive title mapping to the original task goal"),
            repoPath: z.string().optional().describe("Local path to the repository directory"),
            sessionId: z.string().optional().describe("A tracking ID to associate with the merge context"),
        };
    } else if (mcpToolName === 'SWARM_STATUS') {
        return {
            targetDir: z.string().optional().describe("Optional explicit repo directory to poll for logs"),
        };
    } else if (mcpToolName === 'SWARM_CLEANUP') {
        return {
            targetDir: z.string().optional().describe("Local working directory to wipe previous runs from"),
        };
    } else if (mcpToolName === 'PHONEAFRIEND') {
        return {
            question: z.string().describe("The question, issue summary, and any RELEVANT_FILES block for the expert."),
        };
    } else if (mcpToolName === 'PARADOX') {
        return {
            paradox: z.string().describe("The paradox statement or conflicting instructions to synthesize."),
        };
    } else if (mcpToolName === 'RESTART_PROJECT') {
        return {
            instruction: z.string().describe("The reason and scope for restarting the project context."),
        };
    } else if (mcpToolName === 'FACTFINDER') {
        return {
            question: z.string().describe("The question requiring web lookup or deep knowledge mining."),
        };
    } else if (mcpToolName === 'QIS_INJECT_DATA') {
        return {
            text: z.string().describe("The text data to inject into the QIS Quantum Glass engine for thermodynamic processing."),
        };
    } else if (mcpToolName === 'QIS_GET_GRAMMAR') {
        return {};
    } else if (mcpToolName === 'QIS_TUNE_PHYSICS') {
        return {
            wDisorder: z.number().optional().describe("Disorder strength w (w_c ≈ 10 is the glass transition point)."),
            pinkNoiseAlpha: z.number().optional().describe("Autoregressive coefficient for 1/f noise buffer (TLS tunneling memory), 0-1."),
            pinkNoiseScale: z.number().optional().describe("Base amplitude of 1/f TLS tunneling noise."),
            decoherenceFactor: z.number().optional().describe("Global decoherence factor for the thermodynamic network."),
            plasticityScale: z.number().optional().describe("Base learning rate for weight updates (Hebbian learning)."),
            thermalCooling: z.number().optional().describe("Rate at which unused weights dissolve (Decoherence).")
        };
    } else if (mcpToolName === 'QUERY_HIVE_MIND') {
        return {
            query: z.string().describe("The text to search for in the Hive Mind memory."),
            topK: z.number().optional().describe("Number of results to return (default: 5)."),
            tags: z.array(z.string()).optional().describe("Filter results by tags."),
        };
    } else if (mcpToolName === 'WRITE_HIVE_MIND') {
        return {
            context: z.string().describe("What the swarm was trying to accomplish."),
            action: z.string().describe("What tool/prompt/approach was used."),
            outcome: z.string().describe("Whether it succeeded, failed, and the resolution."),
            tags: z.array(z.string()).optional().describe("Searchable tags for categorization."),
            isGoldStandard: z.boolean().optional().describe("Whether this is a human-sourced gold standard solution."),
        };
    } else if (mcpToolName === 'ASK_HUMAN') {
        return {
            question: z.string().describe("The question or issue requiring human input."),
            context: z.string().optional().describe("Additional context (error logs, trace links)."),
            urgency: z.enum(['low', 'medium', 'high', 'critical']).optional().describe("How urgent the request is."),
            traceId: z.string().optional().describe("Associated trace ID for telemetry correlation."),
        };
    } else if (mcpToolName === 'HITL_STATUS') {
        return {}; // No params needed
    } else if (mcpToolName === 'RESPOND_TO_HUMAN') {
        return {
            requestId: z.string().describe("The HITL request ID from ASK_HUMAN output."),
            answer: z.string().describe("The human's response to the pending question."),
        };
    } else if (mcpToolName === 'SEARCH_MCP_REGISTRY') {
        return {
            capability: z.string().describe("Description of the capability to search for."),
            autoInstall: z.boolean().optional().describe("Whether to auto-install the best match (requires HITL approval)."),
        };
    } else if (mcpToolName === 'TELEMETRY_DASHBOARD') {
        return {
            traceId: z.string().optional().describe("Specific trace ID to view in detail."),
            last: z.number().optional().describe("Number of recent traces to show (default: 10)."),
        };
    } else if (mcpToolName === 'JULES_') {
        return { 
            request: z.string().describe("The natural language request for Jules to execute."),
        };
    } else if (mcpToolName === 'STITCH') {
        return { 
            question: z.string().describe("The UI design prompt."),
            deviceType: z.string().optional().describe("E.g., MOBILE, DESKTOP, TABLET")
        };
    } else if (mcpToolName === 'SCREENSHOT') {
        return { 
            request: z.string().describe("The natural language request for the screenshot tool.")
        };
    } else if (tool instanceof DynamicMcpTool) {
        // Dynamic MCP tools: build schema from discovered inputSchema
        return buildZodSchemaFromJson(tool.getInputSchema());
    }

    // Default fallback
    return { params: z.string().describe('JSON-encoded parameters for the tool') };
}

/**
 * Build a Zod schema from a JSON Schema object (basic conversion for MCP tool registration).
 * Handles common types: string, number, integer, boolean, array, object.
 */
export function buildZodSchemaFromJson(jsonSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = (jsonSchema.properties as Record<string, any>) || {};
  const required = new Set((jsonSchema.required as string[]) || []);
  const zodSchema: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
      case 'integer':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.any());
        break;
      case 'object':
        zodType = z.record(z.string(), z.any());
        break;
      default:
        zodType = z.any();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.has(key)) {
      zodType = zodType.optional();
    }

    zodSchema[key] = zodType;
  }

  // Fallback: if no properties were extracted, use a generic params field
  if (Object.keys(zodSchema).length === 0) {
    zodSchema['params'] = z.string().optional().describe('JSON-encoded parameters');
  }

  return zodSchema;
}
