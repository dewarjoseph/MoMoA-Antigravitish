import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import { SpanKind, SpanStatus } from '../../telemetry/types.js';
import * as fs from 'fs';
import * as path from 'path';

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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
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

        try {
            const response = await fetchWithTimeout('http://127.0.0.1:8000/inject_text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text_input: dataParams.text })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const res: EngineResponse = { success: true, result: JSON.stringify(data), telemetry_dump: data };

            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.OK);
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
            const errRes: EngineResponse = { success: false, result: `Error communicating with QIS Backend: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        try {
            return { success: true, params: JSON.parse(invocation.trim()) };
        } catch {
            return { success: true, params: { text: invocation.trim() } };
        }
    }
};

export const qisGetGrammarTool: MultiAgentTool = {
    displayName: 'QIS Get Grammar',
    name: 'QIS_GET_GRAMMAR',

    async execute(_params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        let span: any;
        if (context.tracer && context.activeTraceContext) {
            span = context.tracer.startSpan(context.activeTraceContext, 'QIS_GET_GRAMMAR', SpanKind.TOOL);
        }

        try {
            const response = await fetchWithTimeout('http://127.0.0.1:8000/grammar', { method: 'GET' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            const res: EngineResponse = { success: true, result: "Successfully fetched grammar.", telemetry_dump: data };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.OK);
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
            const errRes: EngineResponse = { success: false, result: `Error communicating with QIS Backend: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        return { success: true, params: {} };
    }
};

export const qisTunePhysicsTool: MultiAgentTool = {
    displayName: 'QIS Tune Physics',
    name: 'QIS_TUNE_PHYSICS',

    async execute(params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        let span: any;
        if (context.tracer && context.activeTraceContext) {
            span = context.tracer.startSpan(context.activeTraceContext, 'QIS_TUNE_PHYSICS', SpanKind.TOOL, { params: JSON.stringify(params) });
        }

        const tuneParams = params as QISTuneParams;
        const tuneReq: Record<string, number> = {};
        if (tuneParams.wDisorder !== undefined) tuneReq.W_DISORDER = tuneParams.wDisorder;
        if (tuneParams.pinkNoiseAlpha !== undefined) tuneReq.PINK_NOISE_ALPHA = tuneParams.pinkNoiseAlpha;
        if (tuneParams.pinkNoiseScale !== undefined) tuneReq.PINK_NOISE_SCALE = tuneParams.pinkNoiseScale;
        if (tuneParams.decoherenceFactor !== undefined) tuneReq.DECOHERENCE_FACTOR = tuneParams.decoherenceFactor;
        if (tuneParams.plasticityScale !== undefined) tuneReq.PLASTICITY_SCALE = tuneParams.plasticityScale;
        if (tuneParams.thermalCooling !== undefined) tuneReq.THERMAL_COOLING = tuneParams.thermalCooling;

        try {
            const response = await fetchWithTimeout('http://127.0.0.1:8000/tune', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tuneReq)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            const data = await response.json();

            const qisDir = path.resolve(process.cwd(), '../QIS');
            const configPath = path.join(qisDir, 'config.py');
            if (fs.existsSync(configPath)) {
                let configContent = fs.readFileSync(configPath, 'utf8');
                if (tuneParams.wDisorder !== undefined) configContent = configContent.replace(/W_DISORDER\s*=\s*[\d\.]+/, `W_DISORDER = ${tuneParams.wDisorder}`);
                if (tuneParams.pinkNoiseAlpha !== undefined) configContent = configContent.replace(/PINK_NOISE_ALPHA\s*=\s*[\d\.]+/, `PINK_NOISE_ALPHA = ${tuneParams.pinkNoiseAlpha}`);
                if (tuneParams.pinkNoiseScale !== undefined) configContent = configContent.replace(/PINK_NOISE_SCALE\s*=\s*[\d\.]+/, `PINK_NOISE_SCALE = ${tuneParams.pinkNoiseScale}`);
                if (tuneParams.decoherenceFactor !== undefined) configContent = configContent.replace(/DECOHERENCE_FACTOR\s*=\s*[\d\.]+/, `DECOHERENCE_FACTOR = ${tuneParams.decoherenceFactor}`);
                if (tuneParams.plasticityScale !== undefined) configContent = configContent.replace(/PLASTICITY_SCALE\s*=\s*[\d\.]+/, `PLASTICITY_SCALE = ${tuneParams.plasticityScale}`);
                if (tuneParams.thermalCooling !== undefined) configContent = configContent.replace(/THERMAL_COOLING\s*=\s*[\d\.]+/, `THERMAL_COOLING = ${tuneParams.thermalCooling}`);
                fs.writeFileSync(configPath, configContent, 'utf8');
            }

            const res: EngineResponse = { success: true, result: "Tuning successful.", telemetry_dump: data };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.OK);
            }
            return { result: JSON.stringify(res) };
        } catch (err: any) {
            const errRes: EngineResponse = { success: false, result: `Error communicating with QIS Backend: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        try {
            return { success: true, params: JSON.parse(invocation.trim()) };
        } catch {
            return { success: true, params: {} };
        }
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

        try {
            const response = await fetchWithTimeout('http://127.0.0.1:8000/analyze_epiphany', { method: 'GET' }, 30000);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            const data: any = await response.json();
            
            let message = "Successfully generated NNSD matrix statistics.";
            if (data.status === "error") {
                message = data.detail;
            } else if (data.status === "success") {
                message = `Riemann Mapping Extracted. GUE KL Divergence: ${data.metrics.kl_divergence_gue.toFixed(4)} | GOE KL Divergence: ${data.metrics.kl_divergence_goe.toFixed(4)}`;
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
            const errRes: EngineResponse = { success: false, result: `Error communicating with QIS Backend: ${err.message}` };
            if (span && context.tracer) {
                context.tracer.endSpan(span, SpanStatus.ERROR, { errorMessage: err.message });
            }
            return { result: JSON.stringify(errRes) };
        }
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        return { success: true, params: {} };
    }
};
