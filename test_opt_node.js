const { OptimizerTool } = require('./dist/tools/implementations/optimizerTool.js');

async function testNativeOptimize() {
    console.log("NATIVE NODE: Firing Optimization Sequence.");
    
    // We mock the context
    const mockContext = {
       infrastructureContext: { getSessionId: () => "manual_test_session" },
       multiAgentGeminiClient: null,
       fileMap: new Map(),
       binaryFileMap: new Map(),
       sendMessage: (msg) => {
           try {
               const parsed = JSON.parse(msg);
               console.log("[MOMO PROGRESS]:", parsed.completed_status_message);
           } catch (e) { console.log(msg); }
       },
       editedFilesSet: new Set()
    };
    
    try {
       const res = await OptimizerTool.execute({
           evaluator_script: "src/utils/optimizerTarget.ts:evaluate",
           search_space: JSON.stringify({ chunk_size: [100, 500, 1000], threads: [1, 2, 4] }),
           goal: "max",
           budget: 0,
           trials: 1
       }, mockContext);
       
       console.log("\n====== FINAL RESULT ======");
       console.log(res.result);
    } catch (err) {
       console.error("Execution exception:", err);
    }
}

testNativeOptimize();
