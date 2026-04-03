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

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawn } from 'child_process';
import { MultiAgentTool } from '../multiAgentTool.js';
import { MultiAgentToolResult, MultiAgentToolContext, ToolParsingResult } from '../../momoa_core/types.js';
import { addDynamicallyRelevantFile, updateFileEntry } from '../../utils/fileAnalysis.js';
import { logFilename, MAX_MEM_PERCENTAGE, MAX_SCRIPT_EXECUTION_TIMEOUT } from '../../config/config.js';

const LARGE_FILE_LIMIT_KB = 100;
const MAX_CONTEXT_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const PYTHON_REQUIRED_DEPS: string[] = [];//["numpy"]; 
const INSTALL_TIMEOUT_MS = 300000; // 5 minutes for installation
const EXECUTION_TIMEOUT_MS = MAX_SCRIPT_EXECUTION_TIMEOUT; // 10 minutes for script execution
const DEPS_DIR_NAME = '_momoa_deps'; // Directory to isolate dependencies

// Helper: Run script using spawn to avoid maxBuffer issues
const runScript = (
    cmd: string, 
    args: string[], 
    cwd: string, 
    env: NodeJS.ProcessEnv, 
    timeoutMs: number
) => {
    return new Promise<{stdout: string, stderr: string, timedOut: boolean, exitCode: number | null}>((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, env, shell: true });
        
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        
        // Cap collection to ~50MB to prevent memory exhaustion
        const MAX_LOG_SIZE = LARGE_FILE_LIMIT_KB * 2 * 1024; 

        const appendLog = (currentLog: string, newData: string) => {
            const combined = currentLog + newData;
            if (combined.length > MAX_LOG_SIZE) {
                return `[---Output Truncated Due to Length---]\n${combined.slice(-MAX_LOG_SIZE)}`;
            }
            return combined;
        };

        child.stdout.on('data', (data) => {
            stdout = appendLog(stdout, data.toString());
        });

        child.stderr.on('data', (data) => {
            stderr = appendLog(stderr, data.toString());
        });

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM'); // Polite request
            
            // If the script is stubborn and hasn't closed after 2 seconds, drop the hammer.
            setTimeout(() => {
                if (!child.killed) {
                    try { child.kill('SIGKILL'); } catch (e) {}
                }
            }, 2000);
        }, timeoutMs);

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, timedOut, exitCode: code });
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
};

export const CodeRunnerTool: MultiAgentTool = {
  displayName: "Code Runner",
  name: 'RUN{',
  endToken: '}',

  /**
   * Stages files and executes them. Supports Python (.py) and Rust (.rs).
   */
  async execute(params: Record<string, unknown>, context: MultiAgentToolContext): Promise<MultiAgentToolResult> {
    const updateProgress = (message: string) => {
        context.sendMessage(JSON.stringify({
        status: 'PROGRESS_UPDATES',
        completed_status_message: message,
        }));
    };

    const files = params['files'] as string[];

    // 1. Validation
    const explicitCommand = params['command'] as string | undefined;

    if (!explicitCommand && (!files || files.length === 0)) {
      updateProgress("Error: No files or 'command' provided to execute.");
      return { result: "Error: No files or 'command' provided to execute." };
    }

    if (!explicitCommand && files.length > 0) {
        const mainScript = files[0];
        const ext = path.extname(mainScript).toLowerCase();
        const isRust = ext === '.rs';
        const isPython = ext === '.py';

        if (!isRust && !isPython) {
            updateProgress(`Error: Unsupported auto-execution file type '${ext}'. Please provide a specific 'command' for this file type.`);
            return { result: `Error: Unsupported file type '${ext}'. Please provide a specific 'command' (e.g. 'gcc ${mainScript}') or use .py/.rs files.` };
        }
    }

    // 2. Prepare Temp Directory
    let tempDir = '';
    try {
        const projectRoot = process.env.MOMO_WORKING_DIR || process.cwd();
        let executionEnv = { ...process.env };
        let depsPath = '';

        if (files.length > 0) {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'momoa-run-'));
            depsPath = path.join(os.tmpdir(), DEPS_DIR_NAME);
            await fs.mkdir(depsPath, { recursive: true });

            const isPythonReq = files.some(f => f.endsWith('.py'));
            if (isPythonReq && PYTHON_REQUIRED_DEPS.length > 0) {
                try {
                    const pyPipCmd = os.platform() === 'win32' ? 'python' : 'python3';
                    await runScript(pyPipCmd, ['-m', 'pip', 'install', '--target', depsPath, ...PYTHON_REQUIRED_DEPS], tempDir, process.env, INSTALL_TIMEOUT_MS);
                } catch (e) {
                     updateProgress(`Dependency Installation Failed: ${e}`);
                     return { result: `Dependency Installation Failed: ${e}` };
                }
            }

            // 3. Stage Files
            const stageFile = async (fileName: string) => {
                 const content = context.fileMap.get(fileName);
                 const targetPath = path.join(tempDir, fileName);
                 const targetDir = path.dirname(targetPath);

                 await fs.mkdir(targetDir, { recursive: true });

                 if (content === undefined) {
                     if (context.binaryFileMap.has(fileName)) {
                         const buf = Buffer.from(context.binaryFileMap.get(fileName)!, 'base64');
                         await fs.writeFile(targetPath, buf);
                         return;
                     }
                     throw new Error(`File '${fileName}' not found in context.`);
                 }
                 await fs.writeFile(targetPath, content, 'utf8');
            };

            for (const file of files) {
                await stageFile(file);
            }
        } // <--- Added missing bracket closure!

        // 4. Execution Logic
        let cmd = '';
        let args: string[] = [];
        let compileOutput = '';

        const freeMemKB = Math.floor(os.freemem() / 1024);
        const memLimitKB = Math.floor(freeMemKB * MAX_MEM_PERCENTAGE);
        const memLimitMB = Math.floor(memLimitKB / 1024);

        const isWin = os.platform() === 'win32';
        const prefix = isWin ? '' : `ulimit -v ${memLimitKB} && `;

        if (explicitCommand) {
             updateProgress(`Executing custom shell command...`);
             cmd = isWin ? explicitCommand : 'sh';
             args = isWin ? [] : ['-c', explicitCommand];
        } else if (files.some(f => f.endsWith('.py'))) {
            const mainScript = files[0];
            updateProgress(`Executing Python script \`${mainScript}\` (Capped at ${memLimitMB}MB due to underlying hardware constraints)`);
            
            const pyCmd = isWin ? 'python' : 'python3';
            cmd = isWin ? pyCmd : 'sh';
            args = isWin ? [mainScript] : ['-c', `${prefix}${pyCmd} ${mainScript}`];
            
            executionEnv = {
                ...executionEnv,
                PYTHONPATH: tempDir + path.delimiter + depsPath + path.delimiter + (process.env.PYTHONPATH || ''),
                PYTHONUNBUFFERED: '1'
            };
        }
        else if (files.some(f => f.endsWith('.rs'))) {
            const mainScript = files[0];
            const hasCargo = files.some(f => f.endsWith('Cargo.toml'));

            if (hasCargo) {
                updateProgress(`Executing Rust Project (Cargo) (Capped at ${memLimitMB}MB)`);
                cmd = isWin ? 'cargo' : 'sh';
                args = isWin ? ['run', '--release', '--quiet'] : ['-c', `${prefix}cargo run --release --quiet`];
            } else {
                updateProgress(`Compiling and Executing Rust script \`${mainScript}\` (Execution capped at ${memLimitMB}MB due to underlying hardware constraints)`);
                
                const binaryName = 'main_bin';                
                const compileRes = await runScript(
                    isWin ? 'rustc' : 'sh', 
                    isWin ? [mainScript, '-o', binaryName] : ['-c', `${prefix}rustc ${mainScript} -o ${binaryName}`], 
                    tempDir, 
                    process.env, 
                    INSTALL_TIMEOUT_MS
                );

                if (compileRes.exitCode !== 0) {
                    return { result: `Rust Compilation Failed (or ran out of memory):\n${compileRes.stderr}\n${compileRes.stdout}` };
                }
                
                if (compileRes.stderr) compileOutput += `[Compilation Warning]: ${compileRes.stderr}\n`;

                const binaryPath = path.join(tempDir, binaryName);
                const safeBinPath = isWin ? binaryPath : `./${path.basename(binaryPath)}`;
                cmd = isWin ? safeBinPath : 'sh';
                args = isWin ? [] : ['-c', `${prefix}${safeBinPath}`];
            }
        }

        // Run the command
        const execCwd = files.length > 0 ? tempDir : projectRoot;
        const { stdout, stderr, timedOut, exitCode } = await runScript(
            cmd, 
            args, 
            execCwd, 
            executionEnv, 
            EXECUTION_TIMEOUT_MS
        );

        let result = compileOutput;

        if (timedOut) {
            result += `Error: Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds.\n`;
        } else if (exitCode !== 0) {
            result += `Error: Process exited with code ${exitCode}.\n`;
        } else {
            result += `Execution successful.\n`;
        }

        updateProgress(result);

        // 5. Post-Execution: Scan for Output Files
        const normalizedInputFiles = new Set(files.map(f => path.normalize(f)));
        normalizedInputFiles.add('main_bin'); // Exclude the compiled binary we created (if any)

        const getFilesRecursively = async (dir: string): Promise<string[]> => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const files = await Promise.all(entries.map(async (entry) => {
                const res = path.join(dir, entry.name);
                return entry.isDirectory() ? getFilesRecursively(res) : res;
            }));
            return Array.prototype.concat(...files);
        };

        const allFilesInTemp = await getFilesRecursively(tempDir);
        const generatedFiles: string[] = [];

        for (const fullPath of allFilesInTemp) {
            let relativePath = path.relative(tempDir, fullPath);

            if (normalizedInputFiles.has(relativePath)) continue;
            
            let baseName = path.basename(relativePath);

            // Intercept and rename RESEARCH_LOG.MD to CODE_RUNNER_LOG.md
            if (baseName.toUpperCase() === logFilename.toUpperCase()) {
                const dirName = path.dirname(relativePath);
                const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
                baseName = `CODE_RUNNER_RESEARCH_LOG_${timestamp}.md`;
                relativePath = dirName === '.' ? baseName : path.join(dirName, baseName);
            }

            // Skip common build artifacts
            if (baseName.startsWith('.') || relativePath.includes('__pycache__') || baseName.endsWith('.pyc')) continue;
            if (baseName === 'target' || relativePath.startsWith('target/')) continue; // Skip Cargo target dir

            const stats = await fs.stat(fullPath);

            if (stats.isFile()) {
                if (stats.size > MAX_CONTEXT_FILE_SIZE_BYTES) {
                     result += `\n[Warning] File '${relativePath}' generated but exceeds size limit.\n`;
                }

                const contentBuffer = await fs.readFile(fullPath);
                const isBinary = contentBuffer.subarray(0, 1024).includes(0);
                const isTooLarge = contentBuffer.length > (LARGE_FILE_LIMIT_KB * 1024);
                
                if (isBinary || isTooLarge) {
                     context.binaryFileMap.set(relativePath, contentBuffer.toString('base64'));
                } else {
                  context.fileMap.set(relativePath, contentBuffer.toString('utf8'));
                  await updateFileEntry(relativePath, context.fileMap, context.multiAgentGeminiClient);
                }
                
                context.editedFilesSet.add(relativePath);
                addDynamicallyRelevantFile(relativePath);
                generatedFiles.push(relativePath);
            }
        }

        if (generatedFiles.length > 0) {
            updateProgress(`The following files were generated: ${generatedFiles.join(', ')}`);
            result += `\nGenerated Files: ${generatedFiles.join(', ')}\n`;
        }

        if (stdout && stdout.trim()) result += `\n--- STDOUT ---\n${stdout.trim()}\n`;
        if (stderr && stderr.trim()) result += `\n--- STDERR ---\n${stderr.trim()}\n`;

        return { result: result };
    } catch (e: any) {
        updateProgress(`System Error: ${e.message}`);
        return { result: `System Error: ${e.message}` };
    } finally {
        // Cleanup temp directory
        if (tempDir) {
            try { await fs.rm(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
    }
  },

  /**
   * Parses the syntax: RUN{file1.py, file2.py, ...}
   * Expects a comma-separated list of filenames.
   */
  async extractParameters(invocation: string, _context: MultiAgentToolContext): Promise<ToolParsingResult> {
    const trimmed = invocation.trim();
    
    // Remove the footer
    const endToken = this.endToken ?? '}';
    if (!trimmed.endsWith(endToken)) {
      return { success: false, error: `Invalid syntax: Must end with '${endToken}'` };
    }
    
    // Content is everything before the footer
    const content = trimmed.substring(0, trimmed.lastIndexOf(endToken));
    
    // Split by comma or pipe, trim whitespace, and remove empty entries
    const files = content
        .split(/[,|]/)
        .map(f => f.trim())
        .filter(f => f.length > 0);

    if (files.length === 0) {
        return { success: false, error: "No files specified." };
    }

    return {
        success: true,
        params: {
            files: files
        }
    };
  }
};