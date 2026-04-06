import * as fs from "node:fs";
import * as path from "node:path";
import { MultiAgentToolContext } from "../../momoa_core/types.js";

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

async function run() {
  console.log("Loading Jules Auto-Triage Tool...");
  const { julesAutoTriageTool } = await import("../../tools/implementations/julesAutoTriageTool.js");
  
  console.log(`Successfully Loaded: ${julesAutoTriageTool.displayName} (${julesAutoTriageTool.name})`);
  
  // Create a mock context to test syntax and extraction
  const mockContext = {
    sendMessage: (msg: string) => console.log(`[Swarm Notify] ${msg}`),
    multiAgentGeminiClient: {
       sendOneShotMessage: async () => ({ text: "YES" }) // Dummy implementation
    }
  } as unknown as MultiAgentToolContext;
  
  console.log("\nTesting Extract Parameters...");
  const paramsResult = await julesAutoTriageTool.extractParameters('{"sessionId":"abcdef-12345"}', mockContext);
  console.log("Extracted Params:", paramsResult);
  
  if (paramsResult.success) {
      console.log("\nExecuting Execution Payload syntax...");
      // We know it will fail naturally here since the session ID is fake
      const res = await julesAutoTriageTool.execute(paramsResult.params as Record<string, string>, mockContext);
      console.log("Triage Yielded:", res);
  }
}

run().catch(console.error);
