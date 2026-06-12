// ============================================================
// Batch Analyzer - Process multiple symbols in one call
// ============================================================
// Reduces Claude's tool calls from N to 1

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol } from '../graph/types.js';

export interface BatchResult {
  symbols: Array<{
    symbol: Symbol;
    callers: number;
    callees: number;
    risk: 'low' | 'medium' | 'high' | 'critical';
  }>;
  summary: {
    total: number;
    highRisk: number;
    avgComplexity: number;
  };
}

/**
 * Process multiple symbols in a single call
 */
export class BatchAnalyzer {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Analyze multiple symbols at once
   */
  analyze(symbolIds: string[]): BatchResult {
    const symbols = symbolIds
      .map(id => this.store.getSymbol(id))
      .filter((s): s is Symbol => s !== null);

    const results = symbols.map(symbol => {
      const callers = this.store.getCallers(symbol.id);
      const callees = this.store.getCallees(symbol.id);

      // Risk assessment
      let risk: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (callers.length > 10) risk = 'critical';
      else if (callers.length > 5) risk = 'high';
      else if (callers.length > 2) risk = 'medium';

      return {
        symbol,
        callers: callers.length,
        callees: callees.length,
        risk,
      };
    });

    // Calculate summary
    const total = results.length;
    const highRisk = results.filter(r => r.risk === 'high' || r.risk === 'critical').length;
    const avgComplexity = results.reduce((sum, r) => sum + (r.symbol.complexity || 0), 0) / total;

    return {
      symbols: results,
      summary: {
        total,
        highRisk,
        avgComplexity: Math.round(avgComplexity),
      },
    };
  }

  /**
   * Batch search with filters
   */
  searchBatch(queries: string[], options: { kind?: string; limit?: number } = {}): Map<string, Symbol[]> {
    const results = new Map<string, Symbol[]>();

    for (const query of queries) {
      const symbols = this.store.searchSymbols(query, {
        kind: options.kind as any,
        limit: options.limit || 5,
      });
      results.set(query, symbols);
    }

    return results;
  }

  /**
   * Format batch results
   */
  static formatResults(result: BatchResult): string {
    const lines: string[] = [];

    lines.push(`📊 Batch Analysis: ${result.summary.total} symbols`);
    lines.push('═'.repeat(40));
    lines.push(`High risk: ${result.summary.highRisk}`);
    lines.push(`Avg complexity: ${result.summary.avgComplexity}`);
    lines.push('');

    for (const item of result.symbols) {
      const riskEmoji = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        critical: '🔴',
      }[item.risk];

      lines.push(`${riskEmoji} ${item.symbol.name} (${item.symbol.kind})`);
      lines.push(`   Callers: ${item.callers} | Callees: ${item.callees} | Risk: ${item.risk}`);
    }

    return lines.join('\n');
  }
}
