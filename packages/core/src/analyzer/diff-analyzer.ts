// ============================================================
// Diff Analyzer - Compare graph states between scans
// ============================================================
// Shows what changed: new/removed symbols, moved functions,
// edge changes, complexity trends.

import fs from 'fs';
import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol, Relationship } from '../graph/types.js';

export interface DiffResult {
  /** Symbols added since last scan */
  added: Symbol[];
  /** Symbols removed since last scan */
  removed: Symbol[];
  /** Symbols that moved files */
  moved: Array<{ symbol: Symbol; fromFile: string; toFile: string }>;
  /** Edges added */
  edgesAdded: number;
  /** Edges removed */
  edgesRemoved: number;
  /** Complexity changes */
  complexityChanges: Array<{
    symbol: string;
    before: number;
    after: number;
    delta: number;
  }>;
  /** Summary text */
  summary: string;
}

/**
 * Compares two graph states and shows the differences.
 * Uses file hashes and symbol metadata to detect changes.
 */
export class DiffAnalyzer {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Compare current state with a baseline.
   * If no baseline file exists, compares with empty state.
   */
  analyze(baselinePath?: string): DiffResult {
    // Get current symbols
    const currentSymbols = this.store.searchSymbols('', { limit: 10000 });
    const currentSymbolMap = new Map(currentSymbols.map(s => [s.name + ':' + s.filePath, s]));

    // Get baseline symbols (from file or empty)
    const baselineSymbols = this.loadBaseline(baselinePath);
    const baselineSymbolMap = new Map(baselineSymbols.map(s => [s.name + ':' + s.filePath, s]));

    // Find added/removed/moved
    const added: Symbol[] = [];
    const removed: Symbol[] = [];
    const moved: DiffResult['moved'] = [];

    // Check for added and moved symbols
    for (const [key, current] of currentSymbolMap) {
      const baseline = baselineSymbolMap.get(key);
      if (!baseline) {
        // Check if this symbol existed in a different file (moved)
        const byName = baselineSymbols.find(s => s.name === current.name);
        if (byName) {
          moved.push({
            symbol: current,
            fromFile: byName.filePath,
            toFile: current.filePath,
          });
        } else {
          added.push(current);
        }
      }
    }

    // Check for removed symbols
    for (const [key, baseline] of baselineSymbolMap) {
      if (!currentSymbolMap.has(key)) {
        // Check if it moved to a different file
        const byName = currentSymbols.find(s => s.name === baseline.name);
        if (!byName) {
          removed.push(baseline);
        }
      }
    }

    // Edge changes (simplified - count differences)
    const currentEdgeCount = this.countEdges(currentSymbols);
    const baselineEdgeCount = this.countEdges(baselineSymbols);
    const edgesAdded = Math.max(0, currentEdgeCount - baselineEdgeCount);
    const edgesRemoved = Math.max(0, baselineEdgeCount - currentEdgeCount);

    // Complexity changes
    const complexityChanges: DiffResult['complexityChanges'] = [];
    for (const [key, current] of currentSymbolMap) {
      const baseline = baselineSymbolMap.get(key);
      if (baseline && current.complexity !== undefined && baseline.complexity !== undefined) {
        const delta = current.complexity - baseline.complexity;
        if (delta !== 0) {
          complexityChanges.push({
            symbol: current.name,
            before: baseline.complexity,
            after: current.complexity,
            delta,
          });
        }
      }
    }

    const summary = this.buildSummary(added, removed, moved, edgesAdded, edgesRemoved, complexityChanges);

    return {
      added,
      removed,
      moved,
      edgesAdded,
      edgesRemoved,
      complexityChanges,
      summary,
    };
  }

  /**
   * Save current state as baseline for future comparison.
   */
  saveBaseline(path: string): void {
    const symbols = this.store.searchSymbols('', { limit: 10000 });
    fs.writeFileSync(path, JSON.stringify(symbols, null, 2));
  }

  /**
   * Load baseline symbols from file.
   */
  private loadBaseline(path?: string): Symbol[] {
    if (!path) return [];

    try {
      const data = fs.readFileSync(path, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Count edges for a set of symbols.
   */
  private countEdges(symbols: Symbol[]): number {
    let count = 0;
    for (const sym of symbols) {
      count += this.store.getRelationshipsFrom(sym.id).length;
    }
    return count;
  }

  /**
   * Build summary text.
   */
  private buildSummary(
    added: Symbol[],
    removed: Symbol[],
    moved: DiffResult['moved'],
    edgesAdded: number,
    edgesRemoved: number,
    complexityChanges: DiffResult['complexityChanges'],
  ): string {
    const parts: string[] = [];

    parts.push('📊 Graph Diff Summary');
    parts.push('═'.repeat(40));

    if (added.length === 0 && removed.length === 0 && moved.length === 0) {
      parts.push('No structural changes detected.');
    } else {
      if (added.length > 0) {
        parts.push(`\n➕ Added (${added.length}):`);
        for (const s of added.slice(0, 10)) {
          parts.push(`  - ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`);
        }
        if (added.length > 10) parts.push(`  ... and ${added.length - 10} more`);
      }

      if (removed.length > 0) {
        parts.push(`\n➖ Removed (${removed.length}):`);
        for (const s of removed.slice(0, 10)) {
          parts.push(`  - ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`);
        }
        if (removed.length > 10) parts.push(`  ... and ${removed.length - 10} more`);
      }

      if (moved.length > 0) {
        parts.push(`\n🔄 Moved (${moved.length}):`);
        for (const m of moved.slice(0, 5)) {
          parts.push(`  - ${m.symbol.name}: ${m.fromFile} → ${m.toFile}`);
        }
      }
    }

    if (edgesAdded > 0 || edgesRemoved > 0) {
      parts.push(`\n🔗 Edge Changes: +${edgesAdded} / -${edgesRemoved}`);
    }

    if (complexityChanges.length > 0) {
      parts.push(`\n📈 Complexity Changes (${complexityChanges.length}):`);
      for (const c of complexityChanges.slice(0, 5)) {
        const arrow = c.delta > 0 ? '↑' : '↓';
        parts.push(`  - ${c.symbol}: ${c.before} → ${c.after} (${arrow}${Math.abs(c.delta)})`);
      }
    }

    return parts.join('\n');
  }
}
