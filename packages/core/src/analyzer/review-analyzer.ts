// ============================================================
// Review Analyzer - AI-powered code review
// ============================================================
// Extracts change subgraph from git diff, analyzes impact,
// and generates review comments using LLM.

import { SQLiteStore } from '../store/sqlite-store.js';
import { ImpactAnalyzer } from './impact-analyzer.js';
import { ContextBuilder, type StaticFinding } from './context-builder.js';
import { createLLMClient, CachedLLMClient } from './llm-client.js';
import type { Symbol } from '../graph/types.js';
import type { LLMClient } from './llm-client.js';

export interface ReviewOptions {
  /** Focus dimensions: security, perf, correctness, readability */
  focus?: string[];
  /** Max impact depth for subgraph extraction */
  depth?: number;
  /** Use graph-aware context instead of raw source code (default: true) */
  smart?: boolean;
  /** Token budget for smart mode (default: 4000) */
  tokenBudget?: number;
  /** LLM provider config */
  llmProvider?: 'claude' | 'openai' | 'local';
  llmModel?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
}

export interface ReviewFinding {
  /** Severity: error, warning, info */
  severity: 'error' | 'warning' | 'info';
  /** Category: security, perf, correctness, readability */
  category: string;
  /** Symbol ID where the issue was found */
  symbolId: string;
  /** Symbol name */
  symbolName: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Description of the issue */
  description: string;
  /** Suggested fix */
  suggestion?: string;
}

export interface ReviewResult {
  /** All findings */
  findings: ReviewFinding[];
  /** Summary text */
  summary: string;
  /** Symbols reviewed */
  reviewedCount: number;
  /** Impact subgraph size */
  impactSize: number;
}

/**
 * Analyzes code changes and generates review findings.
 * Uses the code graph to understand context and impact,
 * and optionally LLM for deeper analysis.
 */
export class ReviewAnalyzer {
  private store: SQLiteStore;
  private impactAnalyzer: ImpactAnalyzer;
  private contextBuilder: ContextBuilder;
  private llmClient: LLMClient | null;

  constructor(store: SQLiteStore, options?: ReviewOptions) {
    this.store = store;
    this.impactAnalyzer = new ImpactAnalyzer(store);
    this.contextBuilder = new ContextBuilder(store);

    if (options?.llmProvider) {
      const client = createLLMClient({
        provider: options.llmProvider,
        model: options.llmModel,
        apiKey: options.llmApiKey,
        baseUrl: options.llmBaseUrl,
      });
      this.llmClient = client ? new CachedLLMClient(client) : null;
    } else {
      this.llmClient = null;
    }
  }

  /**
   * Review a set of changed files/symbols.
   *
   * @param changedFiles - Files that have been modified
   * @param options - Review options
   */
  async review(changedFiles: string[], options?: ReviewOptions): Promise<ReviewResult> {
    const findings: ReviewFinding[] = [];
    const focus = options?.focus || ['correctness', 'security', 'perf', 'readability'];
    const depth = options?.depth || 2;
    const smart = options?.smart !== false; // default: true

    // Collect all symbols from changed files
    const changedSymbols: Symbol[] = [];
    for (const file of changedFiles) {
      const symbols = this.store.getSymbolsByFile(file);
      changedSymbols.push(...symbols);
    }

    // Extract impact subgraph
    const impactedSymbols = new Map<string, { symbol: Symbol; depth: number }>();
    for (const symbol of changedSymbols) {
      const impact = this.impactAnalyzer.analyze(symbol.id, depth);
      if (impact) {
        for (const affected of impact.direct) {
          if (!impactedSymbols.has(affected.symbol.id)) {
            impactedSymbols.set(affected.symbol.id, { symbol: affected.symbol, depth: affected.depth });
          }
        }
        for (const affected of impact.indirect) {
          if (!impactedSymbols.has(affected.symbol.id)) {
            impactedSymbols.set(affected.symbol.id, { symbol: affected.symbol, depth: affected.depth });
          }
        }
      }
    }

    // Run static analysis FIRST — these are cheap and deterministic
    const staticFindings: StaticFinding[] = [];
    for (const symbol of changedSymbols) {
      if (focus.includes('correctness')) {
        const f = this.checkCorrectness(symbol);
        findings.push(...f);
        staticFindings.push(...f.map(ff => ({ severity: ff.severity, category: ff.category, symbolName: ff.symbolName, description: ff.description })));
      }
      if (focus.includes('security')) {
        const f = this.checkSecurity(symbol);
        findings.push(...f);
        staticFindings.push(...f.map(ff => ({ severity: ff.severity, category: ff.category, symbolName: ff.symbolName, description: ff.description })));
      }
      if (focus.includes('perf')) {
        const f = this.checkPerformance(symbol);
        findings.push(...f);
        staticFindings.push(...f.map(ff => ({ severity: ff.severity, category: ff.category, symbolName: ff.symbolName, description: ff.description })));
      }
      if (focus.includes('readability')) {
        const f = this.checkReadability(symbol);
        findings.push(...f);
        staticFindings.push(...f.map(ff => ({ severity: ff.severity, category: ff.category, symbolName: ff.symbolName, description: ff.description })));
      }
    }

    // AI-powered review (if LLM is available)
    if (this.llmClient && changedSymbols.length > 0) {
      const aiFindings = await this.aiReview(changedSymbols, focus, {
        smart,
        tokenBudget: options?.tokenBudget,
        staticFindings,
      });
      findings.push(...aiFindings);
    }

    const summary = this.buildSummary(findings, changedSymbols.length, impactedSymbols.size, smart, options?.tokenBudget);

    return {
      findings,
      summary,
      reviewedCount: changedSymbols.length,
      impactSize: impactedSymbols.size,
    };
  }

  /**
   * Review a single symbol by ID.
   */
  async reviewSymbol(symbolId: string, options?: ReviewOptions): Promise<ReviewResult> {
    const symbol = this.store.getSymbol(symbolId);
    if (!symbol) {
      return {
        findings: [],
        summary: `Symbol "${symbolId}" not found.`,
        reviewedCount: 0,
        impactSize: 0,
      };
    }
    return this.review([symbol.filePath], options);
  }

  // ========================
  // Static Analysis Checks
  // ========================

  private checkCorrectness(symbol: Symbol): ReviewFinding[] {
    const findings: ReviewFinding[] = [];

    if (!symbol.sourceCode) return findings;

    // Check for TODO/FIXME/HACK
    const todoRegex = /(TODO|FIXME|HACK|XXX|WORKAROUND)\s*[:\-]?\s*(.*)/gi;
    let match;
    while ((match = todoRegex.exec(symbol.sourceCode)) !== null) {
      findings.push({
        severity: 'info',
        category: 'correctness',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: `Unresolved ${match[1]}: ${match[2].trim()}`,
      });
    }

    // Check for empty catch blocks
    if (symbol.sourceCode.match(/catch\s*\([^)]*\)\s*\{\s*\}/)) {
      findings.push({
        severity: 'warning',
        category: 'correctness',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: 'Empty catch block — errors are silently swallowed',
        suggestion: 'Add error logging or re-throw the error',
      });
    }

    // Check for deep nesting
    const lines = symbol.sourceCode.split('\n');
    let maxDepth = 0;
    let maxDepthLine = symbol.startLine;
    for (let i = 0; i < lines.length; i++) {
      const depth = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      if (depth > maxDepth) {
        maxDepth = depth;
        maxDepthLine = symbol.startLine + i;
      }
    }
    if (maxDepth > 4) {
      findings.push({
        severity: 'warning',
        category: 'correctness',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: maxDepthLine,
        description: `Deep nesting detected (depth: ${maxDepth}) — consider extracting functions`,
      });
    }

    return findings;
  }

  private checkSecurity(symbol: Symbol): ReviewFinding[] {
    const findings: ReviewFinding[] = [];

    if (!symbol.sourceCode) return findings;

    // Check for eval()
    if (symbol.sourceCode.match(/\beval\s*\(/)) {
      findings.push({
        severity: 'error',
        category: 'security',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: 'Use of eval() detected — potential code injection risk',
        suggestion: 'Replace eval() with a safe alternative',
      });
    }

    // Check for innerHTML
    if (symbol.sourceCode.match(/\.innerHTML\s*=/)) {
      findings.push({
        severity: 'warning',
        category: 'security',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: 'Direct innerHTML assignment — potential XSS risk',
        suggestion: 'Use textContent or a sanitization library',
      });
    }

    // Check for hardcoded secrets
    const secretPatterns = [
      /(?:password|passwd|secret|api_?key|token|auth)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    ];
    for (const pattern of secretPatterns) {
      if (pattern.test(symbol.sourceCode)) {
        findings.push({
          severity: 'error',
          category: 'security',
          symbolId: symbol.id,
          symbolName: symbol.name,
          file: symbol.filePath,
          line: symbol.startLine,
          description: 'Potential hardcoded secret detected',
          suggestion: 'Move secrets to environment variables',
        });
      }
    }

    return findings;
  }

  private checkPerformance(symbol: Symbol): ReviewFinding[] {
    const findings: ReviewFinding[] = [];

    if (!symbol.sourceCode) return findings;

    // Check for synchronous file operations (Node.js)
    if (symbol.sourceCode.match(/\bfs\.(readFileSync|writeFileSync|existsSync)\s*\(/)) {
      findings.push({
        severity: 'warning',
        category: 'perf',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: 'Synchronous file I/O detected — may block the event loop',
        suggestion: 'Use async alternatives (fs.promises or fs.readFile with callback)',
      });
    }

    // Check for nested loops
    const forLoopRegex = /for\s*\([^)]*\)\s*\{[^}]*for\s*\(/g;
    if (forLoopRegex.test(symbol.sourceCode)) {
      findings.push({
        severity: 'warning',
        category: 'perf',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: 'Nested loops detected — potential O(n²) complexity',
      });
    }

    // Check for large function body
    if (symbol.sourceCode) {
      const lineCount = symbol.sourceCode.split('\n').length;
      if (lineCount > 100) {
        findings.push({
          severity: 'info',
          category: 'perf',
          symbolId: symbol.id,
          symbolName: symbol.name,
          file: symbol.filePath,
          line: symbol.startLine,
          description: `Large function (${lineCount} lines) — consider breaking it up`,
        });
      }
    }

    return findings;
  }

  private checkReadability(symbol: Symbol): ReviewFinding[] {
    const findings: ReviewFinding[] = [];

    if (!symbol.sourceCode) return findings;

    // Check for magic numbers
    const magicNumberRegex = /(?<!=\s*)(?<![\w.])\b(?!0\b|1\b|2\b|100\b)\d{3,}\b(?!\.\d)/g;
    let match;
    while ((match = magicNumberRegex.exec(symbol.sourceCode)) !== null) {
      // Skip common acceptable numbers
      const num = parseInt(match[0]);
      if ([1000, 1024, 60, 24, 365, 10000].includes(num)) continue;

      findings.push({
        severity: 'info',
        category: 'readability',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: `Magic number ${match[0]} — consider extracting to a named constant`,
      });
    }

    // Check for excessively long parameter lists
    const longParamRegex = /function\s+\w+\s*\(([^)]{100,})\)/;
    if (longParamRegex.test(symbol.sourceCode)) {
      findings.push({
        severity: 'info',
        category: 'readability',
        symbolId: symbol.id,
        symbolName: symbol.name,
        file: symbol.filePath,
        line: symbol.startLine,
        description: 'Long parameter list — consider using an options object',
      });
    }

    return findings;
  }

  // ========================
  // AI-Powered Review
  // ========================

  private async aiReview(
    symbols: Symbol[],
    focus: string[],
    options: {
      smart: boolean;
      tokenBudget?: number;
      staticFindings: StaticFinding[];
    },
  ): Promise<ReviewFinding[]> {
    if (!this.llmClient) return [];

    const findings: ReviewFinding[] = [];

    if (options.smart) {
      // Smart mode: use ContextBuilder for graph-aware context
      const context = this.contextBuilder.buildReviewContext(symbols, {
        maxTokens: options.tokenBudget ?? 4000,
        includeSource: 'signature',
        includeCallers: true,
        includeCallees: true,
        includeStaticFindings: true,
      }, options.staticFindings);

      const userPrompt = `## Changed Symbols (graph context)\n\n${context.codeContext}\n\n${context.staticFindings ? `\n${context.staticFindings}\n` : ''}\nReview for issues NOT covered by static analysis. Focus: ${focus.join(', ')}`;

      try {
        let response: string;
        if (this.llmClient.completeWithSystem) {
          response = await this.llmClient.completeWithSystem(context.systemPrompt, userPrompt);
        } else {
          response = await this.llmClient.complete(`${context.systemPrompt}\n\n${userPrompt}`);
        }
        const parsed = this.parseAIResponse(response, symbols);
        findings.push(...parsed);
      } catch (err) {
        console.error('Smart AI review failed:', err);
      }
    } else {
      // Traditional mode: send full source code
      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);

        const codeContext = batch.map(s =>
          `### ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}\n\`\`\`\n${s.sourceCode || '(no source)'}\n\`\`\``
        ).join('\n\n');

        const prompt = `You are a senior code reviewer. Analyze the following code changes and identify issues.

Focus areas: ${focus.join(', ')}

For each issue found, respond in this exact JSON format (one array):
[
  {
    "severity": "error|warning|info",
    "category": "security|perf|correctness|readability",
    "symbolName": "function/class name",
    "line": line_number,
    "description": "clear description of the issue",
    "suggestion": "optional fix suggestion"
  }
]

If no issues found, respond with an empty array: []

Code to review:
${codeContext}`;

        try {
          const response = await this.llmClient.complete(prompt);
          const parsed = this.parseAIResponse(response, batch);
          findings.push(...parsed);
        } catch (err) {
          console.error(`AI review failed for batch ${i}:`, err);
        }
      }
    }

    return findings;
  }

  private parseAIResponse(response: string, symbols: Symbol[]): ReviewFinding[] {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const items = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(items)) return [];

      return items.map((item: any) => {
        // Find the matching symbol
        const symbol = symbols.find(s => s.name === item.symbolName) || symbols[0];

        return {
          severity: item.severity || 'info',
          category: item.category || 'correctness',
          symbolId: symbol?.id || '',
          symbolName: item.symbolName || symbol?.name || 'unknown',
          file: symbol?.filePath || '',
          line: item.line || symbol?.startLine || 0,
          description: item.description || '',
          suggestion: item.suggestion,
        };
      });
    } catch {
      return [];
    }
  }

  private buildSummary(findings: ReviewFinding[], reviewedCount: number, impactSize: number, smart: boolean, tokenBudget?: number): string {
    const parts: string[] = [];

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');
    const infos = findings.filter(f => f.severity === 'info');

    parts.push(`🔍 Code Review Summary`);
    parts.push('═'.repeat(40));
    parts.push(`Reviewed: ${reviewedCount} symbols | Impact scope: ${impactSize} symbols`);
    parts.push(`Mode: ${smart ? '🧠 Smart (graph context)' : '📝 Traditional (full source)'}`);
    if (smart) {
      parts.push(`Token budget: ${tokenBudget ?? 4000} tokens`);
    }
    parts.push(`Findings: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} info`);

    if (errors.length > 0) {
      parts.push(`\n❌ Errors:`);
      for (const f of errors) {
        parts.push(`  [${f.category}] ${f.symbolName}: ${f.description}`);
        if (f.suggestion) parts.push(`    💡 ${f.suggestion}`);
      }
    }

    if (warnings.length > 0) {
      parts.push(`\n⚠️  Warnings:`);
      for (const f of warnings) {
        parts.push(`  [${f.category}] ${f.symbolName}: ${f.description}`);
        if (f.suggestion) parts.push(`    💡 ${f.suggestion}`);
      }
    }

    if (infos.length > 0) {
      parts.push(`\nℹ️  Info:`);
      for (const f of infos.slice(0, 10)) {
        parts.push(`  [${f.category}] ${f.symbolName}: ${f.description}`);
      }
      if (infos.length > 10) {
        parts.push(`  ... and ${infos.length - 10} more`);
      }
    }

    if (findings.length === 0) {
      parts.push('\n✅ No issues found — code looks good!');
    }

    return parts.join('\n');
  }
}
