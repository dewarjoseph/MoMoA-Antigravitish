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

import { JulesClient } from "../../services/julesClient.js";

async function run() {
  console.log("Initializing Jules REST API Client natively...");
  const client = new JulesClient();

  console.log("\\n1. Testing: List Sources...");
  try {
    const sources = await client.listSources(3);
    console.log("Success! Found sources:");
    sources.sources?.forEach((s: any) => console.log(`   - ${s.name} (${s.githubRepo?.owner}/${s.githubRepo?.repo})`));
  } catch (e: any) {
    console.error("List Sources failed:", e.message);
  }

  console.log("\\n2. Testing: Tool Abstractions Native Parse...");
  import("../../tools/implementations/julesCreateSessionTool.js").then(({ julesCreateSessionTool }) => {
    console.log(`Tool Loaded: ${julesCreateSessionTool.displayName}`);
    console.log(`Command key: ${julesCreateSessionTool.name}`);
  });
}

run().catch(console.error);
