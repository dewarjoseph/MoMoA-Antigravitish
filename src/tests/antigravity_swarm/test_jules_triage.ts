import * as fs from "node:fs";
import * as path from "node:path";
import { MultiAgentToolContext } from "../../momoa_core/types.js";
import { SwarmTracer } from '../../telemetry/tracer.js';

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
  SwarmTracer.getInstance().emitLog("Loading Jules Auto-Triage Tool...");
  const { julesAutoTriageTool } = await import("../../tools/implementations/julesAutoTriageTool.js");
  
  SwarmTracer.getInstance().emitLog(`Successfully Loaded: ${julesAutoTriageTool.displayName} (${julesAutoTriageTool.name})`);
  
  // Create a mock context to test syntax and extraction
  const mockContext = {
    originalFileMap: new Map(),
    fileMap: new Map(),
    editedFilesSet: new Set(),
    binaryFileMap: new Map(),
    originalBinaryFileMap: new Map(),
    sendMessage: (msg: string) => SwarmTracer.getInstance().emitLog(`[Swarm Notify] ${msg}`),
    multiAgentGeminiClient: {
       sendOneShotMessage: async () => ({ text: "YES" }) // Dummy implementation
    }
  } as unknown as MultiAgentToolContext;
  
  SwarmTracer.getInstance().emitLog("\nTesting Extract Parameters...");
  const paramsResult = await julesAutoTriageTool.extractParameters('{"sessionId":"abcdef-12345"}', mockContext);
  SwarmTracer.getInstance().emitLog("Extracted Params:", paramsResult);
  
  if (paramsResult.success) {
      SwarmTracer.getInstance().emitLog("\nExecuting Execution Payload syntax...");
      // We know it will fail naturally here since the session ID is fake
      const res = await julesAutoTriageTool.execute(paramsResult.params as Record<string, string>, mockContext);
      SwarmTracer.getInstance().emitLog("Triage Yielded:", res);
  }
}

run().catch(console.error);
