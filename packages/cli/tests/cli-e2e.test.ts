// ============================================================
// CLI end-to-end tests
// ============================================================
// These run the built CLI against a scanned fixture project, exactly as a
// user would from a terminal: `node dist/index.js <command> ...`. Assertions
// are on exit codes and rendered output. Run `pnpm build` first.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI_DIST = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'sample-project');

let workDir: string;
let projectDir: string;
let fullScanOutput: string;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], cwd?: string): RunResult {
  try {
    const stdout = execFileSync('node', [CLI_DIST, ...args], {
      cwd: cwd ?? projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Strip ANSI color codes so assertions can match plain text. */
function plain(result: RunResult): string {
  return (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '');
}

beforeAll(() => {
  if (!fs.existsSync(CLI_DIST)) {
    throw new Error(`CLI build missing at ${CLI_DIST} — run \`pnpm build\` first`);
  }
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeatlas-cli-'));
  projectDir = path.join(workDir, 'project');
  fs.cpSync(FIXTURE, projectDir, { recursive: true });
  const scan = run(['scan', projectDir], workDir);
  expect(scan.status, `scan failed: ${plain(scan)}`).toBe(0);
  fullScanOutput = plain(scan);
}, 60_000);

afterAll(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

describe('codeatlas scan', () => {
  it('reports indexed files, symbols and languages on a full scan', () => {
    expect(fullScanOutput).toMatch(/Files scanned: [1-9]\d*/i);
    expect(fullScanOutput).toMatch(/Symbols found: [1-9]\d*/i);
    expect(fullScanOutput).toMatch(/Languages: .*(typescript|c)/i);
  });

  it('is incremental on a second run', () => {
    const text = plain(run(['scan', projectDir], workDir));
    expect(text).toMatch(/Files skipped: [1-9]\d*/i);
  });
});

describe('codeatlas queries', () => {
  it('finds symbols by name', () => {
    const text = plain(run(['search', 'UserService']));
    expect(text).toContain('UserService');
    expect(text).toMatch(/user-service\.ts/);
  });

  it('shows symbol details', () => {
    const text = plain(run(['info', 'UserHandler']));
    expect(text).toContain('UserHandler');
    expect(text).toMatch(/class|api\/user-handler\.ts/);
  });

  it('lists callers of a method', () => {
    const text = plain(run(['callers', 'save']));
    expect(text).toMatch(/create/);
  });

  it('lists callees of a method', () => {
    const text = plain(run(['callees', 'createUser']));
    expect(text).toMatch(/create/);
  });

  it('classifies the project into layers', () => {
    const text = plain(run(['layers']));
    expect(text).toMatch(/interface/i);
    expect(text).toMatch(/business/i);
    expect(text).toMatch(/data/i);
    expect(text).toMatch(/utility/i);
  });

  it('resolves qualified names to the member, not the class', () => {
    const text = plain(run(['impact', 'UserRepository.save']));
    expect(text).toMatch(/save \(method\)/);
    expect(text).not.toMatch(/using best match/);
  });

  it('traces impact through import edges across files', () => {
    const text = plain(run(['impact', 'UserService']));
    expect(text).toMatch(/UserHandler \(imports\)/);
    expect(text).toMatch(/user-handler\.ts/);
  });

  it('finds a path between two symbols as JSON', () => {
    const result = run(['path', 'createUser', 'save', '--format', 'json']);
    expect(result.status).toBe(0);
    const data = JSON.parse(plain(result));
    expect(data).toHaveProperty('path');
  });

  it('reports status of the index', () => {
    const text = plain(run(['status']));
    expect(text).toMatch(/files?|symbols?|index/i);
  });

  it('lists project dependencies', () => {
    const text = plain(run(['deps']));
    expect(text).toMatch(/express|zod|typescript|depend/i);
  });
});

describe('codeatlas export', () => {
  it('writes a JSON graph with nodes and edges', () => {
    const outFile = path.join(workDir, 'graph.json');
    const text = plain(run(['export', '--format', 'json', '--output', outFile]));
    expect(text).toMatch(/export|written|wrote|saved/i);
    expect(fs.existsSync(outFile)).toBe(true);

    const graph = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(Array.isArray(graph.symbols ?? graph.nodes)).toBe(true);
    expect(Array.isArray(graph.relationships ?? graph.edges)).toBe(true);
    const nodes = graph.symbols ?? graph.nodes;
    expect(nodes.length).toBeGreaterThan(5);
    for (const node of nodes.slice(0, 5)) {
      expect(node).toHaveProperty('label');
      expect(node).toHaveProperty('kind');
    }
  });
});

describe('codeatlas error handling', () => {
  it('honors --project from an unrelated working directory', () => {
    const text = plain(run(['layers', '--project', projectDir], workDir));
    expect(text).toMatch(/interface|business/i);
    expect(text).not.toMatch(/packages\/cli/);
  });

  it('fails clearly on an unknown command', () => {
    const result = run(['definitely-not-a-command'], workDir);
    expect(result.status).not.toBe(0);
    expect(plain(result)).toMatch(/unknown command|not a command|error/i);
  });

  it('explains a missing index instead of crashing', () => {
    const emptyDir = path.join(workDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = run(['search', 'anything', '--project', emptyDir], workDir);
    expect(result.status).not.toBe(0);
    expect(plain(result)).toMatch(/scan|index|not found|no /i);
  });

  it('reports an unknown symbol with guidance', () => {
    const text = plain(run(['impact', 'NoSuchSymbolAnywhere']));
    expect(text).toMatch(/no symbol|not found|no matches|tips/i);
  });
});
