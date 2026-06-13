// ============================================================
// Shared types and helpers for Copilot analysis flows
// ============================================================

import type { Symbol } from '../../graph/types.js';
import { SQLiteStore } from '../../store/sqlite-store.js';
import type { Intent } from '../intents.js';

// ========================
// Public Types
// ========================

export interface FlowResult {
  answer: string;
  symbols: Array<{ name: string; kind: string; file: string; id: string }>;
  conclusions: string[];
}

export interface FlowContext {
  store: SQLiteStore;
  projectPath: string;
}

// ========================
// Symbol Helpers
// ========================

/**
 * Score a symbol match against a query target.
 * Returns 0-1 score where higher is better.
 */
export function scoreSymbolMatch(symbol: Symbol, target: string, keywords: string[]): number {
  let score = 0;
  const targetLower = target.toLowerCase();
  const nameLower = symbol.name.toLowerCase();

  // Exact name match
  if (nameLower === targetLower) score += 1.0;
  // Name contains target
  else if (nameLower.includes(targetLower)) score += 0.7;
  // Target contains name (e.g., query "UserRepositoryFindById" matches symbol "UserRepository")
  else if (targetLower.includes(nameLower)) score += 0.5;

  // Fuzzy: check keyword overlap via CamelCase/underscore split
  const nameWords = symbol.name.split(/(?=[A-Z])|[_\-]/).map(w => w.toLowerCase());
  for (const kw of keywords) {
    if (nameWords.some(w => w.includes(kw.toLowerCase()))) score += 0.15;
  }

  // Prefer exported symbols (more likely to be the intended public API)
  if (symbol.exported) score += 0.1;

  // Prefer business layer over utility (more interesting to users)
  if (symbol.layer === 'business') score += 0.05;

  return Math.min(score, 1.0);
}

/** Resolve a symbol from the intent's target field, with fallback to keyword search */
export function resolveTarget(store: SQLiteStore, intent: Intent): Symbol | null {
  if (!intent.target) {
    const found = resolveTargetsFromKeywords(store, intent.keywords, 1);
    return found[0] ?? null;
  }

  // Strategy 1: Exact name match
  let sym = store.getSymbol(intent.target);
  if (sym) return sym;

  // Strategy 2: Case-insensitive exact match
  const allSymbols = store.searchSymbols(intent.target, { limit: 10 });
  const caseInsensitiveExact = allSymbols.find(
    s => s.name.toLowerCase() === intent.target!.toLowerCase()
  );
  if (caseInsensitiveExact) return caseInsensitiveExact;

  // Strategy 3: Score-based ranking
  if (allSymbols.length === 1) return allSymbols[0];
  if (allSymbols.length > 1) {
    const scored = allSymbols.map(s => ({
      symbol: s,
      score: scoreSymbolMatch(s, intent.target!, intent.keywords),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].symbol;
  }

  return null;
}

/** Resolve a symbol by name string (without intent) */
export function resolveTargetByName(store: SQLiteStore, name: string): Symbol | null {
  let sym = store.getSymbol(name);
  if (sym) return sym;

  const results = store.searchSymbols(name, { limit: 10 });
  const caseInsensitive = results.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (caseInsensitive) return caseInsensitive;

  if (results.length === 1) return results[0];
  if (results.length > 1) {
    const scored = results.map(s => ({
      symbol: s,
      score: scoreSymbolMatch(s, name, []),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].symbol;
  }

  return null;
}

/** Search symbols by keywords */
export function resolveTargetsFromKeywords(store: SQLiteStore, keywords: string[], count: number): Symbol[] {
  const results: Symbol[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    const matches = store.searchSymbols(kw, { limit: 3 });
    for (const m of matches) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        results.push(m);
      }
    }
    if (results.length >= count) break;
  }

  return results.slice(0, count);
}

/** Convert Symbol[] to lightweight symbol refs (deduplicated) */
export function toSymbolRefs(symbols: Symbol[]): Array<{ name: string; kind: string; file: string; id: string }> {
  const seen = new Set<string>();
  const result: Array<{ name: string; kind: string; file: string; id: string }> = [];
  for (const s of symbols) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      result.push({ name: s.name, kind: s.kind, file: s.filePath, id: s.id });
    }
  }
  return result;
}

/** Generate "not found" response */
export function notFound(intent: Intent): FlowResult {
  const query = intent.target ?? intent.keywords.join(' ');
  return {
    answer: `❓ Symbol "${query}" not found in the code graph.\n\n💡 Tips:\n  • Check the spelling\n  • Try a shorter name (e.g., "User" instead of "UserService")\n  • Run codeatlas_scan first to build the graph`,
    symbols: [],
    conclusions: ['Symbol not found'],
  };
}
