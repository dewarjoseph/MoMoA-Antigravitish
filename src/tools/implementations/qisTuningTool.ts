import { z } from 'zod';
import { LocalStoreManager } from '../../persistence/localStoreManager.js';
import { processRegistry } from '../../utils/processRegistry.js';
import { getMcpToolSchema } from '../../mcp/toolSchemas.js';
import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import * as path from 'node:path';
import { ensureTrainServerRunning } from './qisEngineTool.js';
export interface QisTunePhysicsParams {
    wDisorder?: number;
    pinkNoiseAlpha?: number;
    pinkNoiseScale?: number;
    decoherenceFactor?: number;
    plasticityScale?: number;
    thermalCooling?: number;
}

export const qisTuningTool: MultiAgentTool = {
    displayName: 'QIS Tune Physics',
    name: 'QIS_TUNE_PHYSICS',

    async execute(params: any, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
        const localStoreManager = new LocalStoreManager();
        const qisConfigPath = '.swarm/qis_config.json';
        
        const typedParams = params as QisTunePhysicsParams;

        // 1. Validate and write parameters to local file
        localStoreManager.writeState(qisConfigPath, typedParams, 'QIS_TUNE_PHYSICS');
        console.error(`[QisTuningTool] QIS tuning parameters written to ${qisConfigPath}`);

        // 2. Ensure train_server.py is running
        await ensureTrainServerRunning(localStoreManager);

        return { result: `QIS tuning parameters applied and train_server.py ensured running. Config: ${JSON.stringify(params)}` };
    },

    async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
        try {
            const params = JSON.parse(invocation);
            return { success: true, params };
        } catch (err) {
            return { success: false, error: 'Invalid JSON parameters' };
        }
    }
};
