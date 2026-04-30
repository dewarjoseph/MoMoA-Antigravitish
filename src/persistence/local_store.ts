/**
 * Local filesystem persistence layer replacing Firebase RTDB.
 * All data is stored as JSON files under the configured base directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SessionState {
  id: string;
  state: string;
  strategy: string;
  agentNumber: number;
  title?: string;
  pulled: boolean;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export class LocalStore {
  private readonly baseDir: string;
  private readonly sessionsDir: string;
  private readonly logsDir: string;

  constructor(baseDir: string = '.swarm') {
    this.baseDir = path.resolve(baseDir);
    this.sessionsDir = path.join(this.baseDir, 'sessions');
    this.logsDir = path.join(this.baseDir, 'logs');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  // --- Session tracking ---

  saveSession(id: string, data: SessionState): void {
    const filePath = path.join(this.sessionsDir, `${id}.json`);
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  getSession(id: string): SessionState | null {
    const filePath = path.join(this.sessionsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  listSessions(): SessionState[] {
    if (!fs.existsSync(this.sessionsDir)) return [];
    return fs.readdirSync(this.sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter((s): s is SessionState => s !== null);
  }

  // --- Logging ---

  appendLog(filename: string, message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    const filePath = path.join(this.logsDir, filename);

    const MAX_MB = 10;
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_MB * 1024 * 1024) {
          const oldPath = filePath + '.old';
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          fs.renameSync(filePath, oldPath);
        }
      }
    } catch (e) { /* ignore rotation errors */ }

    fs.appendFileSync(filePath, line, 'utf-8');
  }

  getLogPath(filename: string): string {
    return path.join(this.logsDir, filename);
  }

  // --- Status reports ---

  writeStatusReport(report: string, filename: string = 'swarm_status.md'): void {
    const filePath = path.join(this.baseDir, filename);
    fs.writeFileSync(filePath, report, 'utf-8');
  }

    getStatusReportPath(filename: string = 'swarm_status.md'): string {
    return path.join(this.baseDir, filename);
  }

  // --- Generic State Management ---

  /**
   * Writes data to a specified file in the base directory, handling JSON or plain text.
   * @param filename The name of the file, potentially including a relative path within the base directory.
   * @param data The data to write. Can be any type for JSON, or a string for text.
   * @param type The type of file ('json' or 'text').
   */
  writeStateFile(filename: string, data: any | string, type: 'json' | 'text'): void {
    const filePath = path.join(this.baseDir, filename);
    const dirPath = path.dirname(filePath);
    fs.mkdirSync(dirPath, { recursive: true }); // Ensure parent directory exists

    let content: string;
    if (type === 'json') {
      content = JSON.stringify(data, null, 2);
    } else if (type === 'text') {
      content = String(data);
    } else {
      throw new Error(`Unsupported file type: ${type}`);
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Reads data from a specified file in the base directory, parsing as JSON or returning as plain text.
   * @param filename The name of the file, potentially including a relative path within the base directory.
   * @param type The type of file ('json' or 'text').
   * @returns The parsed data (for JSON), the file content (for text), or null if the file does not exist or parsing fails.
   */
  readStateFile(filename: string, type: 'json' | 'text'): any | string | null {
    const filePath = path.join(this.baseDir, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (type === 'json') {
        return JSON.parse(content);
      } else if (type === 'text') {
        return content;
      } else {
        throw new Error(`Unsupported file type: ${type}`);
      }
    } catch (e) {
      this.logError(`Failed to read or parse state file ${filename}: ${e}`);
      return null;
    }
  }

  // --- Error logging ---

  logError(error: unknown): void {
    const msg = error instanceof Error
      ? `${error.message}\n${error.stack}`
      : String(error);
    this.appendLog('error.log', msg);
  }

  // --- Paths ---

  getBaseDir(): string {
    return this.baseDir;
  }

  getLogsDir(): string {
    return this.logsDir;
  }
}
