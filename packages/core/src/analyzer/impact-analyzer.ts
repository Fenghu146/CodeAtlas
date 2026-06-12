// ============================================================
// Impact Analyzer - Predicts blast radius of code changes
// ============================================================

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol, Relationship } from '../graph/types.js';

export interface ImpactResult {
  /** The root symbol being changed */
  root: Symbol;
  /** Directly affected symbols (1 hop) */
  direct: AffectedSymbol[];
  /** Transitively affected symbols (2+ hops) */
  indirect: AffectedSymbol[];
  /** Affected files */
  affectedFiles: string[];
  /** Risk assessment */
  risk: 'low' | 'medium' | 'high' | 'critical';
  /** Summary text */
  summary: string;
}

export interface AffectedSymbol {
  symbol: Symbol;
  depth: number;
  relationshipKind: string;
  path: string[];  // Chain of symbol IDs from root to this symbol
}

export interface ImpactOptions {
  /** Maximum traversal depth (default: 2) */
  maxDepth?: number;
  /** Only follow these relationship kinds (default: all) */
  followKinds?: string[];
  /** Maximum number of results per depth level */
  limitPerDepth?: number;
}

/**
 * Analyzes the impact of changing a symbol on the rest of the codebase.
 * Uses BFS traversal of the relationship graph to find all affected symbols.
 */
export class ImpactAnalyzer {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Analyze the impact of changing a symbol.
   *
   * @param symbolId - The ID of the symbol being changed
   * @param maxDepth - Maximum traversal depth (default: 2)
   * @param options - Additional options
   */
  analyze(symbolId: string, maxDepth: number = 2, options?: ImpactOptions): ImpactResult | null {
    // Try multiple ID formats (handle path separator differences)
    let root = this.store.getSymbol(symbolId);

    if (!root) {
      // Try with forward slashes
      const forwardId = symbolId.replace(/\\/g, '/');
      root = this.store.getSymbol(forwardId);
    }

    if (!root) {
      // Try with backslashes
      const backslashId = symbolId.replace(/\//g, '\\');
      root = this.store.getSymbol(backslashId);
    }

    if (!root) return null;

    // Use provided root ID (normalized)
    const rootId = root.id;
    const effectiveDepth = options?.maxDepth ?? maxDepth;
    const followKinds = options?.followKinds;
    const limitPerDepth = options?.limitPerDepth ?? 20;

    const visited = new Set<string>([rootId]);
    const queue: { id: string; depth: number; relKind: string; path: string[] }[] = [
      { id: rootId, depth: 0, relKind: 'root', path: [rootId] },
    ];

    const direct: AffectedSymbol[] = [];
    const indirect: AffectedSymbol[] = [];
    const affectedFileSet = new Set<string>();
    const depthCounters = new Map<number, number>(); // Track count per depth

    while (queue.length > 0) {
      const { id, depth, relKind, path: currentPath } = queue.shift()!;
      if (depth >= effectiveDepth) continue;

      // Check depth limit
      const currentDepthCount = depthCounters.get(depth + 1) ?? 0;
      if (currentDepthCount >= limitPerDepth) continue;

      // Find all symbols that reference this one (incoming relationships)
      const incomingRels = this.store.getRelationshipsTo(id);

      for (const rel of incomingRels) {
        // Filter by relationship kind if specified
        if (followKinds && !followKinds.includes(rel.kind)) continue;

        if (visited.has(rel.sourceId)) continue;
        visited.add(rel.sourceId);

        const sourceSymbol = this.store.getSymbol(rel.sourceId);
        if (!sourceSymbol) continue;

        const affected: AffectedSymbol = {
          symbol: sourceSymbol,
          depth: depth + 1,
          relationshipKind: rel.kind,
          path: [...currentPath, rel.sourceId],
        };

        affectedFileSet.add(sourceSymbol.filePath);
        depthCounters.set(depth + 1, (depthCounters.get(depth + 1) ?? 0) + 1);

        if (depth + 1 === 1) {
          direct.push(affected);
        } else {
          indirect.push(affected);
        }

        queue.push({
          id: rel.sourceId,
          depth: depth + 1,
          relKind: rel.kind,
          path: affected.path,
        });
      }

      // Also find symbols that this one calls (outgoing calls)
      // These are also affected because they depend on this symbol
      const outgoingRels = this.store.getRelationshipsFrom(id);
      for (const rel of outgoingRels) {
        if (rel.kind !== 'calls') continue; // Only track call relationships
        if (followKinds && !followKinds.includes(rel.kind)) continue;
        if (visited.has(rel.targetId)) continue;
        visited.add(rel.targetId);

        const targetSymbol = this.store.getSymbol(rel.targetId);
        if (!targetSymbol) continue;

        const affected: AffectedSymbol = {
          symbol: targetSymbol,
          depth: depth + 1,
          relationshipKind: `calls-by`,
          path: [...currentPath, rel.targetId],
        };

        affectedFileSet.add(targetSymbol.filePath);
        indirect.push(affected);

        queue.push({
          id: rel.targetId,
          depth: depth + 1,
          relKind: 'calls-by',
          path: affected.path,
        });
      }
    }

    // Also add the root's file
    affectedFileSet.add(root.filePath);

    // Risk assessment
    const totalAffected = direct.length + indirect.length;
    let risk: 'low' | 'medium' | 'high' | 'critical';
    if (totalAffected === 0) risk = 'low';
    else if (totalAffected <= 3) risk = 'medium';
    else if (totalAffected <= 10) risk = 'high';
    else risk = 'critical';

    // Summary
    const summary = this.buildSummary(root, direct, indirect, risk);

    return {
      root,
      direct,
      indirect,
      affectedFiles: Array.from(affectedFileSet),
      risk,
      summary,
    };
  }

  private buildSummary(
    root: Symbol,
    direct: AffectedSymbol[],
    indirect: AffectedSymbol[],
    risk: string,
  ): string {
    const parts: string[] = [];
    parts.push(`修改 ${root.name} (${root.kind}) 的影响分析:`);
    parts.push(`风险等级: ${risk}`);
    parts.push(`直接影响: ${direct.length} 个符号`);
    parts.push(`间接影响: ${indirect.length} 个符号`);

    if (direct.length > 0) {
      parts.push('\n直接受影响的:');
      for (const d of direct) {
        parts.push(`  - ${d.symbol.name} (${d.relationshipKind}) @ ${d.symbol.filePath}`);
      }
    }

    if (indirect.length > 0) {
      parts.push('\n间接受影响的:');
      for (const i of indirect) {
        parts.push(`  - ${i.symbol.name} (depth ${i.depth}) @ ${i.symbol.filePath}`);
      }
    }

    return parts.join('\n');
  }
}
