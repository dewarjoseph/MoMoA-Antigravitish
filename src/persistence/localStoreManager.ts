
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMcpToolSchema } from '../mcp/toolSchemas.js'; // Assuming this path is correct

/**
 * Manages local persistence for operational state, including reading, writing,
 * and validating data using Zod schemas. It also incorporates mechanisms
 * to prevent runaway log growth.
 */
export class LocalStoreManager {
    private baseDir: string;
    private logFileMaxSize: number = 1024 * 1024; // 1MB default max size for log files
    private framesDir: string = '.swarm/frames';
    private manifestPath: string = path.join(this.framesDir, 'manifest.json');
    private currentFrameSequence: number = 0;
    private frameHistory: string[] = []; // Stores relative paths of frame files
    private MAX_TOPOLOGY_FRAMES: number = 100; // Default max number of frames to retain

    constructor(baseDir: string = process.cwd()) {
        this.baseDir = path.resolve(baseDir);
        this.ensureBaseDirectory();
        this.loadFrameManifest();
    }

    private ensureBaseDirectory(): void {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    private loadFrameManifest(): void {
        const manifestData = this.readState<{ currentFrameSequence: number, frameHistory: string[] }>(this.manifestPath);
        if (manifestData) {
            this.currentFrameSequence = manifestData.currentFrameSequence || 0;
            this.frameHistory = manifestData.frameHistory || [];
        }
    }

    /**
     * Resolves a full file path relative to the base directory.
     * @param relativePath The path relative to the base directory (e.g., '.swarm/config.json').
     * @returns The absolute file path.
     */
    private resolvePath(relativePath: string): string {
        return path.join(this.baseDir, relativePath);
    }

    /**
     * Reads data from a local file, optionally validating it against a Zod schema.
     * @param relativePath The path to the file relative to the base directory.
     * @param schemaName The name of the Zod schema to use for validation (e.g., 'QIS_TUNE_PHYSICS').
     * @returns The parsed data, or null if the file does not exist or validation fails.
     */
    public readState<T>(relativePath: string, schemaName?: string, schemaObj?: z.ZodSchema<any>): T | null {
        const filePath = this.resolvePath(relativePath);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(fileContent);

            if (schemaObj) {
                const validationResult = schemaObj.safeParse(data);
                if (!validationResult.success) {
                    console.error(`[LocalStoreManager] Validation failed for ${relativePath} with provided schema object:`, validationResult.error);
                    return null;
                }
                return validationResult.data as T;
            } else if (schemaName) {
                const schema = getMcpToolSchema(schemaName, null); // Pass null for tool as it's not a DynamicMcpTool
                const validationResult = z.object(schema).safeParse(data);
                if (!validationResult.success) {
                    console.error(`[LocalStoreManager] Validation failed for ${relativePath} with schema ${schemaName}:`, validationResult.error);
                    return null;
                }
                return validationResult.data as T;
            }
            return data as T;
        } catch (error) {
            console.error(`[LocalStoreManager] Error reading or parsing ${relativePath}:`, error);
            return null;
        }
    }

    /**
     * Writes data to a local file, optionally validating it against a Zod schema.
     * @param relativePath The path to the file relative to the base directory.
     * @param data The data to write.
     * @param schemaName The name of the Zod schema to use for validation.
     * @param schemaObj An optional Zod schema object to use for validation.
     */
    public writeState<T>(relativePath: string, data: T, schemaName?: string, schemaObj?: z.ZodSchema<any>): void {
        const filePath = this.resolvePath(relativePath);
        const dirPath = path.dirname(filePath);

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        if (schemaObj) {
            const validationResult = schemaObj.safeParse(data);
            if (!validationResult.success) {
                console.error(`[LocalStoreManager] Validation failed for data before writing to ${relativePath} with provided schema object:`, validationResult.error);
                throw new Error(`Data validation failed for ${relativePath}`);
            }
        } else if (schemaName) {
            const schema = getMcpToolSchema(schemaName, null);
            const validationResult = z.object(schema).safeParse(data);
            if (!validationResult.success) {
                console.error(`[LocalStoreManager] Validation failed for data before writing to ${relativePath} with schema ${schemaName}:`, validationResult.error);
                throw new Error(`Data validation failed for ${relativePath}`);
            }
        }

        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`[LocalStoreManager] Error writing to ${relativePath}:`, error);
            throw error;
        }
    }

    /**
     * Appends content to a log file, truncating it if it exceeds a maximum size.
     * This prevents runaway log growth.
     * @param relativePath The path to the log file relative to the base directory.
     * @param content The content to append.
     */
    public appendLog(relativePath: string, content: string): void {
        const filePath = this.resolvePath(relativePath);
        const dirPath = path.dirname(filePath);

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        try {
            fs.appendFileSync(filePath, content + '\n', 'utf-8');

            const stats = fs.statSync(filePath);
            if (stats.size > this.logFileMaxSize) {
                // Truncate the file to the last N bytes to prevent runaway growth
                const bufferSize = Math.floor(this.logFileMaxSize * 0.8); // Keep 80% of the max size
                const buffer = Buffer.alloc(bufferSize);
                const fd = fs.openSync(filePath, 'r+');
                fs.readSync(fd, buffer, 0, bufferSize, stats.size - bufferSize);
                fs.ftruncateSync(fd, 0); // Truncate to 0
                fs.writeSync(fd, buffer, 0, buffer.length, 0);
                fs.closeSync(fd);
                console.warn(`[LocalStoreManager] Log file ${relativePath} truncated to ${bufferSize} bytes.`);
            }
        } catch (error) {
            console.error(`[LocalStoreManager] Error appending to log file ${relativePath}:`, error);
            throw error;
        }
    }

    /**
     * Writes a new topology frame to a sequentially numbered JSON file.
     * Implements a sliding window to retain only the most recent frames.
     * @param data The raw NNSD matrix data for the topology frame.
     */
    public writeTopologyFrame(data: any): void {
        this.currentFrameSequence++;
        const frameFileName = `frame_${String(this.currentFrameSequence).padStart(3, '0')}.json`;
        const frameRelativePath = path.join(this.framesDir, frameFileName);
        const frameFilePath = this.resolvePath(frameRelativePath);

        try {
            // Ensure the frames directory exists
            const framesDirPath = this.resolvePath(this.framesDir);
            if (!fs.existsSync(framesDirPath)) {
                fs.mkdirSync(framesDirPath, { recursive: true });
            }

            // Write the new frame data
            fs.writeFileSync(frameFilePath, JSON.stringify(data, null, 2), 'utf-8');
            this.frameHistory.push(frameRelativePath);
            console.error(`[LocalStoreManager] Wrote topology frame: ${frameRelativePath}`);

            // Implement sliding window for frame history
            if (this.frameHistory.length > this.MAX_TOPOLOGY_FRAMES) {
                const oldestFrameRelativePath = this.frameHistory.shift(); // Remove from beginning
                if (oldestFrameRelativePath) {
                    const oldestFrameFilePath = this.resolvePath(oldestFrameRelativePath);
                    if (fs.existsSync(oldestFrameFilePath)) {
                        fs.unlinkSync(oldestFrameFilePath); // Delete the oldest file
                        console.warn(`[LocalStoreManager] Deleted oldest topology frame: ${oldestFrameRelativePath}`);
                    }
                }
            }

            // Update and persist the manifest
            this.writeState(this.manifestPath, {
                currentFrameSequence: this.currentFrameSequence,
                frameHistory: this.frameHistory,
            });
        } catch (error) {
            console.error(`[LocalStoreManager] Error writing topology frame ${frameRelativePath}:`, error);
            throw error;
        }
    }


    /**
     * Deletes a file from the local store.
     * @param relativePath The path to the file relative to the base directory.
     */
    public deleteFile(relativePath: string): void {
        const filePath = this.resolvePath(relativePath);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.error(`[LocalStoreManager] Deleted file: ${relativePath}`);
            } catch (error) {
                console.error(`[LocalStoreManager] Error deleting file ${relativePath}:`, error);
                throw error;
            }
        } else {
            console.warn(`[LocalStoreManager] Attempted to delete non-existent file: ${relativePath}`);
        }
    }

}
