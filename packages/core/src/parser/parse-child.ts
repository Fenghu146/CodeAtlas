// ============================================================
// Parse Child - tree-sitter parsing inside a recyclable child process
// ============================================================
// Why this exists: web-tree-sitter 0.24.x/0.25.x leaks native WASM memory on
// every parse() even after tree.delete(). Scanning a real repository from one
// long-lived parser eventually gets the process OOM-killed (verified on this
// project: a 23KB C++ header cost ~68MB RSS per parse, and scanning HIS_cpp was
// SIGKILLed before finishing).
//
// Parsing therefore runs here, in a worker the pool (parser-pool.ts) recycles.
// A child *process* is used rather than a worker thread on purpose:
// worker_threads terminate() does not give the WASM heap back to the OS (RSS
// only fell 467 -> 251MB after terminate, and the next generation still OOMed),
// whereas a killed process' memory is reclaimed by the kernel deterministically.
//
// Transport is newline-delimited JSON on stdin/stdout, deliberately *not*
// `child_process.fork` IPC: when the host is itself a spawned worker (test
// runners, bundler dev servers), an extra IPC channel collides with the host's
// own protocol and takes the host down with it. Plain pipes have no such
// coupling.
//
// Protocol (see parse-protocol.ts): one JSON request per stdin line, one JSON
// message per stdout line — `{"kind":"ready"}` first, then one `result` per
// request id. Keep this file dependency-light; it is spawned once per worker
// generation.
// ============================================================

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { CodeParser, detectLanguage } from './index.js';
import type { ParseMessage, ParseRequest } from './parse-protocol.js';

const trace = (line: string): void => {
  const target = process.env.CODEATLAS_CHILD_TRACE;
  if (!target) return;
  try {
    appendFileSync(target, `${line}\n`);
  } catch {
    // Diagnostic only.
  }
};

const parser = new CodeParser();
let ready: Promise<void> | null = null;
let inFlight = 0;
let stdinClosed = false;

function maybeExit(): void {
  if (stdinClosed && inFlight === 0) {
    trace('drained -> exit');
    process.exit(0);
  }
}

function ensureReady(): Promise<void> {
  if (!ready) ready = parser.init();
  return ready;
}

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

function send(message: ParseMessage): void {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    // Parent gone (EPIPE); nothing to report.
  }
}

async function handle(request: ParseRequest): Promise<void> {
  inFlight++;
  try {
    await ensureReady();
    const language = detectLanguage(request.filePath);
    if (language && !parser.hasLanguage(language)) {
      await parser.loadLanguage(language);
    }
    const result = parser.parse(request.content, request.filePath);
    send({ kind: 'result', id: request.id, ok: true, result, rssMb: rssMb() });
  } catch (err) {
    send({
      kind: 'result',
      id: request.id,
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      rssMb: rssMb(),
    });
  } finally {
    inFlight--;
    maybeExit();
  }
}


createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: ParseRequest;
  try {
    request = JSON.parse(trimmed) as ParseRequest;
  } catch {
    trace(`bad request line: ${trimmed.slice(0, 120)}`);
    return;
  }
  void handle(request);
});

// Exit quietly once the parent closes the pipe — but only after every request
// already received has finished, so an EOF arriving mid-parse cannot kill work
// that is still running.
process.stdin.on('end', () => {
  trace('stdin end');
  stdinClosed = true;
  maybeExit();
});
process.on('error', (err) => trace(`error ${String(err)}`));
process.on('exit', (code) => trace(`exit ${code}`));

trace('child booted');

// Tell the pool this child is ready to accept jobs.
send({ kind: 'ready', rssMb: rssMb() });
