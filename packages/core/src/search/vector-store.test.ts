// ============================================================
// VectorStore persistence and lazy-loading tests
// ============================================================
// Regression guard: a fresh VectorStore must pick up persisted embeddings.
// Before the fix, every query created an empty store and the vector search
// path reported "No embeddings indexed" forever, even right after indexing.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SQLiteStore } from '../store/sqlite-store.js';
import { VectorStore } from './vector-store.js';
import { HashEmbeddingGenerator } from './embedding.js';

const tempDirs: string[] = [];

function freshStore(): SQLiteStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeatlas-vec-'));
  tempDirs.push(dir);
  return new SQLiteStore({ dbPath: path.join(dir, 'db.sqlite') });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('VectorStore', () => {
  it('persists embeddings and a fresh store sees them', async () => {
    const store = freshStore();
    store.saveGraph({
      symbols: new Map([
        ['a.ts:fn', {
          id: 'a.ts:fn', name: 'createUser', kind: 'function', filePath: 'a.ts',
          startLine: 1, endLine: 3, layer: 'business', language: 'typescript',
        } as never],
        ['b.ts:fn', {
          id: 'b.ts:fn', name: 'deleteUser', kind: 'function', filePath: 'b.ts',
          startLine: 1, endLine: 3, layer: 'business', language: 'typescript',
        } as never],
      ]),
      relationships: [],
      files: new Map(),
    } as never);

    const writer = new VectorStore(store, new HashEmbeddingGenerator(64));
    const indexed = await writer.indexAll();
    expect(indexed).toBe(2);
    expect(writer.getStats().indexed).toBe(2);

    // A brand-new store (as every query creates) must load on first read.
    const reader = new VectorStore(store, new HashEmbeddingGenerator(64));
    expect(reader.getStats().indexed).toBe(2);
    expect(reader.isIndexed('a.ts:fn')).toBe(true);
    expect(reader.getEmbedding('a.ts:fn')).toBeInstanceOf(Array);
    expect(reader.isIndexed('nonexistent')).toBe(false);
  });

  it('searches across a persisted index without re-indexing', async () => {
    const store = freshStore();
    store.saveGraph({
      symbols: new Map([
        ['u.ts:fn', {
          id: 'u.ts:fn', name: 'registerUser', kind: 'function', filePath: 'u.ts',
          startLine: 1, endLine: 3, layer: 'business', language: 'typescript',
        } as never],
        ['p.ts:fn', {
          id: 'p.ts:fn', name: 'computeHash', kind: 'function', filePath: 'p.ts',
          startLine: 1, endLine: 3, layer: 'utility', language: 'typescript',
        } as never],
      ]),
      relationships: [],
      files: new Map(),
    } as never);

    await new VectorStore(store, new HashEmbeddingGenerator(64)).indexAll();

    const searcher = new VectorStore(store, new HashEmbeddingGenerator(64));
    const results = await searcher.search('user registration', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('reports an empty index when nothing was ever persisted', () => {
    const store = freshStore();
    const vs = new VectorStore(store, new HashEmbeddingGenerator(64));
    expect(vs.getStats().indexed).toBe(0);
  });
});