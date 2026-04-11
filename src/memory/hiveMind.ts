/**
 * HiveMind — Persistent Swarm Memory with Semantic Search
 *
 * Stores Context-Action-Outcome triplets with embedding vectors for
 * semantic retrieval. Persists to JSON files under .swarm/hive_mind/.
 *
 * Key features:
 * - Gemini embedding-powered semantic search
 * - Gold Standard flagging for human-sourced solutions
 * - Confidence degradation when memorized solutions fail
 * - File-based rotation at configurable size thresholds
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { EmbeddingClient } from './embeddingClient.js';
import {
  HiveMemoryTriplet,
  HiveQueryResult,
  HiveWriteOptions,
  HiveMindConfig,
  DEFAULT_HIVE_MIND_CONFIG,
} from './types.js';

export class HiveMind {
  private static instance: HiveMind | null = null;
  private config: HiveMindConfig;
  private embeddingClient: EmbeddingClient;
  private memories: HiveMemoryTriplet[] = [];
  private dirty = false;

  private constructor(config?: Partial<HiveMindConfig>, apiKey?: string) {
    this.config = { ...DEFAULT_HIVE_MIND_CONFIG, ...config };

    // Resolve storage directory to absolute path based on working directory
    if (!path.isAbsolute(this.config.storageDir)) {
      const workDir = process.env.MOMO_WORKING_DIR || process.cwd();
      this.config.storageDir = path.resolve(workDir, this.config.storageDir);
    }

    this.embeddingClient = new EmbeddingClient(apiKey);
    this.ensureStorageDir();
    this.loadMemories();
  }

  /** Get or create the singleton HiveMind instance */
  static getInstance(config?: Partial<HiveMindConfig>, apiKey?: string): HiveMind {
    if (!HiveMind.instance) {
      HiveMind.instance = new HiveMind(config, apiKey);
    }
    return HiveMind.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    HiveMind.instance = null;
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  /**
   * Semantic search across all memories.
   * Returns the top-K most similar triplets above the similarity threshold.
   */
  async query(
    text: string,
    topK?: number,
    tags?: string[]
  ): Promise<HiveQueryResult[]> {
    const k = topK ?? this.config.maxResults;
    const queryEmbedding = await this.embeddingClient.embed(text);

    let candidates = this.memories;

    // Filter by tags if provided
    if (tags && tags.length > 0) {
      const tagSet = new Set(tags.map(t => t.toLowerCase()));
      candidates = candidates.filter(m =>
        m.tags.some(t => tagSet.has(t.toLowerCase()))
      );
    }

    // Compute similarity for all candidates
    const scored: HiveQueryResult[] = candidates.map(triplet => ({
      triplet,
      similarity: EmbeddingClient.cosineSimilarity(queryEmbedding, triplet.embedding),
    }));

    // Use a substantially lower threshold for hash fallback since hash vectors
    // produce inherently sparse cosine similarities (mean ~0.006, empirically validated)
    // OUROBOROS Cycle 2: Lowered from 0.05 → 0.005 based on ouro_c2_hive_threshold_test.js
    const effectiveThreshold = this.embeddingClient.usingFallback
      ? Math.min(this.config.similarityThreshold, 0.005)
      : this.config.similarityThreshold;

    return scored
      .filter(r => r.similarity >= effectiveThreshold)
      .sort((a, b) => {
        const scoreA = a.similarity * a.triplet.confidence;
        const scoreB = b.similarity * b.triplet.confidence;
        return scoreB - scoreA;
      })
      .slice(0, k)
      .map(result => {
        // V2 DAG Resolution: Inject chronological context if it has a topological parent
        if (result.triplet.parentId) {
          const parent = this.memories.find(m => m.id === result.triplet.parentId);
          if (parent) {
            // Synthesize the timeline memory so the agent understands causation
            result.triplet = {
              ...result.triplet,
              context: `[Topological Ancestor]: ${parent.context} -> ${parent.action} (Outcome: ${parent.outcome})\n\n[Current Node]: ${result.triplet.context}`
            };
          }
        }
        return result;
      });
  }

  /**
   * Query specifically for past error resolutions.
   * Convenience wrapper that searches with error-specific context.
   */
  async queryForErrorResolution(
    errorText: string,
    toolName?: string
  ): Promise<HiveQueryResult[]> {
    const searchText = `Error during ${toolName || 'tool execution'}: ${errorText}`;
    return this.query(searchText, 3, ['error-resolution', 'self-healing']);
  }

  // ─── Write ──────────────────────────────────────────────────────────────

  /**
   * Store a new memory triplet with embedding.
   */
  async write(
    context: string,
    action: string,
    outcome: string,
    options?: HiveWriteOptions
  ): Promise<string> {
    const combinedText = `Context: ${context}\nAction: ${action}\nOutcome: ${outcome}`;
    const embedding = await this.embeddingClient.embed(combinedText);

    const triplet: HiveMemoryTriplet = {
      id: crypto.randomUUID(),
      context,
      action,
      outcome,
      embedding,
      confidence: options?.confidence ?? 0.7,
      timestamp: new Date().toISOString(),
      tags: options?.tags ?? [],
      isGoldStandard: options?.isGoldStandard ?? false,
      hitCount: 0,
      parentId: options?.parentId,
      timelineMetadata: options?.timelineMetadata
    };

    // DAG Linking: If parentId is missing but we're in a variant branch context, we could try to resolve it.
    // For now we rely on SwarmManager or Telemetry to seed the parentId.

    // Gold standard memories get max confidence
    if (triplet.isGoldStandard) {
      triplet.confidence = 1.0;
    }

    this.memories.push(triplet);
    this.dirty = true;
    this.persistMemories();

    process.stderr.write(
      `[HiveMind] Stored memory ${triplet.id} (confidence: ${triplet.confidence}, tags: [${triplet.tags.join(', ')}])\n`
    );

    return triplet.id;
  }

  /**
   * Store a human-provided solution as a gold standard memory.
   * These get maximum confidence weight and are never auto-degraded.
   */
  async writeGoldStandard(
    context: string,
    action: string,
    outcome: string,
    tags?: string[]
  ): Promise<string> {
    return this.write(context, action, outcome, {
      tags: [...(tags || []), 'gold-standard', 'human-sourced'],
      isGoldStandard: true,
      confidence: 1.0,
    });
  }

  // ─── Confidence Management ──────────────────────────────────────────────

  /**
   * Degrade the confidence of a memory (e.g., when telemetry detects
   * that a memorized solution caused errors).
   */
  degradeConfidence(id: string, reason: string, amount: number = 0.2): void {
    const memory = this.memories.find(m => m.id === id);
    if (!memory) return;

    // Never degrade gold standard memories
    if (memory.isGoldStandard) {
      process.stderr.write(
        `[HiveMind] Skipping degradation of gold standard memory ${id}\n`
      );
      return;
    }

    memory.confidence = Math.max(0, memory.confidence - amount);
    memory.degradationReason = reason;
    this.dirty = true;
    this.persistMemories();

    process.stderr.write(
      `[HiveMind] Degraded memory ${id} confidence to ${memory.confidence}: ${reason}\n`
    );
  }

  /**
   * Increment the hit count for a memory (when it's successfully retrieved and applied).
   */
  recordHit(id: string): void {
    const memory = this.memories.find(m => m.id === id);
    if (!memory) return;

    memory.hitCount++;
    // Slightly boost confidence on successful hits (max 0.95 for non-gold)
    if (!memory.isGoldStandard && memory.confidence < 0.95) {
      memory.confidence = Math.min(0.95, memory.confidence + 0.02);
    }
    this.dirty = true;
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  /** Get total memory count */
  getMemoryCount(): number {
    return this.memories.length;
  }

  /** Get memories by tag */
  getMemoriesByTag(tag: string): HiveMemoryTriplet[] {
    return this.memories.filter(m =>
      m.tags.some(t => t.toLowerCase() === tag.toLowerCase())
    );
  }

  /** Get summary stats for diagnostics */
  getStats(): {
    total: number;
    goldStandard: number;
    avgConfidence: number;
    topTags: Array<{ tag: string; count: number }>;
  } {
    const tagCounts = new Map<string, number>();
    let totalConfidence = 0;
    let goldCount = 0;

    for (const m of this.memories) {
      totalConfidence += m.confidence;
      if (m.isGoldStandard) goldCount++;
      for (const tag of m.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      total: this.memories.length,
      goldStandard: goldCount,
      avgConfidence: this.memories.length > 0 ? totalConfidence / this.memories.length : 0,
      topTags,
    };
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  private ensureStorageDir(): void {
    fs.mkdirSync(this.config.storageDir, { recursive: true });
  }

  private getMemoryFilePath(): string {
    return path.join(this.config.storageDir, 'memories.json');
  }

  private loadMemories(): void {
    const filePath = this.getMemoryFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        this.memories = JSON.parse(raw);
        process.stderr.write(
          `[HiveMind] Loaded ${this.memories.length} memories from disk.\n`
        );
      }
    } catch (err) {
      process.stderr.write(`[HiveMind] Failed to load memories: ${err}\n`);
      this.memories = [];
    }
  }

  private persistMemories(): void {
    if (!this.dirty) return;

    try {
      const filePath = this.getMemoryFilePath();
      const data = JSON.stringify(this.memories, null, 2);

      // Check for rotation
      if (data.length > this.config.maxFileSizeBytes) {
        const archivePath = path.join(
          this.config.storageDir,
          `memories_${Date.now()}.archive.json`
        );
        // Keep only recent memories, archive old ones
        const archiveCount = Math.floor(this.memories.length / 2);
        const archived = this.memories.splice(0, archiveCount);
        fs.writeFileSync(archivePath, JSON.stringify(archived, null, 2), 'utf-8');
        process.stderr.write(
          `[HiveMind] Rotated ${archiveCount} memories to ${archivePath}\n`
        );
      }

      fs.writeFileSync(filePath, JSON.stringify(this.memories, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      process.stderr.write(`[HiveMind] Failed to persist memories: ${err}\n`);
    }
  }

  /** Force flush all memories to disk */
  flush(): void {
    this.dirty = true;
    this.persistMemories();
  }
}
