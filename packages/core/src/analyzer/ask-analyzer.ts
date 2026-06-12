// ============================================================
// Ask Analyzer - Natural language code Q&A
// ============================================================

import { SQLiteStore } from '../store/sqlite-store.js';
import { ModuleExplainer } from './module-explainer.js';
import type { Symbol } from '../graph/types.js';

export interface AskResult {
  answer: string;
  symbols: Symbol[];
  confidence: number;
}

/**
 * Natural language code question answering
 */
export class AskAnalyzer {
  private store: SQLiteStore;
  private explainer: ModuleExplainer | null;

  constructor(store: SQLiteStore, explainer?: ModuleExplainer) {
    this.store = store;
    this.explainer = explainer ?? null;
  }

  /**
   * Answer a natural language question about the code
   */
  async answer(question: string): Promise<AskResult> {
    // 1. Extract keywords from question
    const keywords = this.extractKeywords(question);

    // 2. Search for relevant symbols
    const relevantSymbols = this.searchRelevantSymbols(keywords);

    // 3. Build context from found symbols
    const context = this.buildContext(relevantSymbols);

    // 4. Generate answer
    let answer: string;

    if (this.explainer) {
      // Use LLM for intelligent answer
      answer = await this.generateLLMAnswer(question, context);
    } else {
      // Fallback to structured answer
      answer = this.generateStructuredAnswer(question, relevantSymbols);
    }

    return {
      answer,
      symbols: relevantSymbols,
      confidence: this.calculateConfidence(relevantSymbols, keywords),
    };
  }

  /**
   * Extract keywords from question
   */
  private extractKeywords(question: string): string[] {
    // Simple keyword extraction
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'this', 'that', 'these', 'those',
      'what', 'how', 'when', 'where', 'who', 'which', 'why', 'do', 'does', 'did']);

    return question
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Search for relevant symbols
   */
  private searchRelevantSymbols(keywords: string[]): Symbol[] {
    const symbolMap = new Map<string, { symbol: Symbol; score: number }>();

    for (const keyword of keywords) {
      const results = this.store.searchSymbols(keyword, { limit: 10 });
      for (const symbol of results) {
        const existing = symbolMap.get(symbol.id);
        if (existing) {
          existing.score++;
        } else {
          symbolMap.set(symbol.id, { symbol, score: 1 });
        }
      }
    }

    return Array.from(symbolMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.symbol);
  }

  /**
   * Build context for answer generation
   */
  private buildContext(symbols: Symbol[]): string {
    const parts: string[] = [];
    parts.push('Relevant symbols in the codebase:\n');

    for (const symbol of symbols) {
      parts.push(`- ${symbol.name} (${symbol.kind}, ${symbol.layer}) @ ${symbol.filePath}:${symbol.startLine}`);
      if (symbol.sourceCode) {
        const preview = symbol.sourceCode.slice(0, 200).replace(/\n/g, ' ');
        parts.push(`  Preview: ${preview}...`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Generate answer using LLM
   */
  private async generateLLMAnswer(question: string, context: string): Promise<string> {
    if (!this.explainer) {
      return this.generateStructuredAnswer(question, []);
    }

    try {
      const prompt = `Based on the following code context, answer this question: "${question}"

Context:
${context}

Provide a clear, concise answer that references specific symbols and files.`;

      return await this.explainer.explainSymbol({
        id: 'context',
        name: 'context',
        kind: 'module',
        filePath: '',
        startLine: 0,
        endLine: 0,
        language: '',
        layer: 'unknown',
        exported: false,
        sourceCode: context,
      });
    } catch (err) {
      return this.generateStructuredAnswer(question, []);
    }
  }

  /**
   * Generate structured answer without LLM
   */
  private generateStructuredAnswer(question: string, symbols: Symbol[]): string {
    if (symbols.length === 0) {
      return `No relevant code found for: "${question}"`;
    }

    const parts: string[] = [];
    parts.push(`Based on the codebase, here are the relevant symbols:\n`);

    // Group by kind
    const byKind = new Map<string, Symbol[]>();
    for (const symbol of symbols) {
      const kind = symbol.kind;
      if (!byKind.has(kind)) {
        byKind.set(kind, []);
      }
      byKind.get(kind)!.push(symbol);
    }

    for (const [kind, kindSymbols] of byKind) {
      parts.push(`**${kind.charAt(0).toUpperCase() + kind.slice(1)}s:**`);
      for (const symbol of kindSymbols.slice(0, 3)) {
        parts.push(`- ${symbol.name} @ ${symbol.filePath}:${symbol.startLine}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(symbols: Symbol[], keywords: string[]): number {
    if (symbols.length === 0) return 0;

    // Higher confidence if more symbols found and more keywords matched
    const baseScore = Math.min(symbols.length / 5, 1);
    const keywordScore = keywords.length > 0 ? 0.5 : 0;

    return Math.min(baseScore + keywordScore, 1);
  }
}
