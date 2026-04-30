import { spawn, ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill'; // Will need to install this package

/**
 * Manages a registry of spawned child processes, ensuring they are properly
 * terminated upon application shutdown to prevent orphaned processes.
 * It also handles redirection of child process stdout to stderr to avoid
 * corrupting the main MCP stdio stream.
 */
export class ProcessRegistry {
  private static instance: ProcessRegistry | null = null;
  private children: Map<number, ChildProcess> = new Map();
  private shutdownInProgress = false;

  private constructor() {
    this.setupExitHandlers();
  }

  /** Get or create singleton */
  public static getInstance(): ProcessRegistry {
    if (!ProcessRegistry.instance) {
      ProcessRegistry.instance = new ProcessRegistry();
    }
    return ProcessRegistry.instance;
  }

  /**
   * Registers a child process with the registry.
   * @param child The child process to register.
   */
  public register(child: ChildProcess): void {
    if (child.pid) {
      this.children.set(child.pid, child);
      child.on('exit', (code, signal) => {
        this.children.delete(child.pid!);
        console.error(`[ProcessRegistry] Child process ${child.pid} exited with code ${code} signal ${signal}`);
      });
      child.on('error', (err) => {
        console.error(`[ProcessRegistry] Child process ${child.pid} error: ${err.message}`);
      });
      console.error(`[ProcessRegistry] Registered child process: ${child.pid}`);
    }
  }

  /**
   * Spawns a child process and registers it.
   * Its stdout is redirected to stderr to prevent stdio stream corruption.
   * @param command The command to execute.
   * @param args Arguments for the command.
   * @param options Spawn options.
   * @returns The spawned child process.
   */
  public spawn(
    command: string,
    args: string[] = [],
    options?: Parameters<typeof spawn>[2]
  ): ChildProcess {
    const child = spawn(command, args, {
      ...options,
      stdio: ['inherit', 'pipe', 'inherit'], // Inherit stdin, pipe stdout, inherit stderr
    });

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        process.stderr.write(`[Child ${child.pid} STDOUT]: ${data.toString()}`);
      });
    }

    this.register(child);
    return child;
  }

  /**
   * Terminates all registered child processes.
   * Uses tree-kill to ensure entire process trees are terminated.
   */
  public async shutdown(): Promise<void> {
    if (this.shutdownInProgress) {
      console.error('[ProcessRegistry] Shutdown already in progress. Skipping.');
      return;
    }
    this.shutdownInProgress = true;
    console.error('[ProcessRegistry] Initiating shutdown of all child processes...');

    const killPromises: Promise<void>[] = [];
    for (const [pid, child] of this.children.entries()) {
      console.error(`[ProcessRegistry] Terminating child process tree: ${pid}`);
      killPromises.push(
        new Promise((resolve) => {
          // treeKill sends SIGTERM by default, then SIGKILL after a timeout
          treeKill(pid, 'SIGTERM', (err: Error | undefined) => {
            if (err) {
              console.error(`[ProcessRegistry] Error killing process ${pid}: ${err.message}`);
            } else {
              console.error(`[ProcessRegistry] Process ${pid} terminated.`);
            }
            this.children.delete(pid);
            resolve();
          });
        })
      );
    }
    await Promise.all(killPromises);
    console.error('[ProcessRegistry] All child processes terminated.');
    this.shutdownInProgress = false;
  }

  /**
   * Sets up global exit handlers to ensure child processes are terminated
   * on various shutdown signals or events.
   */
  private setupExitHandlers(): void {
    const exitHandler = async (signal: string) => {
      console.error(`[ProcessRegistry] Received ${signal}. Triggering shutdown.`);
      await this.shutdown();
      // The MCP server's gracefulShutdown will handle the final process.exit.
      // This registry's role is solely to clean up child processes.
    };

    process.on('SIGINT', () => exitHandler('SIGINT'));
    process.on('SIGTERM', () => exitHandler('SIGTERM'));
    process.on('exit', (code) => {
      console.error(`[ProcessRegistry] Process exiting with code ${code}.`);
      // If shutdown hasn't been explicitly called, ensure it runs.
      // This handles cases like uncaught exceptions where 'exit' might be called directly.
      if (!this.shutdownInProgress && this.children.size > 0) {
        // Note: 'exit' handler is synchronous, cannot await.
        // Best effort to kill children, but may not complete.
        console.error('[ProcessRegistry] Attempting synchronous shutdown on exit.');
        for (const [pid] of this.children.entries()) {
          try {
            process.kill(pid, 'SIGKILL'); // Force kill
            console.error(`[ProcessRegistry] Force killed child ${pid} on exit.`);
          } catch (err: any) {
            console.error(`[ProcessRegistry] Error force killing child ${pid} on exit: ${err.message}`);
          }
        }
      }
    });
    process.on('uncaughtException', async (err) => {
      console.error(`[ProcessRegistry] Uncaught exception: ${err.message}\n${err.stack}`);
      await exitHandler('uncaughtException');
      // Allow process to crash after cleanup, or re-throw if desired
      process.exit(1);
    });
  }
}

// Export an instance for direct use
export const processRegistry = ProcessRegistry.getInstance();
