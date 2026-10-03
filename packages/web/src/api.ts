// ============================================================
// Graph data loading for the CodeAtlas web UI
// ============================================================
//
// Loading policy (in order):
//   1. `/api/graph` — when the UI is served by `codeatlas serve`
//   2. `?data=<url>` — when the graph is opened as a static page
//
// Everything is injectable so the policy is unit-testable: nothing touches the
// DOM or globals at import time.

export interface GraphData {
  nodes: unknown[];
  edges: unknown[];
}

export interface FetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type FetchLike = (input: string) => Promise<FetchResponse>;

export interface LoadOptions {
  /** Fetch implementation (defaults to global `fetch`). */
  fetch?: FetchLike;
  /** `location.search` to read the `data` parameter from (defaults to the page). */
  search?: string;
}

/**
 * Load graph data from the serve API or a `?data=` URL.
 * Returns `null` when neither source is available.
 */
export async function loadGraphData(options: LoadOptions = {}): Promise<GraphData | null> {
  const doFetch: FetchLike = options.fetch ?? ((input) => fetch(input));
  const search = options.search ?? (typeof location !== 'undefined' ? location.search : '');

  // 1. Served by `codeatlas serve`.
  try {
    const response = await doFetch('/api/graph');
    if (response.ok) {
      return (await response.json()) as GraphData;
    }
  } catch {
    // Not running via serve — fall through to the URL parameter.
  }

  // 2. Static page with ?data=<url>.
  const dataUrl = new URLSearchParams(search).get('data');
  if (dataUrl) {
    try {
      const response = await doFetch(dataUrl);
      return (await response.json()) as GraphData;
    } catch (err) {
      console.error('Failed to load graph data from URL:', err);
    }
  }

  return null;
}