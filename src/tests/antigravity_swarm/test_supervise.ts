import * as fs from "node:fs";
import * as path from "node:path";

// Load .env explicitly for test since we don't have dotenv module
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

import { superviseMergeTool } from "../../tools/implementations/superviseMergeTool.js";
import { ConcreteInfrastructureContext } from "../../services/infrastructure.js";

async function run() {
  const context = {
    geminiClient: undefined,
    sendMessage: (msg: string) => console.log(msg),
    infrastructureContext: new ConcreteInfrastructureContext(),
    activeResourceUris: []
  } as any;

  console.log("Invoking SUPERVISE_MERGE tool on MoMoA-TestBed -> feature-fibonacci");
  
  const result = await superviseMergeTool.execute({
      branch: "feature-fibonacci", // the branch we tested previously
      sessionTitle: "Implement efficient O(N) iterative Fibonacci sequence calculation without recursive depth issues.",
      repoPath: "c:\\\\Users\\\\Joe\\\\source\\\\MoMoA-TestBed"
  }, context);

  console.log("Merge Tool Output:");
  console.log(result.result);
}

run().catch(console.error);
