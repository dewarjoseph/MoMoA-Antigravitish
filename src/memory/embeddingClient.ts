/**
 * EmbeddingClient — Gemini Embedding API wrapper for the Hive Mind.
 *
 * Generates text embeddings using Gemini's text-embedding-004 model
 * and provides pure JS cosine similarity computation.
 * Falls back gracefully when API key is unavailable.
 */

const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;

export class EmbeddingClient {
  private apiKey: string;
  private cache: Map<string, number[]> = new Map();
  public usingFallback = false;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
  }

  /**
   * Generate an embedding vector for the given text.
   * Uses Gemini text-embedding-004 with aggressive caching.
   */
  async embed(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = text.substring(0, 500); // Cache by first 500 chars
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.apiKey) {
      // Graceful fallback: return a simple hash-based pseudo-embedding
      this.usingFallback = true;
      const fallback = this.hashEmbedding(text);
      this.cache.set(cacheKey, fallback);
      return fallback;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text: text.substring(0, 8000) }] },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        process.stderr.write(`[EmbeddingClient] API error ${response.status}, using hash fallback.\n`);
        const fallback = this.hashEmbedding(text);
        this.cache.set(cacheKey, fallback);
        return fallback;
      }

      const data = await response.json() as any;
      const values: number[] = data?.embedding?.values || [];

      if (values.length > 0) {
        this.cache.set(cacheKey, values);
        return values;
      }

      // Unexpected response format
      const fallback = this.hashEmbedding(text);
      this.cache.set(cacheKey, fallback);
      return fallback;
    } catch (err) {
      process.stderr.write(`[EmbeddingClient] Embedding failed: ${err}, using hash fallback.\n`);
      const fallback = this.hashEmbedding(text);
      this.cache.set(cacheKey, fallback);
      return fallback;
    }
  }

  /**
   * Compute cosine similarity between two vectors.
   * Returns a value between -1.0 (opposite) and 1.0 (identical).
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;

    const minLen = Math.min(a.length, b.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < minLen; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Fallback: generate a deterministic pseudo-embedding from text hash.
   * Not semantically meaningful, but ensures the system doesn't break
   * when the Gemini API is unavailable.
   */
  private hashEmbedding(text: string): number[] {
    const embedding = new Array(EMBEDDING_DIMENSIONS).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      // Scatter the hash across embedding dimensions
      for (let d = 0; d < 8; d++) {
        const idx = Math.abs((hash + d * 997) % EMBEDDING_DIMENSIONS); // Optimized from 97 -> 997
        embedding[idx] += (hash > 0 ? 1 : -1) * (1 / Math.pow(w + 1, 2.0)); // Optimized decay penalty from 1.0 -> 2.0
      }
    }

    // Normalize to unit vector
    const norm = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /** Clear the embedding cache */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get cache size for diagnostics */
  getCacheSize(): number {
    return this.cache.size;
  }
}
