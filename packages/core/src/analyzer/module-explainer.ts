// ============================================================
// AI-powered module explanation generator
// ============================================================

import type { Symbol, Relationship } from '../graph/types.js';
import { ContextBuilder } from './context-builder.js';
import { createLLMClient, CachedLLMClient, type LLMClient } from './llm-client.js';

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'local';
  model?: string;
  apiKey?: string;
  baseUrl?: string;    // For local models (Ollama, etc.)
  maxTokens?: number;
}

export interface ExplainOptions {
  /** Include source code in the explanation context */
  includeSource?: boolean;
  /** Include relationship info */
  includeRelationships?: boolean;
  /** Language for the explanation (default: Chinese) */
  language?: string;
}

/**
 * Uses LLM to generate human-readable explanations for code modules.
 *
 * This is the "understanding" layer on top of the structural graph.
 * It can explain:
 * - Individual symbols (functions, classes)
 * - Entire files
 * - Groups of related symbols (modules)
 */
export class ModuleExplainer {
  private config: LLMConfig;
  private client: LLMClient | null = null;
  private contextBuilder: ContextBuilder | null = null;

  constructor(config: LLMConfig, store?: any) {
    this.config = config;
    this.initClient();
    if (store) {
      this.contextBuilder = new ContextBuilder(store);
    }
  }

  private initClient(): void {
    const baseClient = createLLMClient(this.config);
    if (baseClient) {
      this.client = new CachedLLMClient(baseClient);
    }
  }

  /**
   * Generate an explanation for a module (file or group of related symbols).
   */
  async explainModule(
    symbols: Symbol[],
    relationships: Relationship[],
    options: ExplainOptions = {},
  ): Promise<string> {
    if (!this.client) {
      return this.getFallbackMessage('module');
    }

    const context = this.buildContext(symbols, relationships, options);

    const prompt = `你是一个资深代码分析师。请分析以下代码模块，回答：

1. **核心职责**：这个模块做什么？（一句话概括）
2. **关键接口**：对外暴露了哪些重要的函数/类/方法？
3. **依赖关系**：它依赖了哪些其他模块？
4. **设计模式**：使用了什么设计模式或架构风格？
5. **潜在问题**：有没有明显的代码味道或改进空间？

请用简洁自然的语言回答，避免堆砌技术术语。

---

${context}`;

    try {
      return await this.client.complete(prompt);
    } catch (error) {
      console.error('LLM error:', error);
      return this.getFallbackMessage('module', error);
    }
  }

  /**
   * Generate an explanation for a single symbol.
   * Uses ai_summary when available (saves ~90% tokens).
   */
  async explainSymbol(symbol: Symbol): Promise<string> {
    if (!this.client) {
      return this.getFallbackMessage('symbol');
    }

    // If we have a store-backed context builder, use graph context
    if (this.contextBuilder) {
      const context = this.contextBuilder.buildExplainContext([symbol], {
        includeSource: !symbol.aiSummary, // Only include source if no AI summary
      });

      const userPrompt = `请用中文简洁解释这个${symbol.kind}的核心功能（1-3 句话）。\n\n${context.userContext}`;

      try {
        if (this.client.completeWithSystem) {
          return await this.client.completeWithSystem(context.systemPrompt, userPrompt);
        }
        return await this.client.complete(`${context.systemPrompt}\n\n${userPrompt}`);
      } catch (error) {
        console.error('LLM error:', error);
        return this.getFallbackMessage('symbol', error);
      }
    }

    // Fallback: use ai_summary if available, otherwise source code
    const codeSection = symbol.aiSummary
      ? `AI 摘要: ${symbol.aiSummary}`
      : `代码:\n\`\`\`\n${symbol.sourceCode ?? '(source not available)'}\n\`\`\``;

    const prompt = `请用中文简洁解释这段代码的作用：

类型: ${symbol.kind}
名称: ${symbol.name}
文件: ${symbol.filePath}
层级: ${symbol.layer}

${codeSection}

请用 1-3 句话解释这个${symbol.kind}的核心功能。`;

    try {
      return await this.client.complete(prompt);
    } catch (error) {
      console.error('LLM error:', error);
      return this.getFallbackMessage('symbol', error);
    }
  }

  /**
   * Semantic search: translate a natural language query to relevant symbols.
   * Optimized: uses FTS5 pre-filtering to reduce token usage by ~90%.
   */
  async semanticSearch(query: string, allSymbols: Symbol[]): Promise<Symbol[]> {
    if (!this.client) {
      console.warn('LLM not configured for semantic search');
      return [];
    }

    // Smart approach: pre-filter using FTS5 keyword search, then LLM ranks
    // Extract keywords from query (split on spaces, take meaningful words)
    const keywords = query.split(/\s+/).filter(w => w.length > 2);

    // Find candidates using name/docComment matching (cheap, local)
    const candidateSet = new Map<string, Symbol>();
    for (const symbol of allSymbols) {
      const nameMatch = keywords.some(kw => symbol.name.toLowerCase().includes(kw.toLowerCase()));
      const docMatch = symbol.docComment && keywords.some(kw => symbol.docComment!.toLowerCase().includes(kw.toLowerCase()));
      const summaryMatch = symbol.aiSummary && keywords.some(kw => symbol.aiSummary!.toLowerCase().includes(kw.toLowerCase()));

      if (nameMatch || docMatch || summaryMatch) {
        candidateSet.set(symbol.id, symbol);
      }
    }

    // If we found candidates, use those; otherwise fall back to all symbols
    const candidates = candidateSet.size > 0
      ? Array.from(candidateSet.values())
      : allSymbols;

    // Limit candidates to top 50 by relevance (name match > doc match > summary match)
    const scored = candidates.map(s => ({
      symbol: s,
      score: (keywords.some(kw => s.name.toLowerCase().includes(kw.toLowerCase())) ? 3 : 0) +
             (s.docComment && keywords.some(kw => s.docComment!.toLowerCase().includes(kw.toLowerCase())) ? 2 : 0) +
             (s.aiSummary && keywords.some(kw => s.aiSummary!.toLowerCase().includes(kw.toLowerCase())) ? 1 : 0),
    })).sort((a, b) => b.score - a.score).slice(0, 50);

    // Send only top candidates to LLM (not all symbols)
    const prompt = `用户想找到: "${query}"

以下是项目中可能相关的符号（已按相关性预筛选）：
${scored.map(({ symbol: s, score }) => `- ${s.name} (${s.kind}, ${s.layer}) @ ${s.filePath} [relevance: ${score}]`).join('\n')}

请从上面的列表中选出最相关的 5-10 个符号，只返回它们的名称，每行一个。`;

    try {
      const response = await this.client.complete(prompt);
      const relevantNames = response.split('\n').map(l => l.trim().replace(/^- /, '')).filter(Boolean);
      return scored.map(({ symbol: s }) => s).filter(s => relevantNames.includes(s.name));
    } catch (error) {
      console.error('LLM semantic search error:', error);
      return [];
    }
  }

  /** Build context string for LLM prompts */
  private buildContext(
    symbols: Symbol[],
    relationships: Relationship[],
    options: ExplainOptions,
  ): string {
    const parts: string[] = [];

    // Symbol overview
    parts.push('## 符号列表\n');
    for (const s of symbols) {
      parts.push(`- ${s.name} (${s.kind}, layer: ${s.layer}) [${s.filePath}:${s.startLine}-${s.endLine}]`);
      if (s.docComment) {
        parts.push(`  注释: ${s.docComment.slice(0, 200)}`);
      }
    }

    // Relationships
    if (options.includeRelationships !== false && relationships.length > 0) {
      parts.push('\n## 关系\n');
      for (const r of relationships) {
        parts.push(`- ${r.sourceId} --${r.kind}--> ${r.targetId}`);
      }
    }

    // Source code
    if (options.includeSource !== false) {
      parts.push('\n## 源代码\n');
      for (const s of symbols) {
        if (s.sourceCode) {
          parts.push(`### ${s.name}\n\`\`\`\n${s.sourceCode}\n\`\`\`\n`);
        }
      }
    }

    return parts.join('\n');
  }

  /** Get fallback message when LLM is not configured */
  private getFallbackMessage(type: 'module' | 'symbol', error?: any): string {
    const errorMsg = error ? ` Error: ${error.message}` : '';
    return `[AI ${type} explanation not available. Configure LLM provider in .codeatlas.yaml${errorMsg}]`;
  }
}
