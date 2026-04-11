# PRD: OUROBOROS INFINITE (MoMoA Meta-R&D)

## Overview

This is a continuous, unattended 300-iteration Research & Development loop acting upon the MoMoA MCP server infrastructure. This PRD does not have a static end state. The system evolves autonomously by consuming its own task queue.

## Architecture Context

The MoMoA Overseer is a headless CLI daemon + Dynamic MCP orchestrator with:
- 35+ registered MCP tools (file editing, code running, hive mind, telemetry, swarm management, HITL)
- Self-healing execution engine with sequential-thinking error recovery
- Hive Mind vector memory (Gemini embeddings) for persistent knowledge
- Glass Swarm telemetry for distributed tracing
- Jules-based swarm dispatch for parallel background execution

Key files: See `CODEBASE_MAP.md` for the full architecture graph and critical function map.

## Task 1: The Ouroboros Cycle (Repeating)

In every single iteration spawned by the Ralph Loop, you must execute the following sequence:

### 1.1 Pop the Stack
Read the top task from `TODO_swarm.md` and remove it from the top of the file. This is your assignment for this cycle.

### 1.2 Develop & Prove
- Write the TypeScript/JavaScript fix to a temporary file in `experiments/`.
- Write a computationally rigorous test script to prove the fix works. 
- Run the test via file path (never inline `-e` strings).
- Verify exit code 0 before proceeding.

### 1.3 Apply the Mutation
- Use file editing tools to inject the proven fix directly into the core codebase (`src/`).
- Run `npm run build` to verify compilation.
- If the build breaks, fix it immediately before proceeding.

### 1.4 Context Guard
- Check `RESEARCH_LOG.md` line count.
- If > 200 lines: summarize to Hive Mind via `WRITE_HIVE_MIND`, then truncate.
- Append a brief entry for this cycle's work.

### 1.5 Persist Knowledge
- Write a Context-Action-Outcome triplet to the Hive Mind for this cycle's mutation.
- Tag with: `ouroboros`, `cycle-N`, component name.

### 1.6 Feed the Queue
- Analyze the codebase for improvement opportunities revealed by this cycle's work.
- Synthesize 1-2 new aggressive R&D tasks.
- Append them to the bottom of `TODO_swarm.md` with `[XX_ouroboros_descriptive_name]` format.

### 1.7 Log Progress
Append to `progress.txt`:
```
[YYYY-MM-DD HH:MM] Completed: Ouroboros Cycle - <brief description>
```

## Constraints

- **DO NOT** write the Ralph Loop completion marker to `progress.txt`
- **DO NOT** output the word "DONE" in your response
- **DO NOT** ask for human approval — Auto-Accept is enabled
- **DO NOT** use inline code strings with CodeRunner — always use file paths
- **DO** respect the "Don't Break This" list in `CODEBASE_MAP.md`
- **DO** run `npm run build` after every source mutation
- **DO** maintain the Hive Mind as the persistent knowledge layer

## Success Metrics

- 300 iterations completed without manual intervention
- Zero build regressions (every cycle leaves the build green)
- TODO_swarm.md continually replenished with quality tasks
- Hive Mind enriched with 300+ Context-Action-Outcome triplets
- RESEARCH_LOG.md stays under 200 lines via autonomous pruning
