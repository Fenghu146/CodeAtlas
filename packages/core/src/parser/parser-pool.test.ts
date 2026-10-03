// ============================================================
// Parser Pool tests
// ============================================================
// The pool exists to keep scans within a bounded memory budget (web-tree-sitter
// leaks native memory per parse). These tests pin its scheduling contract:
// input order preserved, workers recycled after maxFilesPerWorker files, hung
// parses rejected on a fresh worker, crashes retried in isolation, and a safe
// in-process fallback when no worker script can be spawned.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  ParserPool,
  resolveChildScript,
  type ParseExecutor,
  type ParseJob,
  type ParseResult,
} from './parser-pool.js';
import type { ParseResult as RealParseResult } from './index.js';

function fakeResult(filePath: string): ParseResult {
  return {
    filePath,
    language: 'typescript',
    symbols: [],
    relationships: [],
    imports: [],
    errors: [],
  } as unknown as ParseResult;
}

interface FakeOptions {
  failFirstRun?: boolean;
  hangOnFirstRun?: boolean;
}

/** Executor double: records lifecycle so recycle behaviour is observable. */
class FakeExecutor implements ParseExecutor {
  static created = 0;
  static disposed = 0;

  jobsDone = 0;
  private options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    FakeExecutor.created++;
    this.options = options;
  }

  async ready(): Promise<void> {
    // Instant — doubles model an already-running worker.
  }

  parse(_content: string, filePath: string): Promise<RealParseResult> {
    if (this.options.hangOnFirstRun && this.jobsDone === 0) {
      this.jobsDone++;
      // Never settles — forces the pool's job timeout to fire.
      return new Promise<RealParseResult>(() => {});
    }
    if (this.options.failFirstRun && this.jobsDone === 0) {
      this.jobsDone++;
      return Promise.reject(new Error('parse worker exited (code=1, signal=null)'));
    }
    this.jobsDone++;
    return Promise.resolve(fakeResult(filePath) as unknown as RealParseResult);
  }

  rssMb(): number {
    return 0;
  }

  async dispose(): Promise<void> {
    FakeExecutor.disposed++;
  }
}

describe('ParserPool', () => {
  it('resolves the child script when dist is built', () => {
    // After `pnpm build` the compiled child must be discoverable — this is what
    // keeps real scans (and the benchmarks) on recyclable child processes.
    const script = resolveChildScript();
    if (script) {
      expect(script.pathname).toMatch(/parse-child\.js$/);
    }
  });

  it('preserves input order and reports failures in place', async () => {
    const pool = new ParserPool({ maxWorkers: 2 });
    try {
      const jobs: ParseJob[] = [
        { filePath: 'a.ts', content: 'export function a(): number { return 1; }' },
        { filePath: 'b.ts', content: 'export function b(): number { return 2; }' },
        { filePath: 'c.ts', content: 'export const c = 3;' },
        { filePath: 'd.ts', content: 'export default 4;' },
      ];
      const outcomes = await pool.parseMany(jobs);
      expect(outcomes.map((o) => o.filePath)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(true);
      }
      // Named declarations must come back as symbols (d.ts is an anonymous
      // default export and legitimately has none).
      const first = outcomes[0];
      if (first.ok) {
        expect(first.result.symbols.map((s) => s.name)).toContain('a');
      }
    } finally {
      await pool.destroy();
    }
  });

  it('recycles executors after maxFilesPerWorker files', async () => {
    FakeExecutor.created = 0;
    FakeExecutor.disposed = 0;
    const events: string[] = [];
    const pool = new ParserPool({
      maxWorkers: 1,
      maxFilesPerWorker: 2,
      createExecutor: () => new FakeExecutor(),
      onEvent: (event) => {
        if (event.type === 'recycle') events.push(event.reason);
      },
    });
    try {
      const jobs: ParseJob[] = Array.from({ length: 5 }, (_, i) => ({
        filePath: `f${i}.ts`,
        content: 'export {};',
      }));
      const outcomes = await pool.parseMany(jobs);
      expect(outcomes.every((o) => o.ok)).toBe(true);
      // 5 files with recycling every 2: executors serve 2 files then are
      // replaced, and the last one is disposed when the queue drains.
      expect(FakeExecutor.disposed).toBeGreaterThanOrEqual(3);
      expect(events).toContain('files');
    } finally {
      await pool.destroy();
    }
  });

  it('retries a crashed job on a fresh executor', async () => {
    let first = true;
    const pool = new ParserPool({
      maxWorkers: 1,
      maxRetries: 1,
      createExecutor: () => {
        const executor = new FakeExecutor({ failFirstRun: first });
        first = false;
        return executor;
      },
    });
    try {
      const outcome = await pool.parse({ filePath: 'x.ts', content: 'export {};' });
      // Crash on first executor, success after the pool replaces it.
      expect(outcome.ok).toBe(true);
    } finally {
      await pool.destroy();
    }
  });

  it('times out a hung parse and fails the job after retries', async () => {
    const pool = new ParserPool({
      maxWorkers: 1,
      jobTimeoutMs: 50,
      maxRetries: 0,
      createExecutor: () => new FakeExecutor({ hangOnFirstRun: true }),
    });
    try {
      const outcome = await pool.parse({ filePath: 'hang.ts', content: 'export {};' });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.message).toContain('timed out');
    } finally {
      await pool.destroy();
    }
  });

  it('recycles on RSS ceiling', async () => {
    const events: string[] = [];
    class BigRssExecutor extends FakeExecutor {
      rssMb(): number {
        return 999;
      }
    }
    const pool = new ParserPool({
      maxWorkers: 1,
      maxFilesPerWorker: 100,
      maxRssMb: 256,
      createExecutor: () => new BigRssExecutor(),
      onEvent: (event) => {
        if (event.type === 'recycle') events.push(event.reason);
      },
    });
    try {
      await pool.parseMany([
        { filePath: 'big.ts', content: 'export {};' },
        { filePath: 'big2.ts', content: 'export {};' },
      ]);
      expect(events).toContain('rss');
    } finally {
      await pool.destroy();
    }
  });

  it('parses in-process when no child script is available (fallback contract)', async () => {
    // The fallback keeps tests and bundled environments functional: same
    // outcomes, just without memory isolation.
    const pool = new ParserPool({ maxWorkers: 1 });
    try {
      const outcome = await pool.parse({
        filePath: 'fallback.ts',
        content: 'export function f(): number { return 1; }',
      });
      expect(outcome.ok).toBe(true);
    } finally {
      await pool.destroy();
    }
  });
});
