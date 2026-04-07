import { MultiAgentTool } from "../multiAgentTool.js";
import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../../momoa_core/types.js";
import { LocalStore } from "../../persistence/local_store.js";
import * as path from 'node:path';

export const EvolutionSynthesizerTool: MultiAgentTool = {
  name: "SYNTHESIZE_EVOLUTION{",
  displayName: "Evolution Synthesizer",
  endToken: "}",

  async execute(params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const targetPromptId = params.targetPromptId as string;
    const taskId = params.taskId as string;
    const generationObjective = params.generationObjective as string;
    const repoRoot = params.repoRoot as string;

    if (!targetPromptId || !taskId || !generationObjective || !repoRoot) {
      return { result: "[ERROR] Missing required parameters: targetPromptId, taskId, generationObjective, or repoRoot." };
    }

    try {
      context.sendMessage(JSON.stringify({
        status: "EVALUATING",
        message: `[Synthesizer] Deep evaluating HiveMind parameters for '${targetPromptId}'...`
      }));

      // Dynamic Imports
      const { GeminiClient } = await import('../../services/geminiClient.js');
      const { ConcreteInfrastructureContext } = await import('../../services/infrastructure.js');
      const { ApiPolicyManager } = await import('../../services/apiPolicyManager.js');
      const { HiveMind } = await import('../../memory/hiveMind.js');
      const { SwarmManager } = await import('../../swarm/swarm_manager.js');
      const { EvolutionSynthesizer } = await import('../../swarm/evolution_synthesizer.js');

      const geminiClient = new GeminiClient(
        { apiKey: process.env.GEMINI_API_KEY ?? '', context: new ConcreteInfrastructureContext() },
        new ApiPolicyManager()
      );

      const store = new LocalStore(path.join(repoRoot, '.swarm'));
      const hiveMind = HiveMind.getInstance();
      const swarmManager = new SwarmManager(store, context);

      const synthesizer = new EvolutionSynthesizer(hiveMind, swarmManager, geminiClient);

      const variants = await synthesizer.synthesizeAndDispatch(
          targetPromptId, 
          taskId, 
          generationObjective, 
          repoRoot
      );

      return {
        result: JSON.stringify({
          status: "success",
          variantsDispatched: variants.length,
          strategiesApplied: variants.map(v => v.mutation_strategy),
          message: `Deployed ${variants.length} evolved Swarm variants competing to satisfy task '${taskId}'.`,
        }, null, 2)
      };
    } catch (err) {
      return {
        result: `[ERROR] Synthesizer failed: ${err instanceof Error ? err.stack : String(err)}`
      };
    }
  },

  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    try {
      const jsonString = '{' + invocation.trim() + (invocation.trim().endsWith('}') ? '' : '}');
      const params = JSON.parse(jsonString);
      return { success: true, params };
    } catch (e) {
      return {
        success: false,
        error: `Invalid JSON payload for SYNTHESIZE_EVOLUTION: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  }
};
