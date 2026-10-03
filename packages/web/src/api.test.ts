// ============================================================
// Web UI data-loading policy tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { loadGraphData, type FetchLike, type FetchResponse } from './api.js';

function stubFetch(routes: Record<string, { ok: boolean; body?: unknown; throws?: boolean }>): FetchLike {
  return async (input: string): Promise<FetchResponse> => {
    const route = routes[input];
    if (!route) return { ok: false, json: async () => ({}) };
    if (route.throws) throw new Error(`network error for ${input}`);
    return { ok: route.ok, json: async () => route.body ?? {} };
  };
}

describe('loadGraphData', () => {
  it('prefers the serve API when it responds', async () => {
    const data = await loadGraphData({
      fetch: stubFetch({ '/api/graph': { ok: true, body: { nodes: [1], edges: [] } } }),
      search: '?data=https://example.com/graph.json',
    });
    expect(data).toEqual({ nodes: [1], edges: [] });
  });

  it('falls back to the ?data= URL when the API is unavailable', async () => {
    const data = await loadGraphData({
      fetch: stubFetch({
        '/api/graph': { ok: false },
        'https://example.com/graph.json': { ok: true, body: { nodes: [], edges: [1] } },
      }),
      search: '?data=https://example.com/graph.json',
    });
    expect(data).toEqual({ nodes: [], edges: [1] });
  });

  it('falls back when the API request throws', async () => {
    const data = await loadGraphData({
      fetch: stubFetch({
        '/api/graph': { ok: false, throws: true },
        'graph.json': { ok: true, body: { nodes: [2], edges: [] } },
      }),
      search: '?data=graph.json',
    });
    expect(data).toEqual({ nodes: [2], edges: [] });
  });

  it('returns null when no source is available', async () => {
    const data = await loadGraphData({
      fetch: stubFetch({ '/api/graph': { ok: false } }),
      search: '',
    });
    expect(data).toBeNull();
  });

  it('returns null when the data URL also fails to load', async () => {
    const data = await loadGraphData({
      fetch: stubFetch({
        '/api/graph': { ok: false },
        'broken.json': { ok: false, throws: true },
      }),
      search: '?data=broken.json',
    });
    expect(data).toBeNull();
  });
});