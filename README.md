# MoMo Overseer (Antigravity Edition)

**MoMo Overseer** is an autonomous, headless CLI daemon and [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server built to iteratively orchestrate developer workloads using Google's generative models.

Originally branched from the UI-bound Firebase prototype [MoMoA-Researcher](https://github.com/retomeier/MoMoA-Researcher), this repository has been thoroughly sanitized of all frontend bloat (React, Firebase, WebSockets, Express) to operate natively as a pure terminal pipeline inside your isolated development environment.

## Architecture

The system executes AI work phases strictly in an unattended `[Headless Mode]` using a `.swarm/` local disk manifest.
* **Local Persistence:** All logging, work transcripts, and session tracking states operate over standard NodeJS `fs` modules entirely inside the `.swarm/` map. No external databases are required.
* **Zero Ram Footprint:** A `LazyMap` filesystem crawler ensures huge monolith codebases can be discovered and reasoned over dynamically without causing background V8 memory leaks.
* **MCP Integration:** A bridged `stdio` pipeline exposes `MoMoA`'s 15+ native agentic internal tools dynamically into an MCP-compatible host client. Tools automatically parse standard parameters, dispatch LLMs using API rate-limiting guardrails, and execute file mutations directly to your hard drive.

## Setup & Configuration

This project requires `NodeJS` and is executed via a built `.js` bundle relying locally on AST compilation and text resolution.

**1. Clone and Install Dependencies**
```bash
npm install
npm run build
```

**2. Configure Environment Variables**

Before launching the daemon, provide your runtime credentials.
* `GEMINI_API_KEY`: Required string to invoke Google's reasoning loops.
* `JULES_API_KEY`: Used to spin up distributed swarm branches natively.
* `GITHUB_TOKEN`: Utilized for native issue retrieval tools and git tracking.
* `MOMO_WORKING_DIR`: Sets the target `process.cwd()` boundary condition. Defaults to the launch folder.

## Operating The Daemon

Because it's a CLI tool, you can invoke the pipeline natively from any terminal in your environment:

### Direct Action:
```bash
# Begin tracking swarm deployment tasks
node dist/cli.js swarm monitor

# Evaluate and self-review pending AI tickets
node dist/cli.js swarm triage
```

### The MCP Daemon (Antigravity):
```json
{
  "mcpServers": {
    "momo-overseer": {
      "command": "node",
      "args": [
        "dist/cli.js",
        "daemon"
      ],
      "env": {
        "MOMO_WORKING_DIR": "C:/Path/To/Your/Target/Repo"
      }
    }
  }
}
```

## System Hooks & Safety Bounds

* **Logging Interception:** The script patches native Node `console.log` inside the execution layers to strictly `console.error` to secure the MCP JSON connection from uncontrolled strings.
* **No `HITL` Breakpoints:** Because operations happen invisibly out-of-band during the MCP integration, pausing for Human-In-The-Loop review forces automatic polling to avoid system deadlocks.

## License
This project is licensed under the Apache 2 License - see the `license.md` file for details.
