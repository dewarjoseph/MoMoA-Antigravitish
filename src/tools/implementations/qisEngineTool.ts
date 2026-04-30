import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { SpanKind, SpanStatus } from '../../telemetry/types.js';
import { LocalStoreManager } from '../../persistence/localStoreManager.js'; // Import LocalStoreManager
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { processRegistry } from '../../utils/processRegistry.js';

export interface QISTuneParams {
    wDisorder?: number;
    pinkNoiseAlpha?: number;
    pinkNoiseScale?: number;
    decoherenceFactor?: number;
    plasticityScale?: number;
    thermalCooling?: number;
}

export interface QISDataParams {
    text: string;
}

export interface EngineResponse {
    success: boolean;
    result: string;
    telemetry_dump?: any;
}


export const qisInjectDataTool: MultiAgentTool = {
    displayName: 'QIS Inject Data',
    name: 'QIS_INJECT_DATA',

    async execute(params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        let span: any;
        if (context.tracer && context.activeTraceContext) {
            span = context.tracer.startSpan(context.activeTraceContext, 'QIS_INJECT_DATA', SpanKind.TOOL);
        }

        const dataParams = params as QISDataParams;

        if (!dataParams || !dataParams.text) {
            const errRes: EngineResponse = { success: false, result: "Error: Missing 'text' parameter" };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: 'Missing text parameter' });
            }
            return { result: JSON.stringify(errRes) };
        }

        const localStore = new LocalStoreManager();
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_inject_text_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 100;
        const maxPollingTimeMs = 30000; // 30 seconds

        try {
            // 1. Write request file
            const requestData = {
                timestamp: Date.now(),
                text_input: dataParams.text,
            };
            localStore.writeState(requestFilePath, requestData);
            console.error(`[QIS_INJECT_DATA] Request file written to ${requestFilePath}`);

            // 2. Poll for response file
            let responseData: any | null = null;
            const startTime = Date.now();
            while (Date.now() - startTime < maxPollingTimeMs) {
                responseData = localStore.readState(responseFilePath);
                if (responseData) {
                    console.error(`[QIS_INJECT_DATA] Response file read from ${responseFilePath}`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
            }

            if (!responseData) {
                throw new Error(`Timeout: No response file found at ${responseFilePath} within ${maxPollingTimeMs}ms.`);
            }

            // 3. Process response
            const data = responseData;
            const res: EngineResponse = { success: data.status === 'success', result: JSON.stringify(data), telemetry_dump: data };

            if (span && context.tracer) {
                if (data.status === 'error') {
                    context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: data.detail });
                } else {
                    context.tracer.endSpan(span, SpanStatus.OK);
                }
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
            const errRes: EngineResponse = { success: false, result: `Error during QIS Data Injection: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        } finally {
            // 4. Delete IPC files
            localStore.deleteFile(requestFilePath);
            localStore.deleteFile(responseFilePath);
        }
    },
    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        return { success: true, params: { text: invocation } };
    }
}


export const qisGetGrammarTool: MultiAgentTool = {
    displayName: 'QIS Get Grammar',
    name: 'QIS_GET_GRAMMAR',

    async execute(_params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        let span: any;
        if (context.tracer && context.activeTraceContext) {
            span = context.tracer.startSpan(context.activeTraceContext, 'QIS_GET_GRAMMAR', SpanKind.TOOL);
        }

        const localStore = new LocalStoreManager();
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_grammar_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 100;
        const maxPollingTimeMs = 30000; // 30 seconds

        try {
            // 1. Write request file (empty or with a timestamp as no specific params are needed)
            const requestData = {
                timestamp: Date.now(),
            };
            localStore.writeState(requestFilePath, requestData);
            console.error(`[QIS_GET_GRAMMAR] Request file written to ${requestFilePath}`);

            // 2. Poll for response file
            let responseData: any | null = null;
            const startTime = Date.now();
            while (Date.now() - startTime < maxPollingTimeMs) {
                responseData = localStore.readState(responseFilePath);
                if (responseData) {
                    console.error(`[QIS_GET_GRAMMAR] Response file read from ${responseFilePath}`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
            }

            if (!responseData) {
                throw new Error(`Timeout: No response file found at ${responseFilePath} within ${maxPollingTimeMs}ms.`);
            }

            // 3. Process response
            const data = responseData;
            const res: EngineResponse = { success: data.status === 'success', result: "Successfully fetched grammar.", telemetry_dump: data };

            if (span && context.tracer) {
                if (data.status === 'error') {
                    context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: data.detail });
                } else {
                    context.tracer.endSpan(span, SpanStatus.OK);
                }
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
            const errRes: EngineResponse = { success: false, result: `Error during QIS Get Grammar: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        } finally {
            // 4. Delete IPC files
            localStore.deleteFile(requestFilePath);
            localStore.deleteFile(responseFilePath);
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        return { success: true, params: {} };
    }
};

 

export const qisAnalyzeEpiphanyTool: MultiAgentTool = {
    displayName: 'QIS Analyze Epiphany',
    name: 'QIS_ANALYZE_EPIPHANY',

    async execute(_params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        let span: any;
        if (context.tracer && context.activeTraceContext) {
            span = context.tracer.startSpan(context.activeTraceContext, 'QIS_ANALYZE_EPIPHANY', SpanKind.TOOL);
        }

        const localStore = new LocalStoreManager();
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_analyze_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 100;
        const maxPollingTimeMs = 30000; // 30 seconds

        try {
            // 1. Write request file
            const requestData = {
                timestamp: Date.now(),
                // Add any other parameters needed by the Python backend for analysis
            };
            localStore.writeState(requestFilePath, requestData);
            console.error(`[QIS_ANALYZE_EPIPHANY] Request file written to ${requestFilePath}`);

            // 2. Poll for response file
            let responseData: any | null = null;
            const startTime = Date.now();
            while (Date.now() - startTime < maxPollingTimeMs) {
                responseData = localStore.readState(responseFilePath);
                if (responseData) {
                    console.error(`[QIS_ANALYZE_EPIPHANY] Response file read from ${responseFilePath}`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
            }

            if (!responseData) {
                throw new Error(`Timeout: No response file found at ${responseFilePath} within ${maxPollingTimeMs}ms.`);
            }

            // 3. Process response and save topology frame
            const data: any = responseData; // Assuming the response file contains the NNSD matrix and other data
            
            let message = "Successfully generated NNSD matrix statistics.";
            if (data.status === "error") {
                message = data.detail;
            } else if (data.status === "success") {
                message = `Riemann Mapping Extracted. GUE KL Divergence: ${data.metrics.kl_divergence_gue.toFixed(4)} | GOE KL Divergence: ${data.metrics.kl_divergence_goe.toFixed(4)}`;
                localStore.writeTopologyFrame(data); // Save the topology frame

                // Orchestrate render_epiphany.py to generate the GIF
                try {
                    const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
                    const absoluteRenderScriptPath = path.resolve(currentModuleDir, '../../../QIS/render_epiphany.py');
                    const renderScriptCwd = path.dirname(absoluteRenderScriptPath);

                    console.error(`[QIS_ANALYZE_EPIPHANY] Spawning render_epiphany.py from: ${renderScriptCwd}`);
                    const child = processRegistry.spawn(
                        'py',
                        [absoluteRenderScriptPath, '--source', '.swarm/frames', '--out', '.swarm/epiphany_evolution.gif'],
                        { cwd: renderScriptCwd }
                    );
                    child.on('error', (err) => {
                        console.error(`[QIS_ANALYZE_EPIPHANY] Failed to spawn render_epiphany.py: ${err.message}`);
                    });
                    console.error(`[QIS_ANALYZE_EPIPHANY] render_epiphany.py spawned.`);
                } catch (spawnErr: any) {
                    console.error(`[QIS_ANALYZE_EPIPHANY] Failed to spawn render_epiphany.py: ${spawnErr.message}`);
                    // Do not re-throw, allow the analysis to complete even if GIF generation fails
                }
            }

            const res: EngineResponse = { success: data.status === 'success', result: message, telemetry_dump: data };
            
            if (span && context.tracer) {
                if (data.status === 'error') {
                    context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: data.detail });
                } else {
                    context.tracer.endSpan(span, SpanStatus.OK, data.metrics);
                }
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
            const errRes: EngineResponse = { success: false, result: `Error during QIS Epiphany Analysis: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        } finally {
            // 4. Delete IPC files
            localStore.deleteFile(requestFilePath);
            localStore.deleteFile(responseFilePath);
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        return { success: true, params: {} };
    }
};
