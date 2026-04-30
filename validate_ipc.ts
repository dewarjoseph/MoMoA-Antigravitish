import { qisInjectDataTool, qisGetGrammarTool, qisAnalyzeEpiphanyTool } from './src/tools/implementations/qisEngineTool.js';
import { MultiAgentToolContext } from './src/momoa_core/types.js';

async function validate() {
    console.log("Validating QIS_INJECT_DATA...");
    const mockContext: MultiAgentToolContext = {
        config: {},
        currentBranch: 'main',
        mcpConnections: new Map()
    } as any;
    
    try {
        const injectResult = await qisInjectDataTool.execute({ text: "This is a validation test for the QIS structural engine using IPC." }, mockContext);
        console.log("INJECT RESULT:", injectResult);
        
        console.log("Validating QIS_GET_GRAMMAR...");
        const grammarResult = await qisGetGrammarTool.execute({}, mockContext);
        console.log("GRAMMAR RESULT:", grammarResult);
        
        console.log("Validating QIS_ANALYZE_EPIPHANY...");
        const epiphanyResult = await qisAnalyzeEpiphanyTool.execute({}, mockContext);
        console.log("EPIPHANY RESULT:", epiphanyResult);
        
        console.log("Validation complete.");
    } catch (err) {
        console.error("Validation error:", err);
    }
}

validate();
