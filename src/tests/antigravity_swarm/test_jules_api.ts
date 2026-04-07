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
import { SwarmTracer } from '../../telemetry/tracer.js';

async function run() {
  SwarmTracer.getInstance().emitLog("Initializing Jules REST API Client natively...");
  const client = new JulesClient();

  SwarmTracer.getInstance().emitLog("\\n1. Testing: List Sources...");
  try {
    const sources = await client.listSources(3);
    SwarmTracer.getInstance().emitLog("Success! Found sources:");
    sources.sources?.forEach((s: any) => SwarmTracer.getInstance().emitLog(`   - ${s.name} (${s.githubRepo?.owner}/${s.githubRepo?.repo})`));
  } catch (e: any) {
    SwarmTracer.getInstance().emitLog("List Sources failed:", e.message);
  }

  SwarmTracer.getInstance().emitLog("\\n2. Testing: Tool Abstractions Native Parse...");
  import("../../tools/implementations/julesCreateSessionTool.js").then(({ julesCreateSessionTool }) => {
    SwarmTracer.getInstance().emitLog(`Tool Loaded: ${julesCreateSessionTool.displayName}`);
    SwarmTracer.getInstance().emitLog(`Command key: ${julesCreateSessionTool.name}`);
  });
}

run().catch(console.error);
