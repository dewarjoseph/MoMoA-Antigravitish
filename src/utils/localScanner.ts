import * as fs from 'node:fs';
import * as path from 'node:path';
import { getBinaryMimeType } from '../tools/implementations/fileReaderTool.js';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.swarm',
  '.DS_Store',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit per file

export class LazyMap extends Map<string, string> {
  private knownKeys = new Set<string>();

  constructor(private baseDir: string, private isBinary: boolean) {
    super();
  }

  registerKey(key: string) {
    this.knownKeys.add(key);
  }

  override has(key: string): boolean {
    return this.knownKeys.has(key) || super.has(key);
  }

  override get(key: string): string | undefined {
    if (super.has(key)) return super.get(key);
    
    if (!this.knownKeys.has(key)) return undefined;

    try {
      const fullPath = path.join(this.baseDir, key);
      const buffer = fs.readFileSync(fullPath);
      const val = this.isBinary ? buffer.toString('base64') : buffer.toString('utf-8');
      return val;
    } catch (e) {
      return undefined;
    }
  }

  override set(key: string, value: string): this {
    this.knownKeys.add(key);
    super.set(key, value);
    return this;
  }

  override delete(key: string): boolean {
    this.knownKeys.delete(key);
    return super.delete(key);
  }

  override *entries(): any {
    for (const key of this.knownKeys) {
      const val = this.get(key);
      if (val !== undefined) yield [key, val];
    }
    for (const [key, val] of super.entries()) {
      if (!this.knownKeys.has(key)) yield [key, val];
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  override *keys(): any {
    for (const key of this.knownKeys) yield key;
    for (const key of super.keys()) if (!this.knownKeys.has(key)) yield key;
  }
}

export interface ScanResult {
  fileMap: Map<string, string>;
  binaryFileMap: Map<string, string>;
}

export async function scanLocalDirectory(rootDir: string): Promise<ScanResult> {
  const fileMap = new LazyMap(rootDir, false);
  const binaryFileMap = new LazyMap(rootDir, true);

  async function walk(dir: string) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          if (entry.name !== '.gitignore' && entry.isDirectory()) continue; 
        }

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const stats = await fs.promises.stat(fullPath);
          if (stats.size > MAX_FILE_SIZE) continue;
          
          // Basic heuristic for binary files
          const mime = getBinaryMimeType(entry.name);
          if (mime && !mime.startsWith('text/')) {
            binaryFileMap.registerKey(relativePath);
          } else {
            // Further optimization: we assume source files are text without buffer loading
            fileMap.registerKey(relativePath);
          }
        }
      }
    } catch (err) {
      console.error(`[Scanner] Failed to read directory ${dir}:`, err);
    }
  }

  await walk(rootDir);
  return { 
    fileMap: fileMap as unknown as Map<string, string>, 
    binaryFileMap: binaryFileMap as unknown as Map<string, string> 
  };
}
