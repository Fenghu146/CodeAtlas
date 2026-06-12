// ============================================================
// Flow Analyzer - Call chain tracer
// ============================================================
// Traces complete call chains from entry points using DFS

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol } from '../graph/types.js';

export interface FlowNode {
  symbol: Symbol;
  depth: number;
  children: FlowNode[];
  callCount: number;
}

export interface FlowResult {
  entry: Symbol;
  tree: FlowNode;
  totalNodes: number;
  maxDepth: number;
  path: string[];
}

/**
 * Traces call chains from an entry point using DFS
 */
export class FlowAnalyzer {
  private store: SQLiteStore;
  private visited = new Set<string>();
  private maxDepth: number;

  constructor(store: SQLiteStore, maxDepth: number = 5) {
    this.store = store;
    this.maxDepth = maxDepth;
  }

  /**
   * Trace call chain from an entry point
   */
  trace(entryId: string): FlowResult | null {
    const entry = this.store.getSymbol(entryId);
    if (!entry) return null;

    this.visited.clear();
    const tree = this.buildTree(entryId, 0, []);

    if (!tree) return null;

    return {
      entry,
      tree,
      totalNodes: this.countNodes(tree),
      maxDepth: this.getMaxDepth(tree),
      path: [entry.name],
    };
  }

  /**
   * Build call tree recursively
   */
  private buildTree(symbolId: string, depth: number, path: string[]): FlowNode | null {
    if (depth >= this.maxDepth || this.visited.has(symbolId)) {
      return null;
    }

    this.visited.add(symbolId);
    const symbol = this.store.getSymbol(symbolId);
    if (!symbol) return null;

    const callees = this.store.getCallees(symbolId);
    const children: FlowNode[] = [];

    for (const callee of callees) {
      const child = this.buildTree(callee.id, depth + 1, [...path, symbol.name]);
      if (child) {
        children.push(child);
      }
    }

    return {
      symbol,
      depth,
      children,
      callCount: callees.length,
    };
  }

  /**
   * Count total nodes in tree
   */
  private countNodes(node: FlowNode | null): number {
    if (!node) return 0;
    let count = 1;
    for (const child of node.children) {
      count += this.countNodes(child);
    }
    return count;
  }

  /**
   * Get max depth of tree
   */
  private getMaxDepth(node: FlowNode | null): number {
    if (!node) return 0;
    let maxDepth = node.depth;
    for (const child of node.children) {
      const childDepth = this.getMaxDepth(child);
      if (childDepth > maxDepth) {
        maxDepth = childDepth;
      }
    }
    return maxDepth;
  }

  /**
   * Format as text tree
   */
  static formatAsText(result: FlowResult): string {
    const lines: string[] = [];
    lines.push(`📞 Call Chain: ${result.entry.name}`);
    lines.push('═'.repeat(50));
    lines.push(`Entry: ${result.entry.name} (${result.entry.kind}) @ ${result.entry.filePath}:${result.entry.startLine}`);
    lines.push(`Total nodes: ${result.totalNodes}`);
    lines.push(`Max depth: ${result.maxDepth}`);
    lines.push('');

    this.formatNode(result.tree, lines, '', true);

    return lines.join('\n');
  }

  private static formatNode(node: FlowNode, lines: string[], prefix: string, isLast: boolean): void {
    const connector = isLast ? '└── ' : '├── ';
    const name = node.symbol.name;
    const kind = node.symbol.kind;
    const file = node.symbol.filePath.split('/').pop();

    lines.push(`${prefix}${connector}${name} (${kind}) @ ${file}:${node.symbol.startLine}`);

    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < node.children.length; i++) {
      this.formatNode(node.children[i], lines, newPrefix, i === node.children.length - 1);
    }
  }

  /**
   * Format as Mermaid sequence diagram
   */
  static formatAsMermaid(result: FlowResult): string {
    const lines: string[] = [];
    lines.push('```mermaid');
    lines.push('sequenceDiagram');
    lines.push(`    participant ${result.entry.name}`);

    this.addMermaidSequence(result.tree, lines, result.entry.name);

    lines.push('```');
    return lines.join('\n');
  }

  private static addMermaidSequence(node: FlowNode, lines: string[], from: string): void {
    for (const child of node.children) {
      lines.push(`    ${from}->>+${child.symbol.name}: call`);
      this.addMermaidSequence(child, lines, child.symbol.name);
      lines.push(`    ${child.symbol.name}-->>-${from}: return`);
    }
  }
}
