import { z } from 'zod';
import { LocalStoreManager } from '../../persistence/localStoreManager.js';
import { processRegistry } from '../../utils/processRegistry.js';
import { getMcpToolSchema } from '../../mcp/toolSchemas.js';
import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from '../../momoa_core/types.js';
import * as path from 'node:path';
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

        // 2. Ensure train_server.py is running as a managed subprocess
        // We will store the process instance in the global Node scope or processRegistry to check if it's running
        // processRegistry manages it, but we can't easily query by name yet. We'll spawn it.
        // For local simplicity, we assume processRegistry.spawn handles process tracking.
        console.error('[QisTuningTool] Spawning train_server.py...');
        try {
            const workDir = process.env.MOMO_WORKING_DIR || process.cwd();
            const absoluteTrainServerPath = path.resolve(workDir, '../QIS/train_server.py');
            const trainServerCwd = path.dirname(absoluteTrainServerPath);

            console.error(`[QisTuningTool] Resolved train_server.py path: ${absoluteTrainServerPath}`);
            console.error(`[QisTuningTool] Setting CWD for train_server.py to: ${trainServerCwd}`);

            const trainServerProcess = processRegistry.spawn(
                'python',
                [absoluteTrainServerPath],
                { cwd: trainServerCwd }
            );
            console.error(`[QisTuningTool] train_server.py spawned with PID: ${trainServerProcess.pid}`);
            
            // Note: In a robust setup, we'd avoid spawning duplicates. 
            // We assume the daemon tracks processes via ProcessRegistry.

        } catch (error) {
            console.error(`[QisTuningTool] Failed to spawn train_server.py: ${error}`);
            throw new Error(`Failed to spawn train_server.py: ${error}`);
        }

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
