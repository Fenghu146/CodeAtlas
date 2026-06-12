// ============================================================
// Hybrid Search - Combines keyword, vector, and graph search
// ============================================================
// Merges results from multiple search strategies for better
// relevance ranking.

import { SQLiteStore } from '../store/sqlite-store.js';
import { VectorStore, type SearchResult } from './vector-store.js';
import type { Symbol } from '../graph/types.js';

export interface HybridResult {
  symbol: Symbol;
  // Individual scores
  keywordScore: number;
  vectorScore: number;
  graphScore: number;
  // Combined score
  combinedScore: number;
  // Match reasons
  reasons: string[];
}

export interface HybridSearchOptions {
  /** Number of results to return */
  topK?: number;
  /** Weight for keyword score (default: 0.3) */
  keywordWeight?: number;
  /** Weight for vector score (default: 0.5) */
  vectorWeight?: number;
  /** Weight for graph score (default: 0.2) */
  graphWeight?: number;
  /** Filter by layer */
  layer?: string;
  /** Filter by kind */
  kind?: string;
}

/**
 * Hybrid search combining keyword, vector, and graph-based search.
 */
export class HybridSearch {
  private store: SQLiteStore;
  private vectorStore: VectorStore;

  constructor(store: SQLiteStore, vectorStore: VectorStore) {
    this.store = store;
    this.vectorStore = vectorStore;
  }

  /**
   * Perform hybrid search.
   */
  async search(
    query: string,
    options?: HybridSearchOptions,
  ): Promise<HybridResult[]> {
    const opts: Required<HybridSearchOptions> = {
      topK: options?.topK ?? 10,
      keywordWeight: options?.keywordWeight ?? 0.3,
      vectorWeight: options?.vectorWeight ?? 0.5,
      graphWeight: options?.graphWeight ?? 0.2,
      layer: options?.layer ?? '',
      kind: options?.kind ?? '',
    };

    // 1. Keyword search
    const keywordResults = this.keywordSearch(query, opts);

    // 2. Vector search
    const vectorResults = await this.vectorStore.search(query, opts.topK * 2);

    // 3. Graph expansion (callers/callees of top results)
    const graphResults = this.graphExpand([...keywordResults, ...vectorResults]);

    // 4. Merge and rank
    const merged = this.mergeResults(
      keywordResults,
      vectorResults,
      graphResults,
      opts,
    );

    return merged.slice(0, opts.topK);
  }

  /**
   * Keyword search using FTS5.
   */
  private keywordSearch(query: string, opts: Required<HybridSearchOptions>): SearchResult[] {
    const searchOpts: any = { limit: opts.topK * 2 };
    if (opts.kind) searchOpts.kind = opts.kind;
    if (opts.layer) searchOpts.layer = opts.layer;

    const symbols = this.store.searchSymbols(query, searchOpts);

    return symbols.map((s, i) => ({
      symbolId: s.id,
      symbol: s,
      score: 1 - (i / symbols.length), // Rank-based score
      matchType: 'keyword' as const,
    }));
  }

  /**
   * Graph expansion: find related symbols via callers/callees.
   */
  private graphExpand(results: SearchResult[]): SearchResult[] {
    const expanded: SearchResult[] = [];
    const seen = new Set<string>();

    for (const r of results.slice(0, 5)) {
      // Get callers
      const callers = this.store.getCallers(r.symbolId);
      for (const caller of callers.slice(0, 3)) {
        if (!seen.has(caller.id)) {
          seen.add(caller.id);
          expanded.push({
            symbolId: caller.id,
            symbol: caller,
            score: r.score * 0.5, // Diluted score
            matchType: 'graph',
          });
        }
      }

      // Get callees
      const callees = this.store.getCallees(r.symbolId);
      for (const callee of callees.slice(0, 3)) {
        if (!seen.has(callee.id)) {
          seen.add(callee.id);
          expanded.push({
            symbolId: callee.id,
            symbol: callee,
            score: r.score * 0.5,
            matchType: 'graph',
          });
        }
      }
    }

    return expanded;
  }

  /**
   * Merge results from all search strategies.
   */
  private mergeResults(
    keywordResults: SearchResult[],
    vectorResults: SearchResult[],
    graphResults: SearchResult[],
    opts: Required<HybridSearchOptions>,
  ): HybridResult[] {
    const resultMap = new Map<string, HybridResult>();

    // Process keyword results
    for (const r of keywordResults) {
      if (!resultMap.has(r.symbolId)) {
        resultMap.set(r.symbolId, {
          symbol: r.symbol,
          keywordScore: 0,
          vectorScore: 0,
          graphScore: 0,
          combinedScore: 0,
          reasons: [],
        });
      }
      const result = resultMap.get(r.symbolId)!;
      result.keywordScore = r.score;
      result.reasons.push('keyword match');
    }

    // Process vector results
    for (const r of vectorResults) {
      if (!resultMap.has(r.symbolId)) {
        resultMap.set(r.symbolId, {
          symbol: r.symbol,
          keywordScore: 0,
          vectorScore: 0,
          graphScore: 0,
          combinedScore: 0,
          reasons: [],
        });
      }
      const result = resultMap.get(r.symbolId)!;
      result.vectorScore = r.score;
      result.reasons.push('semantic similarity');
    }

    // Process graph results
    for (const r of graphResults) {
      if (!resultMap.has(r.symbolId)) {
        resultMap.set(r.symbolId, {
          symbol: r.symbol,
          keywordScore: 0,
          vectorScore: 0,
          graphScore: 0,
          combinedScore: 0,
          reasons: [],
        });
      }
      const result = resultMap.get(r.symbolId)!;
      result.graphScore = Math.max(result.graphScore, r.score);
      if (!result.reasons.includes('graph relation')) {
        result.reasons.push('graph relation');
      }
    }

    // Calculate combined scores
    const results = Array.from(resultMap.values());
    for (const result of results) {
      result.combinedScore =
        result.keywordScore * opts.keywordWeight +
        result.vectorScore * opts.vectorWeight +
        result.graphScore * opts.graphWeight;
    }

    // Sort by combined score
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    return results;
  }
}
