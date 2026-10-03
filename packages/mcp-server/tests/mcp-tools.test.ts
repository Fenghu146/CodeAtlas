// ============================================================
// MCP server integration tests
// ============================================================
// These drive the built server over stdio exactly like an MCP client would:
// spawn `dist/server.js`, complete a session, then exercise every tool against
// a scanned fixture project. Run `pnpm build` first — the server entry is a
// compiled script and the tests assert on the shipped artifact.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER_DIST = path.join(REPO_ROOT, 'packages', 'mcp-server', 'dist', 'server.js');
const FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'sample-project');
const TRACE_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'flowtrace');

/** The tool contract: every tool and its declared annotation hints. */
const EXPECTED_TOOLS: Record<
  string,
  { readOnly: boolean; idempotent: boolean; destructive: boolean; openWorld: boolean }
> = {
  codeatlas_set_project: { readOnly: false, idempotent: true, destructive: false, openWorld: false },
  codeatlas_scan: { readOnly: false, idempotent: true, destructive: false, openWorld: false },
  codeatlas_search: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_node: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_calls: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_context: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_impact: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_layers: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_graph: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_explain: { readOnly: true, idempotent: true, destructive: false, openWorld: true },
  codeatlas_semantic_search: { readOnly: true, idempotent: true, destructive: false, openWorld: true },
  codeatlas_annotate: { readOnly: false, idempotent: false, destructive: false, openWorld: false },
  codeatlas_summary: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_hotspots: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_changes: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_deps: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_review: { readOnly: true, idempotent: true, destructive: false, openWorld: true },
  codeatlas_guard: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_path: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_diff: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_trace: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_trace_agent: { readOnly: true, idempotent: true, destructive: false, openWorld: true },
  codeatlas_embedded: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_agent_execute: { readOnly: false, idempotent: false, destructive: true, openWorld: true },
  codeatlas_refactor: { readOnly: true, idempotent: true, destructive: false, openWorld: false },
  codeatlas_semantic_index: { readOnly: false, idempotent: true, destructive: false, openWorld: true },
  codeatlas_orchestrate: { readOnly: false, idempotent: false, destructive: true, openWorld: true },
  codeatlas_graph_export: { readOnly: false, idempotent: true, destructive: false, openWorld: false },
};

let client: Client;
let workDir: string;

function textOf(result: { content?: unknown }): string {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? '').join('\n');
}

async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

beforeAll(async () => {
  if (!fs.existsSync(SERVER_DIST)) {
    throw new Error(`MCP server build missing at ${SERVER_DIST} — run \`pnpm build\` first`);
  }
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeatlas-mcp-'));
  fs.cpSync(FIXTURE, path.join(workDir, 'project'), { recursive: true });

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_DIST, '--project', path.join(workDir, 'project')],
    stderr: 'ignore',
  });
  client = new Client({ name: 'codeatlas-tests', version: '1.0.0' });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

describe('MCP tool registry', () => {
  it('exposes exactly the documented tools', async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual(Object.keys(EXPECTED_TOOLS).sort());
  });

  it('gives every tool a description, object schema and complete annotations', async () => {
    const list = await client.listTools();
    for (const tool of list.tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema?.type, `${tool.name} inputSchema type`).toBe('object');
      const a = tool.annotations ?? {};
      for (const hint of ['readOnlyHint', 'idempotentHint', 'destructiveHint', 'openWorldHint']) {
        expect(typeof a[hint as keyof typeof a], `${tool.name} ${hint}`).toBe('boolean');
      }
    }
  });

  it('declares annotations that match each tool behavior', async () => {
    const list = await client.listTools();
    for (const tool of list.tools) {
      const expected = EXPECTED_TOOLS[tool.name];
      expect(expected, `unexpected tool ${tool.name}`).toBeTruthy();
      expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(expected.readOnly);
      expect(tool.annotations?.idempotentHint, `${tool.name} idempotentHint`).toBe(expected.idempotent);
      expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBe(expected.destructive);
      expect(tool.annotations?.openWorldHint, `${tool.name} openWorldHint`).toBe(expected.openWorld);
    }
  });
});

describe('MCP tools against a scanned fixture', () => {
  it('scans the fixture project', async () => {
    const res = await call('codeatlas_scan', { path: path.join(workDir, 'project') });
    const text = textOf(res);
    expect(res.isError ?? false).toBe(false);
    expect(text).toMatch(/\d+/);
  });

  it('builds a task context pack', async () => {
    const text = textOf(await call('codeatlas_context', { task: 'add user deletion' }));
    expect(text).toMatch(/User|symbol|context/i);
  });

  it('searches symbols by name', async () => {
    const text = textOf(await call('codeatlas_search', { query: 'UserService' }));
    expect(text).toContain('UserService');
    expect(text).toMatch(/services\/user-service\.ts/);
  });

  it('returns symbol details with source location', async () => {
    const text = textOf(await call('codeatlas_node', { id: 'UserHandler' }));
    expect(text).toContain('UserHandler');
    expect(text).toMatch(/class/);
  });

  it('reports callees of a method', async () => {
    const text = textOf(await call('codeatlas_calls', { id: 'createUser', direction: 'out' }));
    expect(text).toContain('create');
  });

  it('reports callers of a method', async () => {
    const text = textOf(await call('codeatlas_calls', { id: 'create', direction: 'in' }));
    expect(text).toContain('createUser');
  });

  it('classifies layers across api/services/repositories/utils', async () => {
    const text = textOf(await call('codeatlas_layers'));
    expect(text).toMatch(/interface/i);
    expect(text).toMatch(/business/i);
    expect(text).toMatch(/data/i);
    expect(text).toMatch(/utility/i);
  });

  it('reports impact of changing a data-layer method', async () => {
    const text = textOf(await call('codeatlas_impact', { id: 'UserRepository.save' }));
    expect(text).toMatch(/save|create/i);
  });

  it('summarizes the index', async () => {
    const text = textOf(await call('codeatlas_summary'));
    expect(text).toMatch(/\d+/);
  });

  it('lists dependency metadata', async () => {
    const text = textOf(await call('codeatlas_deps'));
    expect(text).toMatch(/express|typescript|zod|dependency/i);
  });

  it('emits a graph with nodes and edges', async () => {
    const text = textOf(await call('codeatlas_graph'));
    expect(text).toMatch(/nodes|symbols/i);
  });

  it('finds a path between handler and repository', async () => {
    const text = textOf(await call('codeatlas_path', { source: 'createUser', target: 'save' }));
    expect(text).toMatch(/createUser|save|->|→/);
  });

  it('checks guard constraints', async () => {
    const text = textOf(await call('codeatlas_guard', { maxComplexity: 20, forbidCircular: true }));
    expect(text).toMatch(/complex|circular|guard|pass|clean|ok/i);
  });

  it('diffs the index against a saved baseline', async () => {
    const baseline = path.join(workDir, 'baseline.json');
    const saveText = textOf(await call('codeatlas_diff', { save: baseline }));
    expect(saveText).toMatch(/saved|baseline|wrote/i);
    expect(fs.existsSync(baseline)).toBe(true);
    const diffText = textOf(await call('codeatlas_diff', { baseline }));
    expect(diffText).toMatch(/change|diff|baseline|graph/i);
  });

  it('detects code smells without writing anything', async () => {
    const text = textOf(await call('codeatlas_refactor', {}));
    expect(text).toMatch(/smell|refactor|complexity|function/i);
  });

  it('analyzes the embedded Makefile project', async () => {
    const text = textOf(await call('codeatlas_embedded', { action: 'analyze' }));
    expect(text).toMatch(/makefile/i);
  });

  it('loads a Flowtrace trace and reports step status', async () => {
    const text = textOf(await call('codeatlas_trace', { action: 'load', path: TRACE_FIXTURE }));
    expect(text).toMatch(/collect|transform|report/);
  });

  it('adds and resolves annotations', async () => {
    const addText = textOf(await call('codeatlas_annotate', {
      action: 'add',
      symbolId: 'UserHandler',
      content: 'handled by the api layer',
    }));
    expect(addText).toMatch(/annotat/i);
    const listText = textOf(await call('codeatlas_annotate', { action: 'list' }));
    expect(listText).toContain('api layer');
  });

  it('exports the graph in Foam format', async () => {
    const outDir = path.join(workDir, 'foam');
    const text = textOf(await call('codeatlas_graph_export', { format: 'foam', output: outDir }));
    expect(text).toMatch(/foam|export|markdown/i);
  });
});

describe('MCP tool error and degradation paths', () => {
  it('rejects invalid enum values through schema validation', async () => {
    const res = await call('codeatlas_calls', { name: 'create', direction: 'sideways' });
    expect(res.isError ?? false).toBe(true);
  });

  it('reports a missing symbol with a helpful message', async () => {
    const res = await call('codeatlas_node', { id: 'NoSuchSymbolAnywhere' });
    expect(textOf(res)).toMatch(/not found|no match|did you mean/i);
  });

  it('degrades gracefully when no embed provider is configured', async () => {
    const res = await call('codeatlas_semantic_search', { query: 'how are users registered' });
    const text = textOf(res);
    expect(text).toMatch(/api key|config|vector|semantic|not configured|fall/i);
  });

  it('degrades gracefully when no LLM key is configured', async () => {
    const text = textOf(await call('codeatlas_explain', { name: 'UserService' }));
    expect(text).toMatch(/api key|config|not configured|llm|template|summary/i);
  });

  it('reports a missing trace directory without crashing', async () => {
    const res = await call('codeatlas_trace', { action: 'load', path: path.join(workDir, 'nope') });
    expect(textOf(res)).toMatch(/not|exist|missing|trace/i);
  });

  it('explains a missing project instead of crashing', async () => {
    const res = await call('codeatlas_search', { query: 'anything', project: path.join(workDir, 'empty') });
    expect(textOf(res)).toMatch(/scan|index|not|no /i);
  });
});
