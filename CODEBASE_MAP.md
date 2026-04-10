# CODEBASE_MAP.md â€” MoMo Overseer

> **Last synced:** 2026-04-10T13:21:52Z (Auto-Updated via scan_architecture.ps1)
> **Architecture:** Headless CLI daemon + Dynamic MCP orchestrator + self-healing execution engine + swarm validation suite + persistent memory + telemetry + async HITL

## System Architecture

```mermaid
graph TB
    subgraph "CLI Entrypoint"
        CLI["src/cli.ts<br/>Commander CLI<br/>--mcp-config, --no-self-healing"]
    end

    subgraph "MCP Server (Bi-Directional)"
        MCP["src/mcp_server.ts<br/>stdio MCP Server v2.0<br/>Resources + Prompts + Phase 5 Tools"]
    end

    subgraph "Dynamic MCP Client"
        MCM["src/mcp/mcpClientManager.ts<br/>Connection Pool + Hot-Reload + Hot-Plug"]
        CFG["mcp_servers.json<br/>Claude Desktop schema"]
        REG["src/mcp/registryResolver.ts<br/>Smithery.ai + Local Cache"]
        CFG -->|fs.watch| MCM
        MCM -->|tools/list, tools/call| EXT1["External MCP Server 1"]
        MCM -->|resources/read| EXT2["External MCP Server N"]
        REG -->|hotPlugServer| MCM
    end

    subgraph "Self-Healing Engine"
        SHR["src/mcp/selfHealingRunner.ts<br/>Autonomous Fix-and-Retry<br/>+ Hive Mind + HITL Escalation"]
        SHR -->|sequential-thinking| MCM
        SHR -->|queryForErrorResolution| HM
        SHR -->|requestHuman| HITL
    end

    subgraph "Hive Mind (Phase 5)"
        HM["src/memory/hiveMind.ts<br/>Vector Memory (Gemini Embeddings)"]
        EMB["src/memory/embeddingClient.ts<br/>Gemini text-embedding-004"]
        HMT["src/memory/types.ts<br/>Triplet Types"]
        HM --> EMB
    end

    subgraph "Glass Swarm Telemetry (Phase 5)"
        TEL["src/telemetry/tracer.ts<br/>SwarmTracer Singleton"]
        TOK["src/telemetry/tokenAccounting.ts<br/>Token Estimation"]
        TELT["src/telemetry/types.ts<br/>Span/Trace Types"]
        TEL --> TOK
    end

    subgraph "HITL (Phase 5)"
        HITL["src/hitl/hitlManager.ts<br/>Async Promise Parking"]
        HITN["src/hitl/notifier.ts<br/>stderr + file + webhook"]
        HITT["src/hitl/types.ts<br/>Request/Response Types"]
        HITL --> HITN
    end

    subgraph "Core AI Engine"
        ORCH["src/momoa_core/orchestrator.ts<br/>Headless Orchestrator (~1190 LOC)<br/>+ Hive Mind + Telemetry + HITL"]
        OVER["src/momoa_core/overseer.ts<br/>Autonomous Overseer"]
        WP["src/momoa_core/workPhase.ts<br/>Work Phase Manager"]
        TYPES["src/momoa_core/types.ts<br/>Core Types + Phase 5 Refs"]
    end

    subgraph "Swarm Management"
        SM["src/swarm/swarm_manager.ts<br/>Jules Worker Dispatch"]
        SP["src/swarm/session_poller.ts<br/>Jules API Poller"]
        MS["src/swarm/merge_supervisor.ts<br/>AI Merge + Hive Mind Auto-Doc"]
        RW["src/swarm/report_writer.ts<br/>Status Report Generator"]
    end

    subgraph "Services"
        GC["src/services/geminiClient.ts<br/>Gemini API Client"]
        TM["src/services/transcriptManager.ts<br/>Conversation History"]
        PM["src/services/promptManager.ts<br/>Prompt/Asset Loader"]
    end

    subgraph "Tool Implementations"
        TR["src/tools/multiAgentToolRegistry.ts<br/>Dynamic Tool Registry + Phase 5 Tools"]
        direction LR
        T1["fileReaderTool"] --> TR
        T2["smartFileEditorTool"] --> TR
        T3["codeRunnerTool"] --> TR
        T4["dynamicMcpTool"] --> TR
        T5["hiveMindQueryTool"] --> TR
        T6["askHumanTool"] --> TR
        T7["searchRegistryTool"] --> TR
        T8["telemetryDashboardTool"] --> TR
        T9["autoToolGeneratorTool"] --> TR
    end

    subgraph "Persistence"
        LS["src/persistence/local_store.ts<br/>Local FS (.swarm/)"]
    end

    CLI --> MCP
    CLI --> SM
    MCP -->|initFromConfig| MCM
    MCP --> TR
    TR -->|registerDynamicMcpTools| MCM
    ORCH --> GC
    ORCH --> TM
    ORCH -->|executeWithHealing| SHR
    ORCH -->|pre-query| HM
    ORCH -->|startTrace| TEL
    ORCH -->|init| HITL
    SHR --> TR
    ORCH --> OVER
    SM --> SP
    SP --> MS
    MS -->|auto-doc| HM
    SP --> RW
    SP --> LS
    SM --> LS
    MCM -->|span injection| TEL
```

## Critical Function Map

| Component | Function/Class | File | Line (Approx) | Notes |
|---|---|---|---|---|
| **CLI** | \$funcLabel\ | \$fileStr\ | ~42 | Main entry, Commander-based |
| **CLI** | `--mcp-config` option | `src/cli.ts` | 51 | Path to mcp_servers.json |
| **MCP** | \$funcLabel\ | \$fileStr\ | ~125 | Registers tools + Phase 5 schemas |
| **MCP Client** | \$funcLabel\ | \$fileStr\ | ~59 | Connection pool + hot-plug |
| **MCP Client** | \$funcLabel\ | \$fileStr\ | ~283 | Proxy with telemetry spans |
| **MCP Client** | \$funcLabel\ | \$fileStr\ | ~599 | **Phase 5**: Mid-session server spawn |
| **MCP Client** | \$funcLabel\ | \$fileStr\ | ~630 | **Phase 5**: Graceful disconnect |
| **Registry** | \$funcLabel\ | \$fileStr\ | ~57 | **Phase 5**: Smithery.ai + local cache |
| **Registry** | \$funcLabel\ | \$fileStr\ | ~70 | Search for MCP servers by capability |
| **Self-Heal** | \$funcLabel\ | \$fileStr\ | ~61 | Error recovery + Hive Mind + HITL |
| **Self-Heal** | \$funcLabel\ | \$fileStr\ | ~96 | Hive Mind pre-query + HITL escalation |
| **Hive Mind** | \$funcLabel\ | \$fileStr\ | ~26 | **Phase 5**: Singleton vector memory |
| **Hive Mind** | \$funcLabel\ | \$fileStr\ | ~66 | Semantic search with embeddings |
| **Hive Mind** | \$funcLabel\ | \$fileStr\ | ~124 | Store Context-Action-Outcome triplet |
| **Hive Mind** | \$funcLabel\ | \$fileStr\ | ~111 | Error-specific semantic search |
| **Hive Mind** | \$funcLabel\ | \$fileStr\ | ~12 | Gemini text-embedding-004 wrapper |
| **Telemetry** | \$funcLabel\ | \$fileStr\ | ~24 | **Phase 5**: OTel-inspired tracing |
| **Telemetry** | \$funcLabel\ | \$fileStr\ | ~58 | Create root trace context |
| **Telemetry** | \$funcLabel\ | \$fileStr\ | ~192 | Token burn detection |
| **Telemetry** | \$funcLabel\ | \$fileStr\ | ~260 | Gantt-style trace visualization |
| **HITL** | \$funcLabel\ | \$fileStr\ | ~31 | **Phase 5**: Non-blocking Promise parking |
| **HITL** | \$funcLabel\ | \$fileStr\ | ~77 | Park agent, send notifications |
| **HITL** | \$funcLabel\ | \$fileStr\ | ~126 | Wake up parked agent |
| **HITL** | \$funcLabel\ | \$fileStr\ | ~17 | Formatted stderr alert |
| **Orchestrator** | \$funcLabel\ | \$fileStr\ | ~64 | Main loop + Phase 5 init |
| **Orchestrator** | \$funcLabel\ | \$fileStr\ | ~58 | **Set to `true`** â€” headless mode (ASK_HUMAN is async) |
| **Orchestrator** | Phase 5 init block | `src/momoa_core/orchestrator.ts` | ~443 | Telemetry + Hive Mind + HITL setup |
| **Swarm** | `MergeSupervisor` (`evaluateAndMerge`) | `src/swarm/merge_supervisor.ts` | 23 | AI merge + Hive Mind auto-doc |
| **Swarm** | `MergeSupervisor` (`competitivelyEvaluateAndMerge`)| `src/swarm/merge_supervisor.ts` | 134 | Competitive intelligence variant multi-diff grading |
| **Swarm** | `SwarmManager` (`runIntelligenceLoopExperiment`) | `src/swarm/swarm_manager.ts` | 211 | Test intelligence variants concurrently |
| **Swarm** | \$funcLabel\ | \$fileStr\ | ~17 | Autonomous gen-to-gen prompt mutation engine |
| **Persistence** | \$funcLabel\ | \$fileStr\ | ~21 | FS-based session/log storage |
| **Tools** | \$funcLabel\ | \$fileStr\ | ~120 | Tool dispatch |
| **Tools** | \$funcLabel\ | \$fileStr\ | ~63 | Tool registration |
| **Tools** | \$funcLabel\ | \$fileStr\ | ~75 | AST dynamic transpilation / Data URI Hot-Load |
| **Tools** | Phase 5 tools registered | `src/tools/multiAgentToolRegistry.ts` | ~153 | 6 new tools: QUERY_HIVE_MIND, WRITE_HIVE_MIND, ASK_HUMAN, HITL_STATUS, SEARCH_MCP_REGISTRY, TELEMETRY_DASHBOARD |

## Zombie Code List ðŸ§Ÿ

| File | Status | Notes |
|---|---|---|
| `web/` | **DELETED** | Entire React/Vite frontend removed |
| `src/firebase_server.ts` | **DELETED** | Firebase RTDB integration (887 LOC) |
| `src/websocket_server.ts` | **DELETED** | WebSocket server (412 LOC) |
| `src/index.ts` | **DELETED** | Old Express entrypoint |
| `src/tools/implementations/proxyMcpTool.ts` | **DELETED** | Replaced by `DynamicMcpTool` + `McpClientManager` |

## "Don't Break This" List ðŸ›‘

| Component | Constraint | Reason |
|---|---|---|
| `FORCE_NO_HITL = true` | Do NOT set to `false` | Headless mode; the new ASK_HUMAN tool is async/non-blocking |
| `orchestrator.ts` tool invocation loop | Preserve EXACTLY | Core AI loop; subtle ordering matters |
| `overseer.ts` _performReview | Keep Gemini JSON parse | AI review feedback pipeline |
| `emergencyShutdown()` | Must clean Jules branches | Prevents orphaned scratchpad branches |
| Tool registry module init | Registration order matters | Tools registered at module load |
| `sendMessage` in MCP context | Write to `stderr` only | `stdout` is reserved for MCP protocol |
| `codeRunnerTool.ts` internals | **DO NOT MODIFY** | Build around, not into â€” use SelfHealingRunner wrapper |
| `optimizerTool.ts` internals | **DO NOT MODIFY** | Build around, not into â€” use SelfHealingRunner wrapper |
| `McpClientManager.resolveCommand()` | Windows `.cmd` resolution | Critical for cross-platform operation |
| Phase 5 singletons | Always initialized via `getInstance()` | HiveMind, SwarmTracer, HitlManager are lazy singletons |
| Phase 5 subsystems | All non-critical, wrapped in try/catch | A telemetry/memory failure must NEVER crash the orchestrator |

## Maintenance Scripts ðŸ› ï¸

| Script | Purpose | Status |
|---|---|---|
| `swarm_overseer.ps1` | Legacy PowerShell swarm monitor | **SUPERSEDED** by `SessionPoller` |
| `dispatch_swarm.ps1` | Legacy PowerShell dispatch | **SUPERSEDED** by `SwarmManager` |
| `approve_stalled.ps1` | Legacy batch approval | **SUPERSEDED** by `approveWaiting()` |
