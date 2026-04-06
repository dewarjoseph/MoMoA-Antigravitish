import { SwarmManager } from "../../swarm/swarm_manager.js";
import { LocalStore } from "../../persistence/local_store.js";
import * as path from "node:path";

async function run() {
  console.log("Setting up SwarmManager against novel repo...");
  
  // Point the store locally to MoMoA-TestBed's .swarm dir
  const targetDir = "c:\\\\Users\\\\Joe\\\\source\\\\MoMoA-TestBed";
  const store = new LocalStore(path.join(targetDir, ".swarm"));
  const manager = new SwarmManager(store);

  console.log("Mocking Jules to return valid Session output...");
  (manager as any).spawnJulesWorker = async (prompt: string, repo: string, branch?: string) => {
    // We will simulate jules remote new behavior
    return `Session is created.\\nID: 998877665544332211\\nTask: mock\\n\\nURL: https://mock`;
  };

  const dispatched = await manager.dispatch({
    count: 1,
    targetDir: targetDir,
    repo: ".",
    branch: "master",
    strategies: ["mock_strategy_fibonacci"]
  });

  console.log("Dispatched sessions:", dispatched);
  console.log("Wait to see if store received session...");
  
  const sessions = store.listSessions();
  console.log("Sessions in store:", sessions);

}

run().catch(console.error);
