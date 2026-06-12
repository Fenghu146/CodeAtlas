// ============================================================
// Vector Store - Stores and searches vector embeddings
// ============================================================
// Uses SQLite for storage with in-memory cosine similarity search.
// For production, could integrate sqlite-vss or external vector DB.

import { SQLiteStore } from '../store/sqlite-store.js';
import { EmbeddingGenerator, createEmbeddingGenerator } from './embedding.js';
import type { Symbol } from '../graph/types.js';

export interface SearchResult {
  symbolId: string;
  symbol: Symbol;
  score: number;
  matchType: 'vector' | 'keyword' | 'graph';
}

/**
 * Stores vector embeddings and performs similarity search.
 */
export class VectorStore {
  private store: SQLiteStore;
  private generator: EmbeddingGenerator;
  private embeddings: Map<string, number[]> = new Map();

  constructor(store: SQLiteStore, generator?: EmbeddingGenerator) {
    this.store = store;
    this.generator = generator || createEmbeddingGenerator({ provider: 'local' });
  }

  /**
   * Index all symbols with embeddings.
   */
  async indexAll(onProgress?: (current: number, total: number) => void): Promise<number> {
    const symbols = this.store.searchSymbols('', { limit: 10000 });
    let indexed = 0;

    // Process in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      // Build texts for embedding
      const texts = batch.map(s => this.buildTextForEmbedding(s));

      // Generate embeddings
      const embeddings = await this.generator.embedBatch(texts);

      // Store embeddings
      for (let j = 0; j < batch.length; j++) {
        this.embeddings.set(batch[j].id, embeddings[j]);
        indexed++;
      }

      onProgress?.(indexed, symbols.length);
    }

    // Persist to SQLite
    this.persistEmbeddings();

    return indexed;
  }

  /**
   * Index a single symbol.
   */
  async indexSymbol(symbol: Symbol): Promise<void> {
    const text = this.buildTextForEmbedding(symbol);
    const embedding = await this.generator.embed(text);
    this.embeddings.set(symbol.id, embedding);
    this.persistEmbedding(symbol.id, embedding);
  }

  /**
   * Search for similar symbols.
   */
  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.generator.embed(query);

    // Calculate similarity with all indexed symbols
    const results: SearchResult[] = [];

    for (const [symbolId, embedding] of this.embeddings) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      const symbol = this.store.getSymbol(symbolId);

      if (symbol && score > 0.05) { // Minimum similarity threshold
        results.push({
          symbolId,
          symbol,
          score,
          matchType: 'vector',
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  /**
   * Get embedding for a symbol.
   */
  getEmbedding(symbolId: string): number[] | undefined {
    return this.embeddings.get(symbolId);
  }

  /**
   * Check if symbol is indexed.
   */
  isIndexed(symbolId: string): boolean {
    return this.embeddings.has(symbolId);
  }

  /**
   * Get index statistics.
   */
  getStats(): { indexed: number; dimension: number } {
    return {
      indexed: this.embeddings.size,
      dimension: this.generator.getDimension(),
    };
  }

  // ========================
  // Private Methods
  // ========================

  /**
   * Build text for embedding from symbol.
   */
  private buildTextForEmbedding(symbol: Symbol): string {
    const parts: string[] = [];

    // Name and kind
    parts.push(`${symbol.name} ${symbol.kind}`);

    // File path (for context)
    parts.push(symbol.filePath);

    // AI summary or doc comment
    if (symbol.aiSummary) {
      parts.push(symbol.aiSummary);
    } else if (symbol.docComment) {
      parts.push(symbol.docComment.slice(0, 200));
    }

    // Layer
    parts.push(`layer:${symbol.layer}`);

    return parts.join(' ');
  }

  /**
   * Calculate cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Persist all embeddings to SQLite.
   */
  private persistEmbeddings(): void {
    try {
      // Create table if not exists
      this.store.executeStatement(`
        CREATE TABLE IF NOT EXISTS symbol_embeddings (
          symbol_id TEXT PRIMARY KEY,
          embedding TEXT NOT NULL,
          model TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Batch insert
      for (const [symbolId, embedding] of this.embeddings) {
        this.persistEmbedding(symbolId, embedding);
      }
    } catch {
      // Table might not exist yet, skip persistence
    }
  }

  /**
   * Persist a single embedding.
   */
  private persistEmbedding(symbolId: string, embedding: number[]): void {
    try {
      const jsonStr = JSON.stringify(embedding);
      this.store.executeStatement(
        'INSERT OR REPLACE INTO symbol_embeddings (symbol_id, embedding, model) VALUES (?, ?, ?)',
        [symbolId, jsonStr, 'local-hash']
      );
    } catch {
      // Silently skip if table doesn't exist
    }
  }

  /**
   * Load embeddings from SQLite.
   */
  loadEmbeddings(): void {
    try {
      const rows = this.store.executeQuery('SELECT symbol_id, embedding FROM symbol_embeddings');
      for (const row of rows) {
        const embedding = JSON.parse(row.embedding);
        this.embeddings.set(row.symbol_id, embedding);
      }
    } catch {
      // Table might not exist, start fresh
    }
  }
}
