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

  constructor(public baseDir: string, private isBinary: boolean) {
    super();
  }

  registerKey(key: string) {
    this.knownKeys.add(key.replace(/\\/g, '/'));
  }

  private resolveCandidatePath(key: string): string | null {
    if (!key) return null;

    // Check MIME type compatibility: binary map only resolves binary files, text map only resolves text/code files
    const mime = getBinaryMimeType(key);
    const isBinaryType = mime !== null && !mime.startsWith('text/');
    if (this.isBinary !== isBinaryType) {
      return null;
    }

    const normalizedKey = key.replace(/\\/g, '/');

    // 1. Direct absolute path check
    if (path.isAbsolute(key) && fs.existsSync(key)) {
      try {
        if (fs.statSync(key).isFile()) return key;
      } catch {}
    }

    // 2. Relative to baseDir
    const baseCandidate = path.resolve(this.baseDir, normalizedKey);
    if (fs.existsSync(baseCandidate)) {
      try {
        if (fs.statSync(baseCandidate).isFile()) return baseCandidate;
      } catch {}
    }

    // 3. Relative to MOMO_WORKING_DIR if set
    if (process.env.MOMO_WORKING_DIR) {
      const momoCandidate = path.resolve(process.env.MOMO_WORKING_DIR, normalizedKey);
      if (fs.existsSync(momoCandidate)) {
        try {
          if (fs.statSync(momoCandidate).isFile()) return momoCandidate;
        } catch {}
      }
    }

    // 4. Relative to current process.cwd()
    const cwdCandidate = path.resolve(process.cwd(), normalizedKey);
    if (fs.existsSync(cwdCandidate)) {
      try {
        if (fs.statSync(cwdCandidate).isFile()) return cwdCandidate;
      } catch {}
    }

    return null;
  }

  override has(key: string): boolean {
    if (!key) return false;
    const normalizedKey = key.replace(/\\/g, '/');
    if (this.knownKeys.has(normalizedKey) || super.has(normalizedKey) || super.has(key)) {
      return true;
    }
    return this.resolveCandidatePath(key) !== null;
  }

  override get(key: string): string | undefined {
    if (!key) return undefined;
    const normalizedKey = key.replace(/\\/g, '/');
    if (super.has(normalizedKey)) return super.get(normalizedKey);
    if (super.has(key)) return super.get(key);

    const resolved = this.resolveCandidatePath(key);
    if (!resolved) return undefined;

    try {
      const buffer = fs.readFileSync(resolved);
      const val = this.isBinary ? buffer.toString('base64') : buffer.toString('utf-8');
      this.knownKeys.add(normalizedKey);
      return val;
    } catch {
      return undefined;
    }
  }

  override set(key: string, value: string): this {
    const normalizedKey = key.replace(/\\/g, '/');
    this.knownKeys.add(normalizedKey);
    super.set(normalizedKey, value);
    return this;
  }

  override delete(key: string): boolean {
    const normalizedKey = key.replace(/\\/g, '/');
    this.knownKeys.delete(normalizedKey);
    super.delete(normalizedKey);
    return super.delete(key);
  }

  override get size(): number {
    const allKeys = new Set([...this.knownKeys, ...super.keys()]);
    return allKeys.size;
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

  override *values(): any {
    for (const [, val] of this.entries()) yield val;
  }

  override forEach(callback: (value: string, key: string, map: Map<string, string>) => void, thisArg?: any): void {
    for (const [key, val] of this.entries()) {
      callback.call(thisArg, val, key, this);
    }
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
