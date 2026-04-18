/**
 * Copyright 2026 Reto Meier
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import * as os from 'os';

const activeProcesses = new Set<ChildProcess>();

/**
 * Registers a child process to be tracked.
 * It will be automatically forcefully killed if the Node.js process exits.
 */
export function registerChildProcess(child: ChildProcess): void {
    activeProcesses.add(child);
    
    const removeFn = () => {
        activeProcesses.delete(child);
    };
    
    child.once('exit', removeFn);
    child.once('error', removeFn);
}

export function cleanupProcesses(): void {
    if (activeProcesses.size === 0) return;
    
    const isWin = os.platform() === 'win32';
    
    for (const child of activeProcesses) {
        if (!child.killed && child.pid) {
            try {
                if (isWin) {
                    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
                } else {
                    process.kill(-child.pid, 'SIGKILL');
                }
            } catch (e) {
                // Ignore errors
            }
        }
    }
    activeProcesses.clear();
}

// Bind cleanup to standard exit handlers
let cleanupRun = false;
const doCleanup = () => {
    if (cleanupRun) return;
    cleanupRun = true;
    cleanupProcesses();
};

process.on('exit', doCleanup);
process.on('SIGINT', () => { doCleanup(); process.exit(130); });
process.on('SIGTERM', () => { doCleanup(); process.exit(143); });
