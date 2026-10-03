// ============================================================
// Parser Pool - bounded-memory parse scheduling over child processes
// ============================================================
// web-tree-sitter leaks native WASM memory on every parse() (measured: a 23KB
// C++ header cost ~68MB RSS per parse; scanning HIS_cpp from one long-lived
// parser was SIGKILLed), so parsing runs in short-lived child processes that
// the pool recycles after a fixed number of files, after a parse timeout, or
// when the child's RSS grows too far. A recycled child is killed and replaced —
// exit reclaims memory deterministically, which is why this uses `fork` rather
// than worker threads (thread terminate() left the WASM heap resident and the
// next generation still got OOM-killed).
//
// Ownership matters as much as recycling: every executor is created, used for
// many files and always disposed by the worker loop that owns it (success,
// failure, or end of queue). An abandoned child keeps its IPC channel open and
// wedges whatever spawned it — test runners in particular.
//
// When the built worker is missing (e.g. running from source without a build),
// the pool falls back to in-process parsing so the feature keeps working — just
// without memory isolation.
//
// Contract: parseMany preserves input order; a job is attempted at most
// maxRetries+1 times (once per fresh worker) so a poison file fails in
// isolation and never stalls the queue.
// ============================================================

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { appendFileSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { assetDir } from './asset-dir.js';
import type { ParseResult } from './index.js';
import type { ParseMessage, ParseRequest } from './parse-protocol.js';

const ptrace = (line: string): void => {
  const target = process.env.CODEATLAS_POOL_TRACE;
  if (!target) return;
  try {
    appendFileSync(target, `[${process.pid}] ${Date.now() % 100000} ${line}\n`);
  } catch {
    // Diagnostic only.
  }
};

export interface ParseJob {
  /** Project-relative path (used for language detection and reporting). */
  filePath: string;
  /** Full source text. */
  content: string;
}

export interface ParseJobOk {
  ok: true;
  filePath: string;
  result: ParseResult;
  /** Time the executing unit spent parsing (excludes dispatch and IPC). */
  parseMs?: number;
}

export interface ParseJobError {
  ok: false;
  filePath: string;
  error: { message: string; stack?: string };
}

export type ParseJobOutcome = ParseJobOk | ParseJobError;

/** The scheduling unit the pool creates, reuses and recycles. */
export interface ParseExecutor {
  /** Resolves once the executor can accept jobs. */
  ready(): Promise<void>;
  parse(content: string, filePath: string): Promise<ParseExecution>;
  /** RSS of the executing unit in MB, or null when unknown (in-process). */
  rssMb(): number | null;
  /** Files parsed by this executor so far. */
  readonly jobsDone: number;
  dispose(): Promise<void>;
}

export type RecycleReason = 'files' | 'rss' | 'timeout';

/** What an executor returns for one job. */
export interface ParseExecution {
  result: ParseResult;
  /** Wall time spent parsing inside the executing unit, when measured. */
  parseMs?: number;
}

export interface ParserPoolOptions {
  /** Max concurrent parse workers. Default: min(4, cpus/2), further capped by
   *  the memory budget so that workers * maxRssMb fits in half of it. */
  maxWorkers?: number;
  /** Recycle each worker after this many files. Default 25. */
  maxFilesPerWorker?: number;
  /** Recycle a worker once its RSS exceeds this many MB. Default 320 — a
 *  worker starts at ~220MB just loading tree-sitter plus one grammar. */
  maxRssMb?: number;
  /** Per-job wall clock limit before the worker is recycled. Default 60s. */
  jobTimeoutMs?: number;
  /** Extra attempts per job after the first, on a fresh worker. Default 2. */
  maxRetries?: number;
  /** Replace the child backend — used by tests to observe lifecycle. */
  createExecutor?: () => ParseExecutor;
  /** Telemetry hook; safe to omit. */
  onEvent?: (event: { type: 'spawn' | 'recycle'; reason: RecycleReason; jobsDone: number }) => void;
}

/** Runs parse jobs in a spawned child process; `dispose` kills it. */
class ChildParseExecutor implements ParseExecutor {
  jobsDone = 0;

  private child: ChildProcessByStdio<Writable, Readable, null>;
  private nextId = 1;
  private pending = new Map<number, (message: ParseMessage) => void>();
  private readyPromise: Promise<void>;
  private disposed = false;
  private exited = false;
  private lastRss: number | null = null;

  constructor(script: string, onLost: (err: Error) => void) {
    // Clean both kinds of inherited channel plumbing. NODE_OPTIONS can carry a
    // host's bootstrap (test runners, bundlers), and NODE_CHANNEL_FD still
    // points at the *host's* IPC channel — a child that picks it up starts
    // talking on its parent's protocol and wedges that channel. The child only
    // ever needs its own pipes.
    const env: Record<string, string | undefined> = { ...process.env, NODE_OPTIONS: '' };
    delete env.NODE_CHANNEL_FD;
    delete env.NODE_UNIQUE_ID;

    this.child = spawn(process.execPath, [script], {
      // Pipes, not IPC and not inherited stdio: a compute worker is a pure
      // side channel and must never share the host's stdio or IPC plumbing.
      stdio: ['pipe', 'pipe', 'ignore'],
      env,
    });

    // A dead child surfaces as EPIPE on the pipe we write to — and an
    // unhandled stream 'error' event is fatal to the *host* process. Swallow
    // it here; the job fails through the exit handler instead.
    this.child.stdin.on('error', () => {});
    this.child.stdout.on('error', () => {});
    this.child.on('error', (err) => {
      ptrace(`spawn error ${String(err)}`);
      onLost(err);
    });

    let markReady: () => void = () => {};
    this.readyPromise = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      const timer = setTimeout(
        () => reject(new Error('parse worker failed to start within 15s')),
        15_000
      );
      timer.unref?.();
    });

    // Single message entry point: the ready ping resolves startup, everything
    // else settles the job it was issued for.
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let message: ParseMessage;
      try {
        message = JSON.parse(trimmed) as ParseMessage;
      } catch {
        return;
      }
      this.lastRss = message.rssMb ?? this.lastRss;
      if (message.kind === 'ready') {
        markReady();
        return;
      }
      const settle = this.pending.get(message.id);
      if (settle) {
        this.pending.delete(message.id);
        settle(message);
      }
    });

    this.child.on('error', onLost);
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      if (this.disposed) return;
      const message = `parse worker exited (code=${code}, signal=${signal})`;
      for (const settle of this.pending.values()) {
        settle({ kind: 'result', id: -1, ok: false, error: { message } });
      }
      this.pending.clear();
      onLost(new Error(message));
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  parse(content: string, filePath: string): Promise<ParseExecution> {
    const id = this.nextId++;
    return new Promise<ParseExecution>((resolve, reject) => {
      this.pending.set(id, (message) => {
        if (message.kind !== 'result') {
          reject(new Error('parse worker sent a non-result message for a job'));
          return;
        }
        if (message.ok) {
          this.jobsDone++;
          resolve({ result: message.result, parseMs: message.parseMs });
        } else {
          reject(new Error(message.error.message));
        }
      });
      try {
        const request = { id, filePath, content } satisfies ParseRequest;
        this.child.stdin.write(`${JSON.stringify(request)}\n`);
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  rssMb(): number | null {
    return this.lastRss;
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    ptrace('dispose');
    if (this.exited) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.child.once('exit', () => resolve());
      // Closing stdin lets a healthy child shut itself down; SIGKILL is the
      // backstop for one that ignores it.
      this.child.stdin.end();
      const killTimer = setTimeout(() => this.child.kill('SIGKILL'), 50);
      killTimer.unref?.();
      // Never hang the caller on a child that refuses to die.
      const timer = setTimeout(() => resolve(), 2_000);
      timer.unref?.();
      this.child.once('exit', () => clearTimeout(timer));
    });
  }
}

/** Last-resort in-process backend (used when the worker entry is unavailable). */
class InProcessExecutor implements ParseExecutor {
  jobsDone = 0;

  private parserPromise: Promise<import('./index.js').CodeParser> | null = null;

  private async parser(): Promise<import('./index.js').CodeParser> {
    if (!this.parserPromise) {
      this.parserPromise = (async () => {
        const { CodeParser } = await import('./index.js');
        const parser = new CodeParser();
        await parser.init();
        return parser;
      })();
    }
    return this.parserPromise;
  }

  async ready(): Promise<void> {
    await this.parser();
  }

  async parse(content: string, filePath: string): Promise<ParseExecution> {
    const parser = await this.parser();
    const { detectLanguage } = await import('./index.js');
    const language = detectLanguage(filePath);
    if (language && !parser.hasLanguage(language)) {
      await parser.loadLanguage(language);
    }
    this.jobsDone++;
    const startedAt = performance.now();
    const result = parser.parse(content, filePath);
    return { result, parseMs: performance.now() - startedAt };
  }

  rssMb(): number | null {
    return null;
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Parse a set of files with bounded memory.
 */
export class ParserPool {
  private readonly options: Required<Omit<ParserPoolOptions, 'onEvent' | 'createExecutor'>>;
  private readonly onEvent: NonNullable<ParserPoolOptions['onEvent']>;
  private readonly createExecutor: () => ParseExecutor;

  constructor(options: ParserPoolOptions = {}) {
    const cpus = availableParallelism();
    this.options = {
      maxWorkers: options.maxWorkers ?? Math.max(1, Math.min(4, Math.floor(cpus / 2))),
      maxFilesPerWorker: options.maxFilesPerWorker ?? 25,
      // The child baseline (tree-sitter + grammar WASM) is ~240MB; a cap below
      // that recycles the worker after every single job. 512MB allows real work
      // before the (upstream) per-parse WASM leak forces a recycle.
      maxRssMb: options.maxRssMb ?? 512,
      jobTimeoutMs: options.jobTimeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
    };
    this.onEvent = options.onEvent ?? (() => {});

    if (options.createExecutor) {
      this.createExecutor = options.createExecutor;
    } else {
      const script = resolveChildScript();
      this.createExecutor = script
        ? () => new ChildParseExecutor(fileURLToPath(script), () => {})
        : () => new InProcessExecutor();
    }

    // Keep the memory budget honest on small machines: never start more
    // workers than half of free RAM can hold at the RSS ceiling.
    const affordable = Math.floor((freemem() * 0.5) / (this.options.maxRssMb * 1048576));
    this.options.maxWorkers = Math.max(1, Math.min(this.options.maxWorkers, affordable));
  }

  /**
   * Parse `jobs` and return one outcome per job, in input order.
   * Resolves only after every job has settled.
   */
  async parseMany(jobs: ParseJob[]): Promise<ParseJobOutcome[]> {
    const results: ParseJobOutcome[] = new Array(jobs.length);
    if (jobs.length === 0) return results;

    let cursor = 0;
    // One loop per worker: each worker owns a single long-lived executor and
    // pulls jobs off the shared cursor. That is what makes recycling mean
    // anything — an executor serves many files before it is replaced.
    const runWorker = async (): Promise<void> => {
      let executor: ParseExecutor | null = null;
      let jobsOnThisExecutor = 0;
      try {
        for (;;) {
          const index = cursor++;
          if (index >= jobs.length) return;
          const job = jobs[index];

          let outcome: ParseJobOutcome = {
            ok: false,
            filePath: job.filePath,
            error: { message: 'parse not attempted' },
          };
          for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
            if (!executor) {
              try {
                executor = await this.createExecutor();
                await executor.ready();
                jobsOnThisExecutor = 0;
              } catch (err) {
                executor = null;
                outcome = {
                  ok: false,
                  filePath: job.filePath,
                  error: {
                    message: `parse worker crashed: ${err instanceof Error ? err.message : String(err)}`,
                    stack: err instanceof Error ? err.stack : undefined,
                  },
                };
                break;
              }
            }

            outcome = await this.runJob(executor, job);
            if (outcome.ok) break;
            // A hung or dead worker is replaced and the job retried; a grammar
            // error is the file's own fault and is reported as-is.
            if (!/timed out|worker/i.test(outcome.error.message)) break;
            await this.recycle(executor);
            executor = null;
          }
          results[index] = outcome;

          if (executor) {
            jobsOnThisExecutor++;
            if (this.shouldRecycle(executor, jobsOnThisExecutor)) {
              await this.recycle(executor);
              executor = null;
            }
          }
        }
      } finally {
        // Never leave a child behind — orphaned workers hold IPC channels open
        // and keep test runners and scans from exiting.
        if (executor) await this.recycle(executor);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.options.maxWorkers, jobs.length) }, () => runWorker())
    );
    return results;
  }

  /** Parse one job, retrying on a fresh worker when the failure is infra. */
  async parse(job: ParseJob): Promise<ParseJobOutcome> {
    const outcomes = await this.parseMany([job]);
    return outcomes[0];
  }

  private async runJob(executor: ParseExecutor, job: ParseJob): Promise<ParseJobOutcome> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`parse timed out after ${this.options.jobTimeoutMs}ms`));
      }, this.options.jobTimeoutMs);
      timer.unref?.();
    });

    try {
      const execution = await Promise.race([executor.parse(job.content, job.filePath), timeout]);
      return { ok: true, filePath: job.filePath, result: execution.result, parseMs: execution.parseMs };
    } catch (err) {
      if (timedOut) {
        this.onEvent({ type: 'recycle', reason: 'timeout', jobsDone: executor.jobsDone });
      }
      return {
        ok: false,
        filePath: job.filePath,
        error: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldRecycle(executor: ParseExecutor, jobsOnThisExecutor: number): boolean {
    if (jobsOnThisExecutor >= this.options.maxFilesPerWorker) {
      this.onEvent({ type: 'recycle', reason: 'files', jobsDone: executor.jobsDone });
      return true;
    }
    const rss = executor.rssMb();
    if (rss !== null && rss >= this.options.maxRssMb) {
      this.onEvent({ type: 'recycle', reason: 'rss', jobsDone: executor.jobsDone });
      return true;
    }
    return false;
  }

  private async recycle(executor: ParseExecutor): Promise<void> {
    await executor.dispose();
  }

  /**
   * Release pooled resources. Workers are owned by their scheduling loop and
   * disposed as soon as it stops, so this is kept for API symmetry.
   */
  async destroy(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Locate the child entry, tolerating execution from src/ (dev, tests) and
 * dist/ (built package). Returns null when nothing can be spawned — callers
 * fall back to in-process parsing rather than failing the scan.
 */
export function resolveChildScript(): URL | null {
  // Resolve the independently-spawned worker against assetDir() so it is found
  // in the ESM source layout, the CJS bundle (VS Code extension), and running
  // from source before a build — not via `import.meta.url`, which esbuild
  // substitutes away in CJS bundles.
  const base = assetDir();
  const candidates = [
    // Core built (dist/parser/) and the VS Code bundle (dist/): the worker is a
    // sibling of this module's asset dir.
    path.join(base, 'parse-child.js'),
    // Core source (src/parser/) under vitest/tsc: the worker is the built file
    // two levels up in dist/parser/. This preserves child-process WASM
    // isolation instead of silently falling back to in-process parsing.
    path.join(base, '..', '..', 'dist', 'parser', 'parse-child.js'),
    path.join(base, '..', 'dist', 'parser', 'parse-child.js'),
    path.join(base, 'dist', 'parse-child.js'),
    path.join(base, '..', 'parse-child.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return pathToFileURL(candidate);
    } catch {
      // Unusable path — try the next candidate.
    }
  }
  return null;
}

/**
 * How much memory this process may actually use, in MB.
 *
 * `os.freemem()` reports the *host's* free memory, which is meaningless inside
 * a container: the real ceiling is the cgroup limit, and blowing past it gets
 * the largest process (the one running this code) OOM-killed with no warning.
 * When the limit is readable, size against it; otherwise fall back to a
 * conservative slice of total memory so small machines stay safe.
 */
function memoryBudgetMb(): number {
  const MB = 1048576;
  const hostBudget = Math.min(freemem() / MB, totalmem() / 2 / MB);

  const limit = readCgroupNumber(['memory.max', 'memory/memory.limit_in_bytes']);
  if (limit === null || limit >= Number.MAX_SAFE_INTEGER) return Math.max(64, hostBudget);

  const used = readCgroupNumber(['memory.current', 'memory/memory.usage_in_bytes']) ?? 0;
  return Math.max(64, Math.min(hostBudget, (limit - used) / MB));
}

function readCgroupNumber(relativePaths: string[]): number | null {
  // Both the process' own cgroup and the v2/v1 roots are plausible homes for
  // the limit; whichever one is readable wins.
  const own = cgroupPathOf(process.pid);
  const roots = own ? [own] : [];
  roots.push('/sys/fs/cgroup');
  for (const root of roots) {
    for (const relative of relativePaths) {
      try {
        const raw = readFileSync(`${root}/${relative}`, 'utf-8').trim();
        if (raw === 'max') return Number.MAX_SAFE_INTEGER;
        const value = Number.parseInt(raw, 10);
        if (Number.isFinite(value) && value > 0) return value;
      } catch {
        // Not readable from here — try the next candidate.
      }
    }
  }
  return null;
}

function cgroupPathOf(pid: number): string | null {
  try {
    const line = readFileSync(`/proc/${pid}/cgroup`, 'utf-8').split('\n')[0] ?? '';
    const path = line.slice(line.lastIndexOf(':') + 1);
    return path.startsWith('/') ? `/sys/fs/cgroup${path}` : null;
  } catch {
    return null;
  }
}
