// ============================================================
// Performance Benchmarks
// ============================================================
// Parse benchmarks run through ParserPool — the path real scans use. This
// matters for correctness too: web-tree-sitter leaks native memory per parse
// (see parser/parse-child.ts), so raw in-process parse loops grow RSS until
// the process is OOM-killed. When no compiled worker script is available the
// iteration counts shrink so the suite stays safe to run before `pnpm build`.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SQLiteStore } from './store/sqlite-store.js';
import { ParserPool, resolveChildScript, type ParseJob } from './parser/parser-pool.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PERF_DB_PATH = path.join(os.tmpdir(), `codeatlas-perf-${process.pid}`, 'test-perf.sqlite');
const WORKERS_AVAILABLE = resolveChildScript() !== null;

// Without recyclable workers, keep parse counts tiny (in-process leaks).
const SMALL_ITER = WORKERS_AVAILABLE ? 100 : 15;
const MEDIUM_ITER = WORKERS_AVAILABLE ? 10 : 3;
const LARGE_ITER = WORKERS_AVAILABLE ? 5 : 1;
const MEM_ITER = WORKERS_AVAILABLE ? 200 : 20;

function makePool(maxFilesPerWorker = 25): ParserPool {
  return new ParserPool({ maxWorkers: 1, maxFilesPerWorker });
}

describe('Performance Benchmarks', () => {
  let store: SQLiteStore;

  beforeAll(async () => {
    // Ensure test directory exists
    const dir = path.dirname(PERF_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store = new SQLiteStore({ dbPath: PERF_DB_PATH });
    if (!WORKERS_AVAILABLE) {
      console.warn('parse-child.js not built — parse benchmarks run with reduced counts (run `pnpm build` first)');
    }
  });

  afterAll(() => {
    store.close();
    if (fs.existsSync(PERF_DB_PATH)) {
      fs.unlinkSync(PERF_DB_PATH);
    }
    try {
      fs.rmSync(path.dirname(PERF_DB_PATH), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  describe('Parser Performance', () => {
    it('should parse small file in < 100ms avg', async () => {
      const code = `
        function hello() {
          return 'world';
        }
      `;

      const pool = makePool();
      try {
        const jobs: ParseJob[] = Array.from({ length: SMALL_ITER }, (_, i) => ({
          filePath: `test-${i}.ts`,
          content: code,
        }));
        const start = performance.now();
        const outcomes = await pool.parseMany(jobs);
        const end = performance.now();
        const avg = (end - start) / SMALL_ITER;

        expect(outcomes.every((o) => o.ok)).toBe(true);
        console.log(`Parser (small file, via pool): ${avg.toFixed(2)}ms avg`);
        expect(avg).toBeLessThan(100);
      } finally {
        await pool.destroy();
      }
    });

    it('should parse medium file in < 500ms avg', async () => {
      // Generate a medium-sized file
      const lines = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`function func${i}() { return ${i}; }`);
      }
      const code = lines.join('\n');

      const pool = makePool();
      try {
        const jobs: ParseJob[] = Array.from({ length: MEDIUM_ITER }, (_, i) => ({
          filePath: `test-${i}.ts`,
          content: code,
        }));
        const start = performance.now();
        const outcomes = await pool.parseMany(jobs);
        const end = performance.now();
        const avg = (end - start) / MEDIUM_ITER;

        expect(outcomes.every((o) => o.ok)).toBe(true);
        console.log(`Parser (medium file, 100 funcs, via pool): ${avg.toFixed(2)}ms avg`);
        expect(avg).toBeLessThan(500);
      } finally {
        await pool.destroy();
      }
    });

    it('should parse large file in < 2000ms avg', async () => {
      // Generate a large file
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`function func${i}(x) { return x * ${i}; }`);
      }
      const code = lines.join('\n');

      const pool = makePool();
      try {
        const jobs: ParseJob[] = Array.from({ length: LARGE_ITER }, (_, i) => ({
          filePath: `test-${i}.ts`,
          content: code,
        }));
        const start = performance.now();
        const outcomes = await pool.parseMany(jobs);
        const end = performance.now();
        const avg = (end - start) / LARGE_ITER;

        expect(outcomes.every((o) => o.ok)).toBe(true);
        console.log(`Parser (large file, 1000 funcs, via pool): ${avg.toFixed(2)}ms avg`);
        expect(avg).toBeLessThan(2000);
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('Store Performance', () => {
    beforeEach(() => {
      store.clear();
    });

    it('should insert 1000 symbols in < 2000ms', () => {
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
      const total = end - start;

      console.log(`Store upsertSymbol (1000 inserts): ${total.toFixed(2)}ms total`);
      expect(total).toBeLessThan(2000);
    });

    it('should query symbols in < 50ms', () => {
      // Insert test data
      for (let i = 0; i < 100; i++) {
        store.upsertSymbol({
          id: `test.ts:func${i}:${i * 10}`,
          name: `func${i}`,
          kind: 'function',
          filePath: 'test.ts',
          startLine: i * 10,
          endLine: i * 10 + 5,
          language: 'typescript',
          layer: 'business',
          exported: false,
        });
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        store.searchSymbols('func50');
      }
      const end = performance.now();
      const avg = (end - start) / 100;

      console.log(`Store searchSymbols (100 queries): ${avg.toFixed(3)}ms avg`);
      expect(avg).toBeLessThan(50);
    });

    it('should retrieve symbol by ID in < 10ms', () => {
      // Insert test data
      for (let i = 0; i < 100; i++) {
        store.upsertSymbol({
          id: `test.ts:func${i}:${i * 10}`,
          name: `func${i}`,
          kind: 'function',
          filePath: 'test.ts',
          startLine: i * 10,
          endLine: i * 10 + 5,
          language: 'typescript',
          layer: 'business',
          exported: false,
        });
      }

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        store.getSymbol(`test.ts:func${i}:${i * 10}`);
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
    it('should keep memory bounded during heavy parsing', async () => {
      const code = `
        function test() {
          const obj = { a: 1, b: 2 };
          return Object.keys(obj);
        }
      `;

      const before = process.memoryUsage();
      const pool = makePool(10); // recycle aggressively
      try {
        const jobs: ParseJob[] = Array.from({ length: MEM_ITER }, (_, i) => ({
          filePath: `test-${i}.ts`,
          content: code,
        }));
        const outcomes = await pool.parseMany(jobs);
        expect(outcomes.every((o) => o.ok)).toBe(true);
      } finally {
        await pool.destroy();
      }
      const after = process.memoryUsage();

      const rssGrowthMb = (after.rss - before.rss) / 1024 / 1024;
      const heapUsedMb = after.heapUsed / 1024 / 1024;
      console.log(
        `Memory after ${MEM_ITER} parses: rss growth ${rssGrowthMb.toFixed(1)} MB, heapUsed ${heapUsedMb.toFixed(1)} MB`
      );

      // JS heap stays small; the regression that matters is native (WASM) growth,
      // which worker recycling must contain (unbounded it reaches OOM).
      expect(heapUsedMb).toBeLessThan(100);
      expect(rssGrowthMb).toBeLessThan(300);
    });
  });
});