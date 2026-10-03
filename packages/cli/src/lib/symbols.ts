// ============================================================
// Shared CLI helpers for resolving a user query to one symbol
// ============================================================
//
// Resolution order (same contract as the MCP server):
//   1. Exact symbol ID (both path separator styles)
//   2. Qualified name `Parent.member` — how users refer to methods
//   3. Name search with exact-name preference
//   4. Otherwise: a message listing the candidates to pick from

import type { SQLiteStore, Symbol } from '@codeatlas/core';

type SymbolLike = Symbol;

export type SymbolResolution =
  | { ok: true; symbol: SymbolLike }
  | { ok: false; message: string };

function candidatesLine(symbols: SymbolLike[], query: string): string {
  const formatted = symbols
    .map((s) => `- ${s.id}\n  ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`)
    .join('\n');
  return `Multiple symbols match "${query}". Use the full ID:\n${formatted}`;
}

/** Resolve `query` (ID, `Parent.member`, or bare name) to exactly one symbol. */
export function resolveSymbol(store: SQLiteStore, query: string): SymbolResolution {
  // 1. Exact ID, tolerating both path separator styles.
  for (const id of [query, query.replace(/\\/g, '/'), query.replace(/\//g, '\\')]) {
    const symbol = store.getSymbol(id) as SymbolLike | undefined;
    if (symbol) return { ok: true, symbol };
  }

  // 2. Qualified name `Parent.member`.
  const dot = query.lastIndexOf('.');
  if (dot > 0 && dot < query.length - 1) {
    const parentName = query.slice(0, dot);
    const memberName = query.slice(dot + 1);
    const matches = (store.searchSymbols(memberName, { limit: 20 }))
      .filter((s) => s.name === memberName && s.parentName === parentName);
    if (matches.length === 1) return { ok: true, symbol: matches[0] };
    if (matches.length > 1) return { ok: false, message: candidatesLine(matches, query) };
  }

  // 3. Name search — prefer an exact name match, else ask the user to disambiguate.
  const searchName = query.includes(':') ? query.split(':').pop() ?? query : query;
  const results = store.searchSymbols(searchName, { limit: 10 });
  if (results.length === 0) {
    return { ok: false, message: `No symbol matches "${query}". Try codeatlas_search to find the right name or ID.` };
  }
  const exact = results.find((s) => s.name === searchName);
  if (exact) return { ok: true, symbol: exact };
  if (results.length === 1) return { ok: true, symbol: results[0] };
  return { ok: false, message: candidatesLine(results, query) };
}