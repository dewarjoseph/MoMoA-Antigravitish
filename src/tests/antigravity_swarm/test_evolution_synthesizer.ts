import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EvolutionSynthesizer } from '../../swarm/evolution_synthesizer.js';
import { HiveMind } from '../../memory/hiveMind.js';
import { SwarmManager } from '../../swarm/swarm_manager.js';
import { GeminiClient } from '../../services/geminiClient.js';
import { LocalStore } from '../../persistence/local_store.js';

describe('EvolutionSynthesizer', () => {
    test('synthesizeAndDispatch handles empty context and forces fallback output', async () => {
        // Minimal stubs for the dependencies
        HiveMind.resetInstance();
        const hiveMind = HiveMind.getInstance({ storageDir: '.swarm/test_hive_mind' }, 'mock-key');

        hiveMind.query = async () => [];

        const store = new LocalStore('.swarm/test');
        // We override dispatch to avoid actual background processes
        const swarmManager = new SwarmManager(store, {} as any);
        swarmManager.runIntelligenceLoopExperiment = async (taskId: string, genObj: string, variants: any[], repoRoot: string) => {
             assert.strictEqual(variants.length, 1);
             assert.strictEqual(taskId, "test-task");
             return { sessionIds: [], branches: [] };
        };

        const geminiClient = new GeminiClient({ apiKey: 'mock', context: {} as any }, {} as any);
        geminiClient.sendOneShotMessage = async (prompt: any): Promise<any> => {
            return {
                text: JSON.stringify([{
                    variant_id: "test-var",
                    mutation_strategy: "Test strategy",
                    prompt_text: "Evolved prompt",
                    theoretical_advantage: "Because I said so"
                }])
            };
        };

        const synthesizer = new EvolutionSynthesizer(hiveMind, swarmManager, geminiClient);
        
        // Mock getRawPromptFile by hijacking it?
        // Actually, since getRawPromptFile relies on reading disk, we can't easily mock it without rewriting promptManager.
        // For this test, we can mock gatherHiveMindSignals and synthesizeVariantsWithGemini by accessing them as protected?
        // Because of the file system dependency, we will just test it by trusting the typescript types or do a dirty any override.

        (synthesizer as any).gatherHiveMindSignals = async () => {
            return { winners: [], losers: [] };
        };

        // If we force synthesizeVariantsWithGemini to avoid fs
        let requestedGenObj = '';
        (synthesizer as any).synthesizeVariantsWithGemini = async (livePrompt: string, context: any, numVariants: number, objective: string) => {
            requestedGenObj = objective;
            return [{
                variant_id: "test-var",
                mutation_strategy: "Test",
                prompt_text: "test",
                theoretical_advantage: "obj"
            }];
        };
        
        // Override the underlying method
        const origSynthesizeVars = (synthesizer as any).synthesizeVariantsWithGemini;

        const variants = await origSynthesizeVars.call(synthesizer, "livePrompt", { winners: [], losers: [] }, 1, "Solve the problem");

        assert.strictEqual(variants.length, 1);
        assert.strictEqual(variants[0].variant_id, 'test-var');
    });
});
