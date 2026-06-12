// ============================================================
// Path Finder - Find shortest path between two symbols
// ============================================================
// Uses BFS on the relationship graph to find the shortest
// connection between any two symbols.

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol, Relationship } from '../graph/types.js';

export interface PathResult {
  /** Whether a path was found */
  found: boolean;
  /** The path of symbols from source to target */
  path: Symbol[];
  /** The relationships connecting them */
  relationships: Relationship[];
  /** Human-readable summary */
  summary: string;
}

/**
 * Finds the shortest path between two symbols in the code graph.
 * Uses BFS traversal on the relationship graph.
 */
export class PathFinder {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Find shortest path from sourceSymbol to targetSymbol.
   *
   * @param sourceId - Source symbol ID or name
   * @param targetId - Target symbol ID or name
   * @param maxDepth - Maximum path length (default: 6)
   */
  find(sourceId: string, targetId: string, maxDepth: number = 6): PathResult {
    // Resolve names to IDs if needed
    const source = this.resolveSymbol(sourceId);
    const target = this.resolveSymbol(targetId);

    if (!source) {
      return { found: false, path: [], relationships: [], summary: `Source symbol "${sourceId}" not found.` };
    }
    if (!target) {
      return { found: false, path: [], relationships: [], summary: `Target symbol "${targetId}" not found.` };
    }

    if (source.id === target.id) {
      return {
        found: true,
        path: [source],
        relationships: [],
        summary: `Source and target are the same symbol: ${source.name}`,
      };
    }

    // BFS
    const visited = new Set<string>([source.id]);
    const queue: { id: string; path: string[]; rels: Relationship[] }[] = [
      { id: source.id, path: [source.id], rels: [] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxDepth) continue;

      // Check both outgoing and incoming relationships
      const outgoing = this.store.getRelationshipsFrom(current.id);
      const incoming = this.store.getRelationshipsTo(current.id);
      const allRels = [...outgoing, ...incoming];

      for (const rel of allRels) {
        const nextId = rel.sourceId === current.id ? rel.targetId : rel.sourceId;

        if (nextId === target.id) {
          // Found the target!
          const fullPath = [...current.path, nextId];
          const fullRels = [...current.rels, rel];

          const symbols = fullPath.map(id => this.store.getSymbol(id)).filter(Boolean) as Symbol[];
          const summary = this.buildSummary(symbols, fullRels, source, target);

          return { found: true, path: symbols, relationships: fullRels, summary };
        }

        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push({
            id: nextId,
            path: [...current.path, nextId],
            rels: [...current.rels, rel],
          });
        }
      }
    }

    return {
      found: false,
      path: [],
      relationships: [],
      summary: `No path found between ${source.name} and ${target.name} (max depth: ${maxDepth}).`,
    };
  }

  private resolveSymbol(nameOrId: string): Symbol | undefined {
    // Normalize path separators
    const normalizedId = nameOrId.replace(/\\/g, '/');

    // Try direct ID first
    let sym = this.store.getSymbol(normalizedId);
    if (sym) return sym;

    // Try with original ID
    sym = this.store.getSymbol(nameOrId);
    if (sym) return sym;

    // Try searching by name
    const results = this.store.searchSymbols(nameOrId, { limit: 5 });
    if (results.length === 1) return results[0];
    if (results.length > 1) {
      // Prefer exact match
      const exact = results.find(s => s.name === nameOrId);
      if (exact) return exact;
      return results[0];
    }

    return undefined;
  }

  private buildSummary(path: Symbol[], rels: Relationship[], source: Symbol, target: Symbol): string {
    const parts: string[] = [];
    parts.push(`Path from ${source.name} to ${target.name} (${path.length} symbols, ${rels.length} hops):\n`);

    for (let i = 0; i < path.length; i++) {
      const sym = path[i];
      const rel = rels[i];
      const relStr = rel ? ` --[${rel.kind}]--> ` : '';
      const loc = `${sym.filePath}:${sym.startLine}`;
      parts.push(`  ${i === 0 ? '▶' : ' '} ${sym.name} (${sym.kind}) @ ${loc}${relStr}`);
    }

    return parts.join('\n');
  }
}
