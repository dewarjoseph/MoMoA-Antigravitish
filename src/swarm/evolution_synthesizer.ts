import { GeminiClient } from "../services/geminiClient.js";
import { HiveMind } from "../memory/hiveMind.js";
import { SwarmManager } from "./swarm_manager.js";
import { getRawPromptFile } from "../services/promptManager.js";
import { removeBacktickFences } from "../utils/markdownUtils.js";
import { DEFAULT_GEMINI_PRO_MODEL } from "../config/models.js";

export interface PromptVariant {
  variant_id: string;
  mutation_strategy: string;
  prompt_text: string;
  theoretical_advantage: string;
}

export class EvolutionSynthesizer {
  private mutationOperators = [
    "Semantic Crossover (Combine traits of winning prompts and avoid failing ones)",
    "Failure Inversion (Explicitly instruct against behavior seen in rejected variations)",
    "Reasoning Expansion (Add step-by-step or zero-shot chain of thought logic triggers)",
    "Constraint Tightening (Make the prompt more concise, eliminating ambiguity)",
    "Persona Amplification (Deepen the system role/persona constraint)"
  ];

  constructor(
    private hiveMind: HiveMind,
    private swarmManager: SwarmManager,
    private gemini: GeminiClient
  ) {}

  public async synthesizeAndDispatch(
    targetPromptId: string, 
    taskId: string, 
    generationObjective: string, 
    repoRoot: string
  ): Promise<PromptVariant[]> {
    console.log(`[EvolutionSynthesizer] Triggering Evolution Cycle for prompt '${targetPromptId}'`);
    
    // 1. Gather memory context
    const evolutionaryContext = await this.gatherHiveMindSignals(targetPromptId);
    
    // 2. Read live prompt
    let livePrompt = "";
    try {
      livePrompt = await getRawPromptFile(targetPromptId);
    } catch (e) {
      throw new Error(`Failed to read prompt ${targetPromptId}: ${e}`);
    }

    // 3. Evolve via Gemini
    console.log(`[EvolutionSynthesizer] Invoking Gemini for Meta-Evolution. Generating variants...`);
    const variants = await this.synthesizeVariantsWithGemini(livePrompt, evolutionaryContext, 3, generationObjective);

    if (variants.length === 0) {
        throw new Error("Meta-Evolutionary Intelligence failed to generate variants or failed to parse output.");
    }

    // 4. Dispatch using Intelligence Loop
    console.log(`[EvolutionSynthesizer] Dispatching ${variants.length} intelligence variants for task '${taskId}'`);
    await this.swarmManager.runIntelligenceLoopExperiment(
        taskId,
        generationObjective,
        variants.map(v => ({ id: v.variant_id, prompt: v.prompt_text })),
        repoRoot
    );

    return variants;
  }

  private async gatherHiveMindSignals(promptId: string) {
      console.log(`[EvolutionSynthesizer] Gathering memory for ${promptId}...`);
      try {
        const winners = await this.hiveMind.query(`merge-winner ${promptId}`, 3);
        const losers = await this.hiveMind.query(`merge-rejected ${promptId}`, 3);
        return { 
          winners: winners.map(r => r.triplet.action + '\\n' + r.triplet.outcome), 
          losers: losers.map(r => r.triplet.action + '\\n' + r.triplet.outcome) 
        };
      } catch (err) {
        console.warn(`[EvolutionSynthesizer] HiveMind query issue (using empty context): ${err}`);
        return { winners: [], losers: [] };
      }
  }

  private async synthesizeVariantsWithGemini(livePrompt: string, context: any, numVariants: number, objective: string): Promise<PromptVariant[]> {
      const metaPrompt = `
You are an elite Meta-Evolutionary Intelligence acting within the MoMoA Swarm architecture.
Your objective is to mathematically and structurally optimize the system prompt for an internal agent capability.

CURRENT TARGET OBJECTIVE THE NEW PROMPT MUST SOLVE:
"${objective}"

CURRENT LIVE PROMPT (The ancestor/current standard):
\`\`\`markdown
${livePrompt}
\`\`\`

EVOLUTIONARY HISTORY (Memory context from past implementations):
- SUCCESSFUL EXPERIMENTS (What worked): ${JSON.stringify(context.winners)}
- FAILED EXPERIMENTS (What didn't): ${JSON.stringify(context.losers)}

AVAILABLE MUTATION OPERATORS:
${this.mutationOperators.join("\n")}

INSTRUCTIONS:
1. Analyze why past ancestors won or failed based on embedded history.
2. Apply distinct mutation operators to the CURRENT LIVE PROMPT to generate exactly ${numVariants} new, highly optimized variants.
3. Your variants must be fully formed, directly usable markdown strings ready to be injected. Incorporate YAML frontmatter exactly as the ancestor has.
4. Output STRICTLY IN JSON format containing EXACTLY an array of ${numVariants} objects matching this schema:
[
  {
    "variant_id": "genX-var1", 
    "mutation_strategy": "Name of operator used", 
    "prompt_text": "The entire mutated markdown string with frontmatter", 
    "theoretical_advantage": "Why this variant will succeed"
  }
]
`;
      const response = await this.gemini.sendOneShotMessage(metaPrompt, { model: DEFAULT_GEMINI_PRO_MODEL });
      if (!response?.text) return [];

      try {
          const clean = removeBacktickFences(response.text);
          const parsed = JSON.parse(clean);
          if (Array.isArray(parsed)) {
              return parsed as PromptVariant[];
          }
      } catch (err) {
          console.error(`[EvolutionSynthesizer] JSON parsing failed from Gemini response: ${err}`);
      }
      return [];
  }
}
