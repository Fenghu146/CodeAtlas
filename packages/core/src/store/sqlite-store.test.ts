// ============================================================
// SQLite Store Unit Tests
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SQLiteStore } from './sqlite-store.js';
import type { Symbol, Relationship, Layer } from '../graph/types.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), '.codeatlas', 'test-store.sqlite');

describe('SQLiteStore', () => {
  let store: SQLiteStore;

  beforeAll(async () => {
    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store = new SQLiteStore({ dbPath: TEST_DB_PATH });
  });

  afterAll(() => {
    store.close();
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(() => {
    store.clear();
  });

  describe('Symbol Operations', () => {
    const testSymbol: Symbol = {
      id: 'test.ts:hello:1',
      name: 'hello',
      kind: 'function',
      filePath: 'test.ts',
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      layer: 'utility',
      exported: true,
      sourceCode: 'function hello() { return "world"; }',
    };

    it('should upsert and get a symbol', () => {
      store.upsertSymbol(testSymbol);
      const retrieved = store.getSymbol(testSymbol.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('hello');
      expect(retrieved?.kind).toBe('function');
      expect(retrieved?.layer).toBe('utility');
    });

    it('should update existing symbol', () => {
      store.upsertSymbol(testSymbol);

      const updatedSymbol = { ...testSymbol, layer: 'business' as Layer };
      store.upsertSymbol(updatedSymbol);

      const retrieved = store.getSymbol(testSymbol.id);
      expect(retrieved?.layer).toBe('business');
    });

    it('should search symbols by name', () => {
      store.upsertSymbol(testSymbol);
      store.upsertSymbol({ ...testSymbol, id: 'test.ts:world:10', name: 'world' });

      const results = store.searchSymbols('hello');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('hello');
    });

    it('should filter search by kind', () => {
      store.upsertSymbol(testSymbol);
      store.upsertSymbol({
        ...testSymbol,
        id: 'test.ts:UserService:20',
        name: 'UserService',
        kind: 'class',
      });

      const functions = store.searchSymbols('hello', { kind: 'function' });
      const classes = store.searchSymbols('hello', { kind: 'class' });

      expect(functions).toHaveLength(1);
      expect(classes).toHaveLength(0);
    });

    it('should filter search by layer', () => {
      store.upsertSymbol(testSymbol);
      store.upsertSymbol({
        ...testSymbol,
        id: 'test.ts:ApiHandler:30',
        name: 'ApiHandler',
        layer: 'interface',
      });

      const utilitySymbols = store.searchSymbols('hello', { layer: 'utility' });
      const interfaceSymbols = store.searchSymbols('hello', { layer: 'interface' });

      expect(utilitySymbols).toHaveLength(1);
      expect(interfaceSymbols).toHaveLength(0);
    });

    it('should get symbols by file', () => {
      store.upsertSymbol(testSymbol);
      store.upsertSymbol({ ...testSymbol, id: 'test.ts:world:10', name: 'world' });
      store.upsertSymbol({ ...testSymbol, id: 'other.ts:foo:1', filePath: 'other.ts', name: 'foo' });

      const fileSymbols = store.getSymbolsByFile('test.ts');
      expect(fileSymbols).toHaveLength(2);
    });

    it('should delete symbols by file', () => {
      store.upsertSymbol(testSymbol);
      store.upsertSymbol({ ...testSymbol, id: 'test.ts:world:10', name: 'world' });

      const deleted = store.deleteSymbolsByFile('test.ts');
      expect(deleted).toBe(2);

      const remaining = store.getSymbolsByFile('test.ts');
      expect(remaining).toHaveLength(0);
    });
  });

  describe('Relationship Operations', () => {
    const symbolA: Symbol = {
      id: 'test.ts:a:1',
      name: 'a',
      kind: 'function',
      filePath: 'test.ts',
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      layer: 'business',
      exported: false,
    };

    const symbolB: Symbol = {
      id: 'test.ts:b:10',
      name: 'b',
      kind: 'function',
      filePath: 'test.ts',
      startLine: 10,
      endLine: 15,
      language: 'typescript',
      layer: 'utility',
      exported: false,
    };

    beforeEach(() => {
      store.upsertSymbol(symbolA);
      store.upsertSymbol(symbolB);
    });

    it('should insert and query relationship', () => {
      const rel: Relationship = {
        id: 'a->calls->b',
        sourceId: symbolA.id,
        targetId: symbolB.id,
        kind: 'calls',
        line: 12,
      };

      store.insertRelationship(rel);

      const callees = store.getCallees(symbolA.id);
      expect(callees).toHaveLength(1);
      expect(callees[0].id).toBe(symbolB.id);
    });

    it('should get callers', () => {
      const rel: Relationship = {
        id: 'a->calls->b',
        sourceId: symbolA.id,
        targetId: symbolB.id,
        kind: 'calls',
        line: 12,
      };

      store.insertRelationship(rel);

      const callers = store.getCallers(symbolB.id);
      expect(callers).toHaveLength(1);
      expect(callers[0].id).toBe(symbolA.id);
    });

    it('should not duplicate relationships', () => {
      const rel: Relationship = {
        id: 'a->calls->b',
        sourceId: symbolA.id,
        targetId: symbolB.id,
        kind: 'calls',
        line: 12,
      };

      store.insertRelationship(rel);
      store.insertRelationship(rel); // Duplicate

      const callees = store.getCallees(symbolA.id);
      expect(callees).toHaveLength(1);
    });
  });

  describe('Impact Analysis', () => {
    it('should find transitive dependents', () => {
      // Create chain: A -> B -> C
      const symbols = [
        { id: 'a:1', name: 'a', kind: 'function' as const, filePath: 'test.ts', startLine: 1, endLine: 5, language: 'typescript', layer: 'data' as const, exported: false },
        { id: 'b:10', name: 'b', kind: 'function' as const, filePath: 'test.ts', startLine: 10, endLine: 15, language: 'typescript', layer: 'business' as const, exported: false },
        { id: 'c:20', name: 'c', kind: 'function' as const, filePath: 'test.ts', startLine: 20, endLine: 25, language: 'typescript', layer: 'interface' as const, exported: false },
      ];

      symbols.forEach(s => store.upsertSymbol(s));

      store.insertRelationship({ id: 'a->b', sourceId: 'b:10', targetId: 'a:1', kind: 'calls' });
      store.insertRelationship({ id: 'b->c', sourceId: 'c:20', targetId: 'b:10', kind: 'calls' });

      const impact = store.getImpact('a:1', 3);
      expect(impact).toHaveLength(2);
      expect(impact.map(i => i.symbol.id)).toContain('b:10');
      expect(impact.map(i => i.symbol.id)).toContain('c:20');
    });
  });

  describe('File Operations', () => {
    it('should upsert and get file', () => {
      const file = {
        path: 'test.ts',
        language: 'typescript',
        size: 1024,
        lineCount: 50,
        hash: 'abc123',
        parsedAt: new Date().toISOString(),
      };

      store.upsertFile(file);

      const retrieved = store.getFile('test.ts');
      expect(retrieved).toBeDefined();
      expect(retrieved?.language).toBe('typescript');
    });

    it('should get file hash', () => {
      const file = {
        path: 'test.ts',
        language: 'typescript',
        size: 1024,
        lineCount: 50,
        hash: 'abc123',
        parsedAt: new Date().toISOString(),
      };

      store.upsertFile(file);

      const hash = store.getFileHash('test.ts');
      expect(hash).toBe('abc123');
    });
  });

  describe('Stats', () => {
    it('should return correct statistics', () => {
      store.upsertSymbol({
        id: 'a:1', name: 'a', kind: 'function', filePath: 'test.ts',
        startLine: 1, endLine: 5, language: 'typescript', layer: 'business', exported: false,
      });
      store.upsertSymbol({
        id: 'b:10', name: 'b', kind: 'class', filePath: 'test.ts',
        startLine: 10, endLine: 20, language: 'typescript', layer: 'data', exported: true,
      });

      store.upsertFile({
        path: 'test.ts', language: 'typescript', size: 1024,
        lineCount: 50, hash: 'abc123',
      });

      const stats = store.getStats();
      expect(stats.symbols).toBe(2);
      expect(stats.files).toBe(1);
    });
  });
});
