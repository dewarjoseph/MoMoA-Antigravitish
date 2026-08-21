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
    text_input: string;
}

export interface EngineResponse {
    success: boolean;
    result: string;
    telemetry_dump?: any;
}

export function findTrainServerScript(): string | null {
    const workDir = process.env.MOMO_WORKING_DIR || process.cwd();
    const candidates = [
        path.resolve(workDir, '../QIS/train_server.py'),
        path.resolve(workDir, 'train_server.py'),
        'C:/Users/Joe/source/QIS/train_server.py',
        path.resolve(__dirname, '../../../../QIS/train_server.py'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

export function findRenderScript(): string | null {
    const workDir = process.env.MOMO_WORKING_DIR || process.cwd();
    const candidates = [
        path.resolve(workDir, '../QIS/render_epiphany.py'),
        path.resolve(workDir, 'render_epiphany.py'),
        'C:/Users/Joe/source/QIS/render_epiphany.py',
        path.resolve(__dirname, '../../../../QIS/render_epiphany.py'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

export async function ensureTrainServerRunning(localStore: LocalStoreManager): Promise<void> {
    const uniqueId = crypto.randomUUID();
    const requestFilePath = `.swarm/ipc/req_status_${uniqueId}.json`;
    const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
    
    localStore.writeState(requestFilePath, { timestamp: Date.now() });
    
    let running = false;
    for (let i = 0; i < 10; i++) {
        if (localStore.readState(responseFilePath)) {
            running = true;
            break;
        }
        await new Promise(r => setTimeout(r, 50));
    }
    
    localStore.deleteFile(requestFilePath);
    localStore.deleteFile(responseFilePath);
    
    if (!running) {
        const scriptPath = findTrainServerScript();
        if (scriptPath) {
            console.error(`[QIS] train_server.py not responding. Spawning from: ${scriptPath}`);
            const trainServerCwd = path.dirname(scriptPath);
            const isWin = process.platform === 'win32';
            const cmd = isWin ? 'py' : 'python3';
            const args = isWin ? ['-3', scriptPath] : [scriptPath];
            try {
                processRegistry.spawn(cmd, args, { cwd: trainServerCwd, shell: isWin });
                await new Promise(r => setTimeout(r, 1000));
            } catch (spawnErr) {
                console.error(`[QIS] Failed to spawn train_server.py:`, spawnErr);
            }
        } else {
            console.error('[QIS] train_server.py script not found in candidate paths.');
        }
    }
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

        if (!dataParams || !dataParams.text_input) {
            const errRes: EngineResponse = { success: false, result: "Error: Missing 'text_input' parameter" };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: 'Missing text_input parameter' });
            }
            return { result: JSON.stringify(errRes) };
        }

        const localStore = new LocalStoreManager();
        await ensureTrainServerRunning(localStore);
        
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_inject_text_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 50;
        const maxPollingTimeMs = 5000; // 5 seconds bounded timeout

        try {
            // 1. Write request file
            const requestData = {
                timestamp: Date.now(),
                text_input: dataParams.text_input,
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
                throw new Error(`Timeout: QIS engine train_server.py did not respond within ${maxPollingTimeMs}ms.`);
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
        return { success: true, params: { text_input: invocation } };
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
        await ensureTrainServerRunning(localStore);
        
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_grammar_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 50;
        const maxPollingTimeMs = 5000; // 5 seconds bounded timeout

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
                throw new Error(`Timeout: QIS engine train_server.py did not respond within ${maxPollingTimeMs}ms.`);
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
        await ensureTrainServerRunning(localStore);
        
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_analyze_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 50;
        const maxPollingTimeMs = 5000; // 5 seconds bounded timeout

        try {
            // 1. Write request file
            const requestData = {
                timestamp: Date.now(),
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
                throw new Error(`Timeout: QIS engine train_server.py did not respond within ${maxPollingTimeMs}ms.`);
            }

            // 3. Process response and save topology frame
            const data: any = responseData;
            
            let message = "Successfully generated NNSD matrix statistics.";
            if (data.status === "error") {
                message = data.detail;
            } else if (data.status === "success") {
                message = `Riemann Mapping Extracted. GUE KL Divergence: ${data.metrics?.kl_divergence_gue?.toFixed(4) ?? 'N/A'} | GOE KL Divergence: ${data.metrics?.kl_divergence_goe?.toFixed(4) ?? 'N/A'}`;
                localStore.writeTopologyFrame(data);

                // Orchestrate render_epiphany.py to generate the GIF
                try {
                    const renderScriptPath = findRenderScript();
                    if (renderScriptPath) {
                        const renderScriptCwd = path.dirname(renderScriptPath);
                        console.error(`[QIS_ANALYZE_EPIPHANY] Spawning render_epiphany.py from: ${renderScriptCwd}`);
                        const isWin = process.platform === 'win32';
                        const cmd = isWin ? 'py' : 'python3';
                        const args = isWin 
                            ? ['-3', renderScriptPath, '--source', '.swarm/frames', '--out', '.swarm/epiphany_evolution.gif']
                            : [renderScriptPath, '--source', '.swarm/frames', '--out', '.swarm/epiphany_evolution.gif'];
                        const child = processRegistry.spawn(cmd, args, { cwd: renderScriptCwd, shell: isWin });
                        child.on('error', (err) => {
                            console.error(`[QIS_ANALYZE_EPIPHANY] Failed to spawn render_epiphany.py: ${err.message}`);
                        });
                    }
                } catch (spawnErr: any) {
                    console.error(`[QIS_ANALYZE_EPIPHANY] Failed to spawn render_epiphany.py: ${spawnErr.message}`);
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

export const qisManageServerTool: MultiAgentTool = {
    displayName: 'QIS Manage Server',
    name: 'QIS_MANAGE_SERVER',

    async execute(params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        let span: any;
        if (context.tracer && context.activeTraceContext) {
            span = context.tracer.startSpan(context.activeTraceContext, 'QIS_MANAGE_SERVER', SpanKind.TOOL);
        }

        const action = params?.action; // "clear_state" or "shutdown"
        if (action !== "clear_state" && action !== "shutdown") {
            const errRes: EngineResponse = { success: false, result: `Error: Invalid action '${action}'. Expected 'clear_state' or 'shutdown'.` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: 'Invalid action' });
            }
            return { result: JSON.stringify(errRes) };
        }

        const localStore = new LocalStoreManager();
        await ensureTrainServerRunning(localStore);
        
        const uniqueId = crypto.randomUUID();
        const requestFilePath = `.swarm/ipc/req_${action}_${uniqueId}.json`;
        const responseFilePath = `.swarm/ipc/res_${uniqueId}.json`;
        const pollingIntervalMs = 100;
        const maxPollingTimeMs = 5000;

        try {
            const requestData = { timestamp: Date.now() };
            localStore.writeState(requestFilePath, requestData);

            let responseData: any | null = null;
            const startTime = Date.now();
            while (Date.now() - startTime < maxPollingTimeMs) {
                responseData = localStore.readState(responseFilePath);
                if (responseData) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
            }

            if (!responseData && action !== "shutdown") {
                 throw new Error(`Timeout: No response file found at ${responseFilePath} within ${maxPollingTimeMs}ms.`);
            }

            // For shutdown, it might delete the file before we read it, or exit before responding if the race condition favors the exit.
            const data = responseData || { status: 'success', detail: 'Shutdown command sent (no response collected before process exit)' };
            const res: EngineResponse = { success: data.status === 'success' || data.status === undefined, result: JSON.stringify(data), telemetry_dump: data };

            if (span && context.tracer) {
                if (data.status === 'error') {
                    context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: data.detail });
                } else {
                    context.tracer.endSpan(span, SpanStatus.OK);
                }
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
             const errRes: EngineResponse = { success: false, result: `Error during QIS Manage Server: ${err.message}` };
             if (span && context.tracer) {
                 context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
             }
             return { result: JSON.stringify(errRes) };
        } finally {
            localStore.deleteFile(requestFilePath);
            localStore.deleteFile(responseFilePath);
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        return { success: true, params: { action: invocation.trim() } };
    }
};
