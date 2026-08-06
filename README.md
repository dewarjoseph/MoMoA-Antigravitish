# MoMo Overseer (Antigravity Edition) & Offline IDE Preview

**MoMo Overseer** is an autonomous, headless CLI daemon and [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server built to iteratively orchestrate developer workloads using Google's generative models.

This repository features the **Antigravity Edition** daemon paired with a natively packaged **VSCode Offline Webview UI**. It provides a fully isolated, zero-footprint developer orchestration platform running locally on your machine.

---

## 🏗️ System Architecture

1. **The Daemon (`momo-overseer`)**
   - **Headless Mode:** The system executes AI work phases unattended, using a `.swarm/` local disk manifest.
   - **Zero RAM Footprint:** A `LazyMap` filesystem crawler discovers huge monolithic codebases dynamically without memory leaks.
   - **MCP Bridge:** Exposes 15+ native agentic internal tools dynamically into an MCP-compatible host client (like VSCode or Cursor), running file mutations natively on your hard drive.

2. **The Visual Plane (VSCode Extension)**
   - **MoMoA Researcher Webview:** A compiled React frontend embedded inside a `.vsix` extension. It natively connects to the MCP environment to provide a visual interface for managing AI sessions, research tasks, and progress updates without requiring external web servers or Firebase.

---

## 🚀 Easy Installation & Getting Started

### Prerequisites
- NodeJS (v18+)
- npm
- Git

### Step 1: Configure Environment Variables
You must provide your runtime credentials via a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_gemini_api_key
JULES_API_KEY=your_jules_api_key
GITHUB_TOKEN=your_github_token
```

### Step 2: Build the Daemon & Extension
Run the following commands to install dependencies, compile the MCP daemon, and package the offline VSCode Extension UI:

```bash
# 1. Install root daemon dependencies and build the MCP backend
npm install
npm run build

# 2. Build the React frontend
cd web
npm install
npm run build

# 3. Package the VSCode Extension (.vsix)
cd ../vscode-extension
npm install
npm run vscode:prepublish
npx vsce package
```

### Step 3: Install the VSCode Extension
1. Open VSCode.
2. Go to the Extensions panel (Ctrl+Shift+X or Cmd+Shift+X).
3. Click the `...` menu in the top right and select **Install from VSIX...**.
4. Select the `momo-overseer-extension-1.0.0.vsix` file generated in the `vscode-extension` folder.

---

## 💻 Usage

### 1. Launching the Visual Plane
With the extension installed, open the VSCode Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type:
**`Open MoMo UI`**

This will spawn the embedded React frontend as a Webview panel inside your IDE, allowing you to monitor and orchestrate research tasks visually.

### 2. Operating the Headless CLI Daemon
You can also invoke the pipeline natively from any terminal in your environment without the UI:

```bash
# Begin tracking swarm deployment tasks
node dist/cli.js swarm monitor

# Evaluate and self-review pending AI tickets
node dist/cli.js swarm triage
```

### 3. Integrating with Other MCP Clients
To connect MoMo Overseer directly to generic MCP clients (like Claude or Cursor), configure the server block as follows:

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

---

## 🔒 Safety & System Hooks
* **Logging Interception:** The script patches native Node `console.log` inside the execution layers to strictly `console.error` to secure the MCP JSON connection from uncontrolled strings.
* **Autonomous Recovery:** A native `SelfHealingRunner` automatically captures syntax errors and attempts logic repair using heuristic-based file editing, bypassing human-in-the-loop dependencies.

## License
This project is licensed under the Apache 2 License - see the `license.md` file for details.