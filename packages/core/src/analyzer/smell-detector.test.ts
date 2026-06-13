// ============================================================
// Smell Detector Unit Tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SmellDetector } from './smell-detector.js';
import path from 'path';
import fs from 'fs';

// Create a minimal mock store that satisfies SQLiteStore interface
function createMockStore() {
  const symbols: any[] = [];
  const relationships: any[] = [];

  return {
    searchSymbols: (_query: string, _opts?: any) => symbols,
    getCallers: (_id: string) => relationships.filter(r => r.targetId === _id),
    getCallees: (_id: string) => relationships.filter(r => r.sourceId === _id),
    getCallerCounts: (ids: string[]) => new Map<string, number>(),
    getCalleeCounts: (ids: string[]) => new Map<string, number>(),
    getSymbolsByFile: (_path: string) => symbols.filter(s => s.filePath === _path),
    _addSymbol: (s: any) => symbols.push(s),
    _addRelationship: (r: any) => relationships.push(r),
  } as any;
}

describe('SmellDetector dead-code detection', () => {
  it('should NOT flag exported API-style symbols (isApiPattern)', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:createStore:1', name: 'createStore', kind: 'function',
      filePath: 'src/index.ts', startLine: 1, endLine: 10,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: 'export function createStore() {}',
    });
    store._addSymbol({
      id: 'test:main:2', name: 'main', kind: 'function',
      filePath: 'src/main.ts', startLine: 1, endLine: 10,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: 'export function main() {}',
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('dead-code');
    const flagged = smells.filter(s => s.type === 'dead-code');
    expect(flagged.length).toBe(0);
  });

  it('should flag non-exported symbols with 0 callers as dead-code warning', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:privateHelper:1', name: 'privateHelper', kind: 'function',
      filePath: 'src/util.ts', startLine: 1, endLine: 5,
      language: 'typescript', layer: 'utility', exported: false,
      sourceCode: 'function privateHelper() { return 42; }',
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('dead-code');
    const flagged = smells.filter(s => s.type === 'dead-code');
    expect(flagged.length).toBe(1);
    expect(flagged[0].severity).toBe('warning');
    expect(flagged[0].symbols[0].name).toBe('privateHelper');
  });

  it('should flag exported symbols with 0 callers as dead-code info if not API pattern', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:oldUtil:1', name: 'oldUtil', kind: 'function',
      filePath: 'src/legacy.ts', startLine: 1, endLine: 5,
      language: 'typescript', layer: 'utility', exported: true,
      sourceCode: 'export function oldUtil() { return null; }',
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('dead-code');
    const flagged = smells.filter(s => s.type === 'dead-code');
    expect(flagged.length).toBe(1);
    expect(flagged[0].severity).toBe('info');
  });

  it('should not flag symbols with callers', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'src:calledFn:1', name: 'calledFn', kind: 'function',
      filePath: 'src/util.ts', startLine: 1, endLine: 5,
      language: 'typescript', layer: 'utility', exported: false,
      sourceCode: 'function calledFn() {}',
    });
    store._addSymbol({
      id: 'src:caller:2', name: 'caller', kind: 'function',
      filePath: 'src/main.ts', startLine: 1, endLine: 5,
      language: 'typescript', layer: 'business', exported: false,
      sourceCode: 'function caller() { calledFn(); }',
    });
    store._addRelationship({
      id: 'rel-1', sourceId: 'src:caller:2', targetId: 'src:calledFn:1', kind: 'calls',
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('dead-code');
    const flagged = smells.filter(s => s.type === 'dead-code');
    // calledFn has a caller, should NOT be flagged
    expect(flagged.find(s => s.symbols[0].name === 'calledFn')).toBeUndefined();
  });
});

describe('SmellDetector long-function detection', () => {
  it('should flag function > 100 lines as warning', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:longFn:1', name: 'longFn', kind: 'function',
      filePath: 'src/long.ts', startLine: 1, endLine: 105,
      language: 'typescript', layer: 'business', exported: false,
      sourceCode: Array(106).fill('// line').join('\n'),
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('long-function');
    expect(smells.length).toBe(1);
    expect(smells[0].severity).toBe('warning');
  });

  it('should flag function > 200 lines as error', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:veryLongFn:1', name: 'veryLongFn', kind: 'function',
      filePath: 'src/verylong.ts', startLine: 1, endLine: 250,
      language: 'typescript', layer: 'business', exported: false,
      sourceCode: Array(251).fill('// line').join('\n'),
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('long-function');
    expect(smells.length).toBe(1);
    expect(smells[0].severity).toBe('error');
  });

  it('should not flag short functions < 100 lines', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:shortFn:1', name: 'shortFn', kind: 'function',
      filePath: 'src/short.ts', startLine: 1, endLine: 10,
      language: 'typescript', layer: 'business', exported: false,
      sourceCode: Array(11).fill('// line').join('\n'),
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('long-function');
    expect(smells.length).toBe(0);
  });

  it('should flag class > 300 lines as warning, > 500 as error', () => {
    const store = createMockStore();
    store._addSymbol({
      id: 'test:MediumClass:1', name: 'MediumClass', kind: 'class',
      filePath: 'src/medium.ts', startLine: 1, endLine: 400,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: Array(401).fill('// line').join('\n'),
    });
    store._addSymbol({
      id: 'test:HugeClass:2', name: 'HugeClass', kind: 'class',
      filePath: 'src/huge.ts', startLine: 1, endLine: 600,
      language: 'typescript', layer: 'business', exported: true,
      sourceCode: Array(601).fill('// line').join('\n'),
    });

    const detector = new SmellDetector(store);
    const smells = detector.detectType('long-function');
    expect(smells.length).toBe(2);
    expect(smells.find(s => s.symbols[0].name === 'MediumClass')?.severity).toBe('warning');
    expect(smells.find(s => s.symbols[0].name === 'HugeClass')?.severity).toBe('error');
  });
});
