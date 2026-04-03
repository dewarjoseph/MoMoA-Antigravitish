import { OptimizerTool } from './src/tools/implementations/optimizerTool.ts';
import { MultiAgentToolContext } from './src/momoa_core/types.ts';

async function testNativeOptimize() {
    console.log("NATIVE MEMORY BYPASS: Firing Optimization Sequence.");
    
    // We mock the context
    const mockContext: MultiAgentToolContext = {
       infrastructureContext: { getSessionId: () => "manual_test_session" },
       multiAgentGeminiClient: null as any,
       fileMap: new Map(),
       binaryFileMap: new Map(),
       sendMessage: (msg: string) => {
           try {
               const parsed = JSON.parse(msg);
               console.log("[MOMO PROGRESS]:", parsed.completed_status_message);
           } catch { console.log(msg); }
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
