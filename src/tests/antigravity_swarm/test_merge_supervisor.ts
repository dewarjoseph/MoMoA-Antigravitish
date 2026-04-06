import { MergeSupervisor } from "../../swarm/merge_supervisor.js";
import { GeminiClient } from "../../services/geminiClient.js";
import { ConcreteInfrastructureContext } from "../../services/infrastructure.js";
import { ApiPolicyManager } from "../../services/apiPolicyManager.js";
import * as assert from "node:assert";

async function run() {
  console.log("Setting up MergeSupervisor test...");

  // Force mock by overwriting geminiClient.sendOneShotMessage
  const infraContext = new ConcreteInfrastructureContext();
  const apiPolicyManager = new ApiPolicyManager();
  const gemini = new GeminiClient(
    { apiKey: "mock-key", context: infraContext },
    apiPolicyManager
  );

  // MOCK
  gemini.sendOneShotMessage = async (prompt, _req) => {
    // If diff has bugs:
    if (prompt.includes("delete_all_files()")) {
      return { text: JSON.stringify({ approved: false, reasoning: "Destructive code detected" }) } as any;
    }
    return { text: JSON.stringify({ approved: true, reasoning: "LGTM" }) } as any;
  };

  const supervisor = new MergeSupervisor(gemini);
  
  // Also mock runGitCommand so we don't accidentally merge in my test
  (supervisor as any).runGitCommand = async (args: string[], cwd: string): Promise<string> => {
    console.log(`[MOCK GIT] ${args.join(" ")}`);
    if (args[0] === 'diff') {
        if (args[1] === 'main...bad-branch') {
             return "+ delete_all_files();";
        }
        return "+ function foo() { return 1; }";
    }
    return "Mock git output";
  };

  console.log("\\nTesting bad code rejection...");
  const badResult = await supervisor.evaluateAndMerge("bad-branch", "s-1", ".", "Implement feature");
  assert.strictEqual(badResult.approved, false);
  console.log("  ✅ PASS: Handled bad code rejection properly.");

  console.log("\\nTesting good code approval & merge...");
  const goodResult = await supervisor.evaluateAndMerge("good-branch", "s-2", ".", "Implement feature");
  assert.strictEqual(goodResult.approved, true);
  console.log("  ✅ PASS: Approved clean code gracefully.");

  process.exit(0);
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
