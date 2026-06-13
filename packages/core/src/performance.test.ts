// ============================================================
// Performance Benchmarks
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CodeParser } from './parser/index.js';
import { SQLiteStore } from './store/sqlite-store.js';
import fs from 'fs';
import path from 'path';

const PERF_DB_PATH = path.join(process.cwd(), '.codeatlas', 'test-perf.sqlite');

describe('Performance Benchmarks', () => {
  let parser: CodeParser;
  let store: SQLiteStore;

  beforeAll(async () => {
    parser = new CodeParser();
    await parser.init();
    await parser.loadLanguage('typescript');

    // Ensure test directory exists
    const dir = path.dirname(PERF_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store = new SQLiteStore({ dbPath: PERF_DB_PATH });
  });

  afterAll(() => {
    store.close();
    if (fs.existsSync(PERF_DB_PATH)) {
      fs.unlinkSync(PERF_DB_PATH);
    }
  });

  describe('Parser Performance', () => {
    it('should parse small file in < 100ms', () => {
      const code = `
        function hello() {
          return 'world';
        }
      `;

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        parser.parse(code, 'test.ts');
      }
      const end = performance.now();
      const avg = (end - start) / 100;

      console.log(`Parser (small file): ${avg.toFixed(2)}ms avg`);
      expect(avg).toBeLessThan(100);
    });

    it('should parse medium file in < 500ms', () => {
      // Generate a medium-sized file
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`function func${i}() { return ${i}; }`);
      }
      const code = lines.join('\n');

      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        parser.parse(code, 'test.ts');
      }
      const end = performance.now();
      const avg = (end - start) / 10;

      console.log(`Parser (medium file, 100 funcs): ${avg.toFixed(2)}ms avg`);
      expect(avg).toBeLessThan(500);
    });

    it('should parse large file in < 2000ms', () => {
      // Generate a large file
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`function func${i}(x: number): number { return x * ${i}; }`);
      }
      const code = lines.join('\n');

      const start = performance.now();
      parser.parse(code, 'test.ts');
      const end = performance.now();
      const duration = end - start;

      console.log(`Parser (large file, 1000 funcs): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Store Performance', () => {
    beforeEach(() => {
      store.clear();
    });

    it('should insert 1000 symbols in < 1000ms', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        store.upsertSymbol({
          id: `test.ts:func${i}:${i * 10}`,
          name: `func${i}`,
          kind: 'function',
          filePath: 'test.ts',
          startLine: i * 10,
          endLine: i * 10 + 5,
          language: 'typescript',
          layer: 'business',
          exported: i % 2 === 0,
        });
      }

      const end = performance.now();
      const duration = end - start;

      console.log(`Store insert (1000 symbols): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000);
    });

    it('should search 1000 symbols in < 100ms', () => {
      // Setup data
      for (let i = 0; i < 1000; i++) {
        store.upsertSymbol({
          id: `search.ts:func${i}:${i * 10}`,
          name: `func${i}`,
          kind: 'function',
          filePath: 'search.ts',
          startLine: i * 10,
          endLine: i * 10 + 5,
          language: 'typescript',
          layer: 'business',
          exported: false,
        });
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        store.searchSymbols('func500');
      }
      const end = performance.now();
      const avg = (end - start) / 100;

      console.log(`Store search (100 queries): ${avg.toFixed(2)}ms avg`);
      expect(avg).toBeLessThan(100);
    });

    it('should get symbol by ID in < 10ms', () => {
      // Setup data
      for (let i = 0; i < 1000; i++) {
        store.upsertSymbol({
          id: `id.ts:func${i}:${i * 10}`,
          name: `func${i}`,
          kind: 'function',
          filePath: 'id.ts',
          startLine: i * 10,
          endLine: i * 10 + 5,
          language: 'typescript',
          layer: 'business',
          exported: false,
        });
      }

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        store.getSymbol(`id.ts:func${i}:${i * 10}`);
      }
      const end = performance.now();
      const avg = (end - start) / 1000;

      console.log(`Store getSymbol (1000 lookups): ${avg.toFixed(3)}ms avg`);
      expect(avg).toBeLessThan(10);
    });

    it('should handle large database (10k symbols)', () => {
      const startTime = performance.now();

      // Insert 10k symbols
      for (let i = 0; i < 10000; i++) {
        store.upsertSymbol({
          id: `large.ts:func${i}:${i * 5}`,
          name: `func${i}`,
          kind: 'function',
          filePath: `large.ts`,
          startLine: i * 5,
          endLine: i * 5 + 3,
          language: 'typescript',
          layer: i % 4 === 0 ? 'interface' : i % 4 === 1 ? 'business' : i % 4 === 2 ? 'data' : 'utility',
          exported: i % 10 === 0,
        });
      }

      const insertTime = performance.now() - startTime;

      // Query performance with large dataset
      const queryStart = performance.now();
      for (let i = 0; i < 100; i++) {
        store.searchSymbols('func');
      }
      const queryTime = (performance.now() - queryStart) / 100;

      // Get stats
      const stats = store.getStats();

      console.log(`Large dataset (10k symbols):`);
      console.log(`  Insert: ${insertTime.toFixed(0)}ms`);
      console.log(`  Query: ${queryTime.toFixed(2)}ms avg`);
      console.log(`  Total symbols: ${stats.symbols}`);

      expect(stats.symbols).toBe(10000);
      expect(insertTime).toBeLessThan(10000); // 10s for 10k inserts
      expect(queryTime).toBeLessThan(50); // 50ms per query
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during parsing', () => {
      const code = `
        function test() {
          const obj = { a: 1, b: 2 };
          return Object.keys(obj);
        }
      `;

      // Parse many times
      for (let i = 0; i < 1000; i++) {
        parser.parse(code, 'test.ts');
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memUsage = process.memoryUsage();
      console.log(`Memory after 1000 parses: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);

      // Should not exceed 100MB
      expect(memUsage.heapUsed).toBeLessThan(100 * 1024 * 1024);
    });
  });
});
