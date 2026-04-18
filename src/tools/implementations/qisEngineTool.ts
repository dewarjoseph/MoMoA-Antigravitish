import { MultiAgentTool } from '../multiAgentTool.js';
import {
  MultiAgentToolResult,
  MultiAgentToolContext,
  ToolParsingResult,
} from '../../momoa_core/types.js';
import * as fs from 'fs';
import * as path from 'path';

export const qisInjectDataTool: MultiAgentTool = {
    displayName: 'QIS Inject Data',
    name: 'QIS_INJECT_DATA',

    async execute(params: any, _context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        if (!params.text) {
            return { result: "Error: Missing 'text' parameter" };
        }
        try {
            const response = await fetch('http://127.0.0.1:8000/inject_text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: params.text })
            });
            const data = await response.json();
            return { result: JSON.stringify(data) };
        } catch (err: any) {
            return { result: `Error communicating with QIS Backend: ${err.message}` };
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

    async execute(_params: any, _context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        try {
            const response = await fetch('http://127.0.0.1:8000/grammar');
            const data = await response.json();
            return { result: JSON.stringify(data) };
        } catch (err: any) {
            return { result: `Error communicating with QIS Backend: ${err.message}` };
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
        const tuneReq: any = {};
        if (params.wDisorder !== undefined) tuneReq.W_DISORDER = params.wDisorder;
        if (params.pinkNoiseAlpha !== undefined) tuneReq.PINK_NOISE_ALPHA = params.pinkNoiseAlpha;
        if (params.pinkNoiseScale !== undefined) tuneReq.PINK_NOISE_SCALE = params.pinkNoiseScale;
        if (params.decoherenceFactor !== undefined) tuneReq.DECOHERENCE_FACTOR = params.decoherenceFactor;
        if (params.plasticityScale !== undefined) tuneReq.PLASTICITY_SCALE = params.plasticityScale;
        if (params.thermalCooling !== undefined) tuneReq.THERMAL_COOLING = params.thermalCooling;

        try {
            const response = await fetch('http://127.0.0.1:8000/tune', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tuneReq)
            });
            const data = await response.json();

            const qisDir = path.resolve(process.cwd(), '../QIS');
            const configPath = path.join(qisDir, 'config.py');
            if (fs.existsSync(configPath)) {
                let configContent = fs.readFileSync(configPath, 'utf8');
                if (params.wDisorder !== undefined) configContent = configContent.replace(/W_DISORDER\s*=\s*[\d\.]+/, `W_DISORDER = ${params.wDisorder}`);
                if (params.pinkNoiseAlpha !== undefined) configContent = configContent.replace(/PINK_NOISE_ALPHA\s*=\s*[\d\.]+/, `PINK_NOISE_ALPHA = ${params.pinkNoiseAlpha}`);
                if (params.pinkNoiseScale !== undefined) configContent = configContent.replace(/PINK_NOISE_SCALE\s*=\s*[\d\.]+/, `PINK_NOISE_SCALE = ${params.pinkNoiseScale}`);
                if (params.decoherenceFactor !== undefined) configContent = configContent.replace(/DECOHERENCE_FACTOR\s*=\s*[\d\.]+/, `DECOHERENCE_FACTOR = ${params.decoherenceFactor}`);
                if (params.plasticityScale !== undefined) configContent = configContent.replace(/PLASTICITY_SCALE\s*=\s*[\d\.]+/, `PLASTICITY_SCALE = ${params.plasticityScale}`);
                if (params.thermalCooling !== undefined) configContent = configContent.replace(/THERMAL_COOLING\s*=\s*[\d\.]+/, `THERMAL_COOLING = ${params.thermalCooling}`);
                fs.writeFileSync(configPath, configContent, 'utf8');
            }

            return { result: JSON.stringify(data) };
        } catch (err: any) {
            return { result: `Error communicating with QIS Backend: ${err.message}` };
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
