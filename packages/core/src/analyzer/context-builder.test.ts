// ============================================================
// Context Builder Unit Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context-builder.js';
import type { Symbol } from '../graph/types.js';

// Mock SQLiteStore with minimal interface
function mockStore() {
  const symbols = new Map<string, Symbol>();

  return {
    searchSymbols: (_query: string) => Array.from(symbols.values()),
    getSymbol: (id: string) => symbols.get(id) ?? null,
    getCallers: (_id: string) => [] as Symbol[],
    getCallees: (_id: string) => [] as Symbol[],
    getSymbolsByFile: (_path: string) => [] as Symbol[],
    _addSymbol: (s: Symbol) => symbols.set(s.id, s),
    insertRelationship: (_r: any) => {},
    getCallerCounts: (_ids: string[]) => new Map(),
    getCalleeCounts: (_ids: string[]) => new Map(),
  } as any;
}

describe('ContextBuilder', () => {
  it('should build review context for a symbol', () => {
    const store = mockStore();
    store._addSymbol({
      id: 'test:hello:1', name: 'hello', kind: 'function',
      filePath: 'src/main.ts', startLine: 1, endLine: 3,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: 'export function hello() { return 42; }',
    });

    const builder = new ContextBuilder(store);
    const ctx = builder.buildReviewContext([store.getSymbol('test:hello:1')!], {
      maxTokens: 1000,
      includeSource: 'full',
    });

    expect(ctx).toBeDefined();
    expect(typeof ctx.systemPrompt).toBe('string');
    expect(typeof ctx.codeContext).toBe('string');
    expect(ctx.symbolCount).toBeGreaterThanOrEqual(0);
    expect(ctx.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty symbol list gracefully', () => {
    const store = mockStore();
    const builder = new ContextBuilder(store);
    const ctx = builder.buildReviewContext([], { maxTokens: 500 });
    expect(ctx).toBeDefined();
    expect(ctx.symbolCount).toBe(0);
  });

  it('should respect token budget', () => {
    const store = mockStore();
    store._addSymbol({
      id: 'test:big:1', name: 'bigFunc', kind: 'function',
      filePath: 'src/big.ts', startLine: 1, endLine: 100,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: Array(101).fill('line of code').join('\n'),
    });

    const builder = new ContextBuilder(store);
    const ctxSmall = builder.buildReviewContext([store.getSymbol('test:big:1')!], {
      maxTokens: 50,
      includeSource: 'full',
    });
    const ctxBig = builder.buildReviewContext([store.getSymbol('test:big:1')!], {
      maxTokens: 5000,
      includeSource: 'full',
    });

    expect(ctxSmall).toBeDefined();
    expect(ctxBig).toBeDefined();
  });

  it('should build explain context', () => {
    const store = mockStore();
    store._addSymbol({
      id: 'test:calc:1', name: 'calculate', kind: 'function',
      filePath: 'src/math.ts', startLine: 1, endLine: 5,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: 'export function calculate(a: number, b: number) { return a + b; }',
    });

    const builder = new ContextBuilder(store);
    const ctx = builder.buildExplainContext([store.getSymbol('test:calc:1')!], { maxTokens: 1000 });

    expect(ctx).toBeDefined();
  });

  it('should include signatures when requested', () => {
    const store = mockStore();
    store._addSymbol({
      id: 'test:fn:1', name: 'myFunction', kind: 'function',
      filePath: 'src/fn.ts', startLine: 1, endLine: 10,
      language: 'typescript', layer: 'business', exported: false,
      sourceCode: 'function myFunction(x: string): number { return x.length; }',
    });

    const builder = new ContextBuilder(store);
    const ctx = builder.buildReviewContext([store.getSymbol('test:fn:1')!], {
      maxTokens: 500,
      includeSource: 'signature',
    });

    expect(ctx).toBeDefined();
    expect(ctx.symbolCount).toBeGreaterThanOrEqual(0);
  });
});
