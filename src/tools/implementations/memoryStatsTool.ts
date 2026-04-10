/**
 * Copyright 2026 Reto Meier / Joe Dewar
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { MultiAgentToolContext, MultiAgentToolResult, ToolParsingResult } from "../../momoa_core/types.js";
import { MultiAgentTool } from "../multiAgentTool.js";
import { checkContainerMemory } from "../../utils/memoryChecker.js";

/**
 * Tool to retrieve the current memory statistics and boundaries of the local execution container.
 * Crucial for avoiding OOM (Out-Of-Memory) limits during deep mega-context execution.
 */
export const memoryStatsTool: MultiAgentTool = {
  displayName: "Memory Stats Viewer",
  name: 'GET_MEMORY_STATS',

  async execute(_params: Record<string, string>, _context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const memData = checkContainerMemory();
    
    return { 
      result: `[System Memory Stats]\n${memData}` 
    };
  },

  async extractParameters(_invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    return { success: true, params: {} };
  }
};
