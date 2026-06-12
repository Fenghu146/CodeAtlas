// ============================================================
// Smart Context Builder - One-call comprehensive context
// ============================================================
// Returns complete context for a symbol in a single call
// Reduces Claude's tool calls from 5 to 1

import { SQLiteStore } from '../store/sqlite-store.js';
import { ImpactAnalyzer } from './impact-analyzer.js';
import { FlowAnalyzer } from './flow-analyzer.js';
import { CoverageAnalyzer } from './coverage-analyzer.js';
import type { Symbol } from '../graph/types.js';

export interface SmartContext {
  // Symbol info
  symbol: Symbol;
  signature: string;

  // Relationships
  callers: Array<{ name: string; file: string; line: number }>;
  callees: Array<{ name: string; file: string; line: number }>;
  imports: Array<{ name: string; file: string }>;

  // Impact
  impact: {
    direct: number;
    indirect: number;
    risk: 'low' | 'medium' | 'high' | 'critical';
  };

  // Flow
  flow: {
    calls: string[];
    calledBy: string[];
  };

  // Coverage
  coverage: {
    hasTest: boolean;
    testFiles: string[];
  };

  // Metrics
  metrics: {
    complexity: number;
    lines: number;
    callerCount: number;
    calleeCount: number;
  };

  // Summary
  summary: string;
  tokenCount: number; // Estimated tokens used
}

/**
 * Builds comprehensive context for a symbol in a single call
 */
export class SmartContextBuilder {
  private store: SQLiteStore;
  private impactAnalyzer: ImpactAnalyzer;
  private coverageAnalyzer: CoverageAnalyzer;

  constructor(store: SQLiteStore) {
    this.store = store;
    this.impactAnalyzer = new ImpactAnalyzer(store);
    this.coverageAnalyzer = new CoverageAnalyzer(store);
  }

  /**
   * Build complete context for a symbol
   */
  build(symbolId: string, options: { maxTokens?: number } = {}): SmartContext | null {
    const symbol = this.store.getSymbol(symbolId);
    if (!symbol) return null;

    const maxTokens = options.maxTokens || 500;

    // Get all data in parallel
    const callers = this.getCallers(symbol);
    const callees = this.getCallees(symbol);
    const imports = this.getImports(symbol);
    const impact = this.getImpact(symbol);
    const flow = this.getFlow(symbol);
    const coverage = this.getCoverage(symbol);

    // Calculate metrics
    const metrics = {
      complexity: symbol.complexity || 0,
      lines: symbol.sourceCode ? symbol.sourceCode.split('\n').length : 0,
      callerCount: callers.length,
      calleeCount: callees.length,
    };

    // Generate signature
    const signature = this.generateSignature(symbol);

    // Generate summary (fit within token budget)
    const summary = this.generateSummary(symbol, callers, callees, impact, metrics, maxTokens);

    // Estimate token count
    const tokenCount = this.estimateTokens(summary);

    return {
      symbol,
      signature,
      callers: callers.slice(0, 10), // Limit to save tokens
      callees: callees.slice(0, 10),
      imports: imports.slice(0, 5),
      impact,
      flow,
      coverage,
      metrics,
      summary,
      tokenCount,
    };
  }

  /**
   * Get callers with metadata
   */
  private getCallers(symbol: Symbol): Array<{ name: string; file: string; line: number }> {
    const callers = this.store.getCallers(symbol.id);
    return callers.map(c => ({
      name: c.name,
      file: c.filePath,
      line: c.startLine,
    }));
  }

  /**
   * Get callees with metadata
   */
  private getCallees(symbol: Symbol): Array<{ name: string; file: string; line: number }> {
    const callees = this.store.getCallees(symbol.id);
    return callees.map(c => ({
      name: c.name,
      file: c.filePath,
      line: c.startLine,
    }));
  }

  /**
   * Get imports
   */
  private getImports(symbol: Symbol): Array<{ name: string; file: string }> {
    const rels = this.store.getRelationshipsFrom(symbol.id);
    return rels
      .filter(r => r.kind === 'imports')
      .map(r => {
        const target = this.store.getSymbol(r.targetId);
        return {
          name: target?.name || r.targetId,
          file: target?.filePath || '',
        };
      });
  }

  /**
   * Get impact summary
   */
  private getImpact(symbol: Symbol): SmartContext['impact'] {
    const result = this.impactAnalyzer.analyze(symbol.id, 2);
    return {
      direct: result?.direct.length || 0,
      indirect: result?.indirect.length || 0,
      risk: result?.risk || 'low',
    };
  }

  /**
   * Get flow summary
   */
  private getFlow(symbol: Symbol): SmartContext['flow'] {
    // Get what this symbol calls (downstream)
    const callees = this.store.getCallees(symbol.id);
    const calls = callees.map(c => c.name).slice(0, 5);

    // Get what calls this symbol (upstream)
    const callers = this.store.getCallers(symbol.id);
    const calledBy = callers.map(c => c.name).slice(0, 5);

    return { calls, calledBy };
  }

  /**
   * Get coverage info
   */
  private getCoverage(symbol: Symbol): SmartContext['coverage'] {
    const report = this.coverageAnalyzer.analyze();
    const detail = report.coverageDetails.find(c => c.symbol.id === symbol.id);
    return {
      hasTest: detail?.hasTest || false,
      testFiles: detail?.testFiles || [],
    };
  }

  /**
   * Generate function/method signature
   */
  private generateSignature(symbol: Symbol): string {
    const kind = symbol.kind;
    const name = symbol.name;

    if (kind === 'function' || kind === 'method') {
      // Extract parameters from source code
      const paramMatch = symbol.sourceCode?.match(/\(([^)]*)\)/);
      const params = paramMatch ? paramMatch[1].trim() : '';
      return `${name}(${params})`;
    }

    if (kind === 'class') {
      return `class ${name}`;
    }

    return `${kind} ${name}`;
  }

  /**
   * Generate concise summary within token budget
   */
  private generateSummary(
    symbol: Symbol,
    callers: any[],
    callees: any[],
    impact: SmartContext['impact'],
    metrics: any,
    maxTokens: number,
  ): string {
    const lines: string[] = [];

    // Essential info (always include)
    lines.push(`${symbol.name} (${symbol.kind}) @ ${symbol.filePath}:${symbol.startLine}`);
    lines.push(`Layer: ${symbol.layer} | Complexity: ${metrics.complexity} | Lines: ${metrics.lines}`);

    // Relationships (compact)
    if (callers.length > 0) {
      lines.push(`Called by: ${callers.map(c => c.name).join(', ')}`);
    }
    if (callees.length > 0) {
      lines.push(`Calls: ${callees.map(c => c.name).join(', ')}`);
    }

    // Impact (if significant)
    if (impact.direct > 0 || impact.indirect > 0) {
      lines.push(`Impact: ${impact.direct} direct, ${impact.indirect} indirect (${impact.risk})`);
    }

    // Source preview (if space allows)
    if (symbol.sourceCode && maxTokens > 100) {
      const preview = symbol.sourceCode.split('\n').slice(0, 5).join('\n');
      lines.push(`\nSource:\n${preview}`);
    }

    return lines.join('\n');
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}
