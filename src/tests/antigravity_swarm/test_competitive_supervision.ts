import { MergeSupervisor } from "../../swarm/merge_supervisor.js";

async function run() {
    console.log("Mocking dependencies for Competitive Supervisor Test...");
    
    // Mock diffs
    const mockDiffs: Record<string, string> = {
        "il-var-bad": "- function do() { }\n+ function do() { syntax error!! }",
        "il-var-good": "- function compute() { return 1; }\n+ function compute() { return 2; } // Fixed math",
        "il-var-meh": "- return 1;\n+ return 1; // no-op"
    };

    const mockSupervisor = new MergeSupervisor({
        sendOneShotMessage: async (prompt: string) => {
            console.log("Analyzing Multi-Diff Prompt. Prompt size:", prompt.length);
            // Simulate Gemini choosing the good diff
            return { text: JSON.stringify({ approved: true, winning_branch_name: "il-var-good", reasoning: "It fixed the math without syntax errors." }) };
        }
    } as any, {} as any);

    // Override the runMcpCommand explicitly
    (mockSupervisor as any).runMcpCommand = async (cmd: string) => {
        console.log(`[EXEC] ${cmd}`);
        if (cmd.includes("git diff")) {
            for (const b of Object.keys(mockDiffs)) {
                if (cmd.includes(b)) return mockDiffs[b];
            }
        }
        return "success";
    };

    console.log("\nRunning competitivelyEvaluateAndMerge...");
    const result = await mockSupervisor.competitivelyEvaluateAndMerge("test-1", ["il-var-bad", "il-var-good", "il-var-meh"], "./", "Fix math");

    console.log("\nResult:", result);
    if (result.approved && result.winningBranch === "il-var-good") {
        console.log("✅ Competitive Merge test passed.");
    } else {
        console.log("❌ Competitive Merge test failed.");
        process.exit(1);
    }
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
