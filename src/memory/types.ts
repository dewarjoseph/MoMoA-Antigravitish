/**
 * Hive Mind Memory Types — Persistent Swarm Memory Layer
 *
 * Defines the data structures for the Context-Action-Outcome triplet model
 * that powers the Hive Mind's semantic memory system.
 */

/** A single memory entry stored in the Hive Mind */
export interface HiveMemoryTriplet {
  /** Unique identifier for this memory */
  id: string;
  /** What the swarm was trying to accomplish */
  context: string;
  /** What tool/prompt/approach was used */
  action: string;
  /** Whether it succeeded, failed, and what the resolution was */
  outcome: string;
  /** Pre-computed embedding vector (Gemini text-embedding-004) */
  embedding: number[];
  /** Confidence weight: 0.0 (degraded) to 1.0 (gold standard) */
  confidence: number;
  /** ISO timestamp of when this memory was created */
  timestamp: string;
  /** Searchable tags for category filtering */
  tags: string[];
  /** Whether this memory came from a human-provided solution */
  isGoldStandard: boolean;
  /** Number of times this memory was successfully retrieved and applied */
  hitCount: number;
  /** Reason for last confidence degradation, if any */
  degradationReason?: string;
}

/** Result from a Hive Mind semantic query */
export interface HiveQueryResult {
  triplet: HiveMemoryTriplet;
  /** Cosine similarity score (0.0 to 1.0) */
  similarity: number;
}

/** Options for writing a new memory to the Hive Mind */
export interface HiveWriteOptions {
  tags?: string[];
  confidence?: number;
  isGoldStandard?: boolean;
}

/** Configuration for the Hive Mind persistence layer */
export interface HiveMindConfig {
  /** Base directory for memory storage (default: .swarm/hive_mind/) */
  storageDir: string;
  /** Maximum file size before rotation (default: 10MB) */
  maxFileSizeBytes: number;
  /** Minimum similarity threshold for query results (default: 0.3) */
  similarityThreshold: number;
  /** Maximum number of results per query (default: 10) */
  maxResults: number;
}

/** Default configuration values */
export const DEFAULT_HIVE_MIND_CONFIG: HiveMindConfig = {
  storageDir: '.swarm/hive_mind',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  similarityThreshold: 0.3,
  maxResults: 10,
};
