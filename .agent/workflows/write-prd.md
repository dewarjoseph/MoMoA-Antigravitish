---
description: AutoAntigravity Ralph Loop PRD Generation for Riemann Swarm Mapping
---

# Ralph Loop PRD Workflow

This workflow guides the AI agent to write the PRD (Task List) and apply it immediately to the AutoAntigravity Ralph Loop for autonomous background processing.

## Prerequisites

- The AutoAntigravity plugin must be installed.
- To auto-start, the configuration `autoAntigravity.ralphLoop.autoStart` must be `true`. (Note: Iteration delay and max iteration bounds are managed manually by the user).

## PRD Writing Rules

1. **File Path**: The `PRD.md` should be saved in the workspace root. (Configurable via `autoAntigravity.ralphLoop.taskFile`).
2. **Checkbox Format Mandatory**: The `TaskFileManager` for the Ralph Loop only recognizes the `- [ ]` / `- [x]` patterns. The entire file should just be a flat list of checkboxes without headers or steps.
3. **Verification**: Include a verification or telemetry check checkbox at the end of the list.
4. **Dynamic Updates**: Modification of the PRD is allowed via the GUI on the user's end. Always append the following to the very end of the document step section:

   ```
   ## You may add to or modify the PRD contents during each step if dynamic updates are required.
   ```

## Parallel Execution (`#parallel` tag)

Attach the `#parallel` tag to tasks that can execute independently. The Ralph Loop reads this and executes them concurrently in isolated blocks.

### Syntax

```markdown
- [ ] #parallel Description of the independent task
```

### AI Tagging Rules

1. Continuous `#parallel` lines form a single parallel group.
2. If non-parallel tasks separate them, they form separate distinct groups.
3. **Use strictly for modifying disparate files or separate network actions**. Concurrently editing the same files will cause collisions.

## PRD Template: QIS Riemann Project

```markdown
- [ ] Execute continuous `FACTFINDER` tools to acquire GUE and SYK topological wormhole constraints without repeating previous queries.
- [ ] Save insights securely into the central memory backbone using `WRITE_HIVE_MIND`.
- [ ] Confirm Gold Standards are correctly assimilated.
- [ ] #parallel Sweep `W_DISORDER` upwards from 35.
- [ ] #parallel Sweep `PINK_NOISE_SCALE` using `QIS_TUNE_PHYSICS` to definitively shatter reciprocity. 
- [ ] #parallel Continuously poll `QIS_GET_GRAMMAR` until the Ergodic phase collapses into the stable Non-Ergodic Extended (NEE) phase.
- [ ] Ensure Time-Reversal Symmetry remains physically broken in QIS.
- [ ] Update `task.md` and `research_plan.md` artifacts.
- [ ] Extract topological telemetry.

## You may add to or modify the PRD contents during each step if dynamic updates are required.
```

## Execution Steps

// turbo-all

1. Analyze and format the user's Riemann swarm requirements into the above template.
2. Save this directly into the workspace root as `PRD.md`.

## Warnings

begin

- **Do not** manually mark items as `- [x]` completed — The Ralph Loop agent does this natively.
- **Do not** modify `progress.txt` manually.
- Use the `#parallel` tag explicitly and exclusively for fully disjoint architectural routines.
