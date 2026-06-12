// ============================================================
// Context Builder - Graph-aware LLM context construction
// ============================================================
// Replaces raw source code with structured graph summaries
// to reduce token consumption by ~90% while preserving
// the information AI reviewers actually need.

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol } from '../graph/types.js';

export interface ContextBuilderOptions {
  /** Maximum tokens for the context (default: 4000) */
  maxTokens?: number;
  /** How to include source code: 'full' | 'signature' | 'none' (default: 'signature') */
  includeSource?: 'full' | 'signature' | 'none';
  /** Include caller information (default: true) */
  includeCallers?: boolean;
  /** Include callee information (default: true) */
  includeCallees?: boolean;
  /** Include already-found static analysis findings (default: true) */
  includeStaticFindings?: boolean;
}

export interface ReviewContext {
  /** System prompt for the LLM */
  systemPrompt: string;
  /** Code context built from graph data */
  codeContext: string;
  /** Static analysis findings already discovered */
  staticFindings: string;
  /** Estimated token count */
  tokenEstimate: number;
  /** Number of symbols included */
  symbolCount: number;
  /** Number of symbols skipped (too simple) */
  skippedSymbols: number;
}

export interface StaticFinding {
  severity: 'error' | 'warning' | 'info';
  category: string;
  symbolName: string;
  description: string;
}

/**
 * Builds minimal but sufficient LLM context using graph data.
 *
 * Instead of sending raw source code (~500 tokens/symbol),
 * sends structured graph summaries (~50 tokens/symbol):
 * - Symbol metadata (name, kind, layer, complexity)
 * - Doc comments / AI summaries
 * - Caller/callee relationships
 * - Function signatures (not full bodies)
 */
export class ContextBuilder {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Build review context from changed symbols.
   */
  buildReviewContext(
    symbols: Symbol[],
    options?: ContextBuilderOptions,
    staticFindings?: StaticFinding[],
  ): ReviewContext {
    const opts: Required<ContextBuilderOptions> = {
      maxTokens: options?.maxTokens ?? 4000,
      includeSource: options?.includeSource ?? 'signature',
      includeCallers: options?.includeCallers ?? true,
      includeCallees: options?.includeCallees ?? true,
      includeStaticFindings: options?.includeStaticFindings ?? true,
    };

    // Filter out simple symbols
    const { meaningful, skipped } = this.filterSymbols(symbols);

    // Build context within token budget
    const codeParts: string[] = [];
    let tokenEstimate = 0;
    let includedCount = 0;

    // Sort by complexity descending (most complex first)
    const sorted = [...meaningful].sort((a, b) => (b.complexity ?? 0) - (a.complexity ?? 0));

    for (const symbol of sorted) {
      const symbolContext = this.buildSymbolContext(symbol, opts);
      const symbolTokens = this.estimateTokens(symbolContext);

      if (tokenEstimate + symbolTokens > opts.maxTokens) {
        // Try with reduced context
        const reducedContext = this.buildSymbolContext(symbol, {
          ...opts,
          includeSource: 'none',
          includeCallers: false,
          includeCallees: false,
        });
        const reducedTokens = this.estimateTokens(reducedContext);
        if (tokenEstimate + reducedTokens <= opts.maxTokens) {
          codeParts.push(reducedContext);
          tokenEstimate += reducedTokens;
          includedCount++;
        }
        continue;
      }

      codeParts.push(symbolContext);
      tokenEstimate += symbolTokens;
      includedCount++;
    }

    // Build static findings summary
    let findingsSummary = '';
    if (opts.includeStaticFindings && staticFindings && staticFindings.length > 0) {
      findingsSummary = this.buildFindingsSummary(staticFindings);
      tokenEstimate += this.estimateTokens(findingsSummary);
    }

    const codeContext = codeParts.join('\n---\n');

    // Estimate system prompt
    const systemPrompt = this.buildSystemPrompt(opts.includeStaticFindings && staticFindings ? staticFindings.length : 0);
    tokenEstimate += this.estimateTokens(systemPrompt);

    return {
      systemPrompt,
      codeContext,
      staticFindings: findingsSummary,
      tokenEstimate,
      symbolCount: includedCount,
      skippedSymbols: skipped,
    };
  }

  /**
   * Build explain context for a single symbol or module.
   */
  buildExplainContext(
    symbols: Symbol[],
    options?: { maxTokens?: number; includeSource?: boolean },
  ): { systemPrompt: string; userContext: string; tokenEstimate: number } {
    const maxTokens = options?.maxTokens ?? 3000;
    const includeSource = options?.includeSource ?? false;

    const parts: string[] = [];
    let tokenEstimate = 0;

    for (const symbol of symbols) {
      const symbolPart = this.buildExplainSymbolContext(symbol, includeSource);
      const symbolTokens = this.estimateTokens(symbolPart);

      if (tokenEstimate + symbolTokens > maxTokens) continue;

      parts.push(symbolPart);
      tokenEstimate += symbolTokens;
    }

    const systemPrompt = '你是一个资深代码分析师。请用简洁自然的语言回答，避免堆砌技术术语。';
    tokenEstimate += this.estimateTokens(systemPrompt);

    return {
      systemPrompt,
      userContext: parts.join('\n\n'),
      tokenEstimate,
    };
  }

  // ========================
  // Internal: Symbol context
  // ========================

  private buildSymbolContext(symbol: Symbol, opts: Required<ContextBuilderOptions>): string {
    const parts: string[] = [];

    // Header with metadata
    const meta = [
      `${symbol.name} (${symbol.kind})`,
      `@ ${symbol.filePath}:${symbol.startLine}`,
      `Layer: ${symbol.layer}`,
      symbol.complexity ? `Complexity: ${symbol.complexity}` : '',
      symbol.exported ? 'Exported: yes' : '',
    ].filter(Boolean).join(' | ');

    parts.push(`### ${meta}`);

    // Doc comment or AI summary (whichever is available)
    if (symbol.aiSummary) {
      parts.push(`Summary: ${symbol.aiSummary}`);
    } else if (symbol.docComment) {
      parts.push(`Doc: ${symbol.docComment.slice(0, 200)}`);
    }

    // Source code (based on includeSource setting)
    if (opts.includeSource === 'full' && symbol.sourceCode) {
      // Truncate to first 30 lines max
      const lines = symbol.sourceCode.split('\n');
      const truncated = lines.length > 30
        ? lines.slice(0, 30).join('\n') + `\n// ... ${lines.length - 30} more lines`
        : symbol.sourceCode;
      parts.push(`\`\`\`\n${truncated}\n\`\`\``);
    } else if (opts.includeSource === 'signature' && symbol.sourceCode) {
      const sig = this.extractSignature(symbol.sourceCode, symbol.kind);
      if (sig) parts.push(`Signature: \`${sig}\``);
    }

    // Caller/callee relationships
    if (opts.includeCallers) {
      const callers = this.store.getCallers(symbol.id);
      if (callers.length > 0) {
        parts.push(`Called by: ${callers.map(c => c.name).join(', ')}`);
      }
    }

    if (opts.includeCallees) {
      const callees = this.store.getCallees(symbol.id);
      if (callees.length > 0) {
        parts.push(`Calls: ${callees.map(c => c.name).join(', ')}`);
      }
    }

    return parts.join('\n');
  }

  private buildExplainSymbolContext(symbol: Symbol, includeSource: boolean): string {
    const parts: string[] = [];

    parts.push(`### ${symbol.name} (${symbol.kind})`);
    parts.push(`File: ${symbol.filePath}:${symbol.startLine}-${symbol.endLine}`);
    parts.push(`Layer: ${symbol.layer} | Complexity: ${symbol.complexity ?? 'N/A'} | Exported: ${symbol.exported}`);

    if (symbol.aiSummary) {
      parts.push(`AI Summary: ${symbol.aiSummary}`);
    }
    if (symbol.docComment) {
      parts.push(`Doc: ${symbol.docComment.slice(0, 300)}`);
    }

    // Include callers/callees for context
    const callers = this.store.getCallers(symbol.id);
    const callees = this.store.getCallees(symbol.id);
    if (callers.length > 0) parts.push(`Called by: ${callers.map(c => `${c.name} (${c.kind})`).join(', ')}`);
    if (callees.length > 0) parts.push(`Calls: ${callees.map(c => `${c.name} (${c.kind})`).join(', ')}`);

    // Source code only if explicitly requested and no AI summary
    if (includeSource && !symbol.aiSummary && symbol.sourceCode) {
      const lines = symbol.sourceCode.split('\n');
      const truncated = lines.length > 40
        ? lines.slice(0, 40).join('\n') + `\n// ... ${lines.length - 40} more lines`
        : symbol.sourceCode;
      parts.push(`\`\`\`\n${truncated}\n\`\`\``);
    }

    return parts.join('\n');
  }

  // ========================
  // Internal: Filtering
  // ========================

  private filterSymbols(symbols: Symbol[]): { meaningful: Symbol[]; skipped: number } {
    const meaningful: Symbol[] = [];
    let skipped = 0;

    for (const symbol of symbols) {
      // Skip very simple symbols
      if (
        (symbol.complexity ?? 0) < 3 &&
        !symbol.exported &&
        !symbol.aiSummary &&
        !symbol.docComment &&
        (symbol.sourceCode?.split('\n').length ?? 0) < 5
      ) {
        skipped++;
        continue;
      }

      meaningful.push(symbol);
    }

    return { meaningful, skipped };
  }

  // ========================
  // Internal: Findings summary
  // ========================

  private buildFindingsSummary(findings: StaticFinding[]): string {
    const parts: string[] = [];
    parts.push('## Static Analysis Findings (already discovered)');

    const byCategory = new Map<string, StaticFinding[]>();
    for (const f of findings) {
      if (!byCategory.has(f.category)) byCategory.set(f.category, []);
      byCategory.get(f.category)!.push(f);
    }

    for (const [category, items] of byCategory) {
      parts.push(`\n### ${category} (${items.length})`);
      for (const item of items.slice(0, 5)) {
        parts.push(`- [${item.severity}] ${item.symbolName}: ${item.description}`);
      }
      if (items.length > 5) {
        parts.push(`  ... and ${items.length - 5} more`);
      }
    }

    parts.push('\nPlease focus on issues NOT covered above — logic errors, semantic issues, architectural concerns, or anything static analysis cannot detect.');

    return parts.join('\n');
  }

  // ========================
  // Internal: System prompt
  // ========================

  private buildSystemPrompt(staticFindingsCount: number): string {
    const parts: string[] = [];

    parts.push('You are a senior code reviewer analyzing code changes.');

    if (staticFindingsCount > 0) {
      parts.push(`Static analysis has already found ${staticFindingsCount} issues. Your job is to find issues that static analysis CANNOT detect: logic errors, race conditions, semantic bugs, architectural violations, API misuse, and subtle correctness problems.`);
    }

    parts.push('');
    parts.push('Respond in JSON format:');
    parts.push('[{ "severity": "error|warning|info", "category": "security|perf|correctness|readability", "symbolName": "name", "line": N, "description": "...", "suggestion": "..." }]');
    parts.push('If no issues found, respond with: []');

    return parts.join('\n');
  }

  // ========================
  // Internal: Helpers
  // ========================

  private extractSignature(sourceCode: string, kind: string): string | null {
    const lines = sourceCode.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;
      if (trimmed.length === 0) continue;

      // Return first meaningful line (likely the signature)
      if (kind === 'function' || kind === 'method') {
        const match = trimmed.match(/^(export\s+)?(async\s+)?(function\s+\w+|[\w.]+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/);
        if (match) return match[0].trim();
      }
      if (kind === 'class') {
        const match = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+\w+/);
        if (match) return match[0].trim();
      }
      if (['interface', 'type', 'enum'].includes(kind)) {
        const match = trimmed.match(/^(export\s+)?(interface|type|enum)\s+\w+/);
        if (match) return match[0].trim();
      }

      // Fallback: first non-empty, non-comment line
      return trimmed.length > 120 ? trimmed.slice(0, 120) + '...' : trimmed;
    }
    return null;
  }

  /**
   * Rough token estimate: ~4 chars per token for English, ~2 chars for Chinese.
   * Uses a conservative 3.5 chars/token average.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
