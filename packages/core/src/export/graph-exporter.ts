// ============================================================
// Graph Exporter - Export code graph for data analysis
// ============================================================
// Supports multiple formats for mathematical modeling and visualization:
// - JSON (full graph data)
// - CSV (adjacency list for pandas/R)
// - Mermaid (diagram syntax)
// - Adjacency Matrix (for mathematical analysis)
// - Statistics (centrality, clustering, metrics)

import { SQLiteStore } from '../store/sqlite-store.js';
import type { Symbol, Relationship } from '../graph/types.js';

export type ExportFormat = 'json' | 'csv' | 'mermaid' | 'matrix' | 'stats';

export interface GraphExportOptions {
  /** Export format */
  format?: ExportFormat;
  /** Filter by layer */
  layer?: string;
  /** Filter by symbol kind */
  kind?: string;
  /** Max nodes to export */
  limit?: number;
  /** Include node attributes (source code, etc.) */
  includeAttributes?: boolean;
}

export interface GraphStats {
  /** Basic counts */
  nodes: number;
  edges: number;
  /** Density: edges / (nodes * (nodes-1)) */
  density: number;
  /** Average degree */
  avgDegree: number;
  /** Max degree */
  maxDegree: number;
  /** Degree distribution */
  degreeDistribution: Record<number, number>;
  /** Connected components */
  connectedComponents: number;
  /** Average clustering coefficient */
  avgClusteringCoefficient: number;
  /** Top central nodes (by degree) */
  centralNodes: Array<{ name: string; degree: number; betweenness?: number }>;
  /** Layer distribution */
  layerDistribution: Record<string, number>;
  /** Kind distribution */
  kindDistribution: Record<string, number>;
}

/**
 * Exports code graph data in various formats for analysis.
 */
export class GraphExporter {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Export graph data in the specified format.
   */
  export(options: GraphExportOptions): string {
    const symbols = this.getSymbols(options);
    const edges = this.getEdges(symbols);

    switch (options.format) {
      case 'json':
        return this.toJSON(symbols, edges, options);
      case 'csv':
        return this.toCSV(symbols, edges);
      case 'mermaid':
        return this.toMermaid(symbols, edges);
      case 'matrix':
        return this.toAdjacencyMatrix(symbols, edges);
      case 'stats':
        return this.toStats(symbols, edges);
      default:
        return this.toJSON(symbols, edges, options);
    }
  }

  /**
   * Get graph statistics for analysis.
   */
  getStats(options?: GraphExportOptions): GraphStats {
    const symbols = options ? this.getSymbols(options) : this.store.searchSymbols('', { limit: 10000 });
    const edges = this.getEdges(symbols);

    // Build adjacency list
    const adjList = new Map<string, Set<string>>();
    for (const sym of symbols) {
      adjList.set(sym.id, new Set());
    }
    for (const edge of edges) {
      adjList.get(edge.sourceId)?.add(edge.targetId);
      adjList.get(edge.targetId)?.add(edge.sourceId);
    }

    // Calculate degrees
    const degrees = symbols.map(s => adjList.get(s.id)?.size ?? 0);
    const maxDegree = Math.max(...degrees, 0);
    const avgDegree = degrees.length > 0 ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;

    // Degree distribution
    const degreeDistribution: Record<number, number> = {};
    for (const d of degrees) {
      degreeDistribution[d] = (degreeDistribution[d] || 0) + 1;
    }

    // Density
    const n = symbols.length;
    const maxEdges = n * (n - 1);
    const density = maxEdges > 0 ? edges.length / maxEdges : 0;

    // Connected components (BFS)
    const visited = new Set<string>();
    let components = 0;
    for (const sym of symbols) {
      if (!visited.has(sym.id)) {
        components++;
        this.bfs(sym.id, adjList, visited);
      }
    }

    // Clustering coefficient (approximate)
    const avgClustering = this.calculateClusteringCoefficient(adjList, symbols);

    // Central nodes (top 10 by degree)
    const nodeDegrees = symbols.map(s => ({
      name: s.name,
      degree: adjList.get(s.id)?.size ?? 0,
    }));
    nodeDegrees.sort((a, b) => b.degree - a.degree);
    const centralNodes = nodeDegrees.slice(0, 10);

    // Distributions
    const layerDistribution: Record<string, number> = {};
    const kindDistribution: Record<string, number> = {};
    for (const sym of symbols) {
      layerDistribution[sym.layer] = (layerDistribution[sym.layer] || 0) + 1;
      kindDistribution[sym.kind] = (kindDistribution[sym.kind] || 0) + 1;
    }

    return {
      nodes: symbols.length,
      edges: edges.length,
      density,
      avgDegree,
      maxDegree,
      degreeDistribution,
      connectedComponents: components,
      avgClusteringCoefficient: avgClustering,
      centralNodes,
      layerDistribution,
      kindDistribution,
    };
  }

  // ========================
  // Format Implementations
  // ========================

  private toJSON(symbols: Symbol[], edges: Relationship[], options: GraphExportOptions): string {
    const nodes = symbols.map(s => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      layer: s.layer,
      file: s.filePath,
      line: s.startLine,
      exported: s.exported,
      complexity: s.complexity,
      ...(options.includeAttributes ? {
        sourceCode: s.sourceCode?.substring(0, 200),
        aiSummary: s.aiSummary,
      } : {}),
    }));

    return JSON.stringify({ nodes, edges: edges.map(e => ({
      source: e.sourceId,
      target: e.targetId,
      kind: e.kind,
    }))}, null, 2);
  }

  private toCSV(symbols: Symbol[], edges: Relationship[]): string {
    const lines: string[] = [];

    // Nodes CSV
    lines.push('# Nodes');
    lines.push('id,name,kind,layer,file,line');
    for (const s of symbols) {
      lines.push(`${s.id},${s.name},${s.kind},${s.layer},${s.filePath},${s.startLine}`);
    }

    lines.push('');
    lines.push('# Edges');
    lines.push('source,target,kind');
    for (const e of edges) {
      lines.push(`${e.sourceId},${e.targetId},${e.kind}`);
    }

    return lines.join('\n');
  }

  private toMermaid(symbols: Symbol[], edges: Relationship[]): string {
    const lines: string[] = ['graph LR'];

    // Node definitions with styles
    for (const s of symbols) {
      const label = s.name.replace(/[^a-zA-Z0-9_]/g, '_');
      const shape = this.getMermaidShape(s.kind);
      lines.push(`    ${label}${shape[0]}${s.name}${shape[1]}`);
    }

    // Edge definitions
    for (const e of edges) {
      const source = symbols.find(s => s.id === e.sourceId);
      const target = symbols.find(s => s.id === e.targetId);
      if (source && target) {
        const sourceLabel = source.name.replace(/[^a-zA-Z0-9_]/g, '_');
        const targetLabel = target.name.replace(/[^a-zA-Z0-9_]/g, '_');
        const arrow = e.kind === 'calls' ? '-->' : e.kind === 'imports' ? '-.->' : '-->';
        lines.push(`    ${sourceLabel} ${arrow}|${e.kind}| ${targetLabel}`);
      }
    }

    // Style definitions
    lines.push('');
    lines.push('    classDef interface fill:#3b82f6,color:#fff');
    lines.push('    classDef business fill:#22c55e,color:#fff');
    lines.push('    classDef data fill:#f97316,color:#fff');
    lines.push('    classDef utility fill:#9ca3af,color:#fff');

    // Apply styles
    for (const s of symbols) {
      const label = s.name.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`    class ${label} ${s.layer}`);
    }

    return lines.join('\n');
  }

  private toAdjacencyMatrix(symbols: Symbol[], edges: Relationship[]): string {
    const n = symbols.length;
    const idxMap = new Map<string, number>();
    symbols.forEach((s, i) => idxMap.set(s.id, i));

    // Initialize matrix
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    // Fill matrix
    for (const e of edges) {
      const i = idxMap.get(e.sourceId);
      const j = idxMap.get(e.targetId);
      if (i !== undefined && j !== undefined) {
        matrix[i][j] = 1;
      }
    }

    // Output as CSV
    const lines: string[] = [];
    // Header
    lines.push(',' + symbols.map(s => s.name).join(','));
    // Rows
    for (let i = 0; i < n; i++) {
      lines.push(symbols[i].name + ',' + matrix[i].join(','));
    }

    return lines.join('\n');
  }

  private toStats(symbols: Symbol[], edges: Relationship[]): string {
    const stats = this.calculateStats(symbols, edges);

    const lines: string[] = [];
    lines.push('📊 Graph Statistics');
    lines.push('═'.repeat(40));
    lines.push(`Nodes: ${stats.nodes}`);
    lines.push(`Edges: ${stats.edges}`);
    lines.push(`Density: ${stats.density.toFixed(4)}`);
    lines.push(`Avg Degree: ${stats.avgDegree.toFixed(2)}`);
    lines.push(`Max Degree: ${stats.maxDegree}`);
    lines.push(`Connected Components: ${stats.connectedComponents}`);
    lines.push(`Avg Clustering: ${stats.avgClusteringCoefficient.toFixed(4)}`);
    lines.push('');
    lines.push('Top Central Nodes:');
    for (const n of stats.centralNodes) {
      lines.push(`  - ${n.name}: degree ${n.degree}`);
    }
    lines.push('');
    lines.push('Layer Distribution:');
    for (const [layer, count] of Object.entries(stats.layerDistribution)) {
      lines.push(`  - ${layer}: ${count}`);
    }
    lines.push('');
    lines.push('Kind Distribution:');
    for (const [kind, count] of Object.entries(stats.kindDistribution)) {
      lines.push(`  - ${kind}: ${count}`);
    }

    return lines.join('\n');
  }

  // ========================
  // Helper Methods
  // ========================

  private getSymbols(options: GraphExportOptions): Symbol[] {
    let symbols = this.store.searchSymbols('', { limit: options.limit ?? 10000 });

    if (options.layer) {
      symbols = symbols.filter(s => s.layer === options.layer);
    }
    if (options.kind) {
      symbols = symbols.filter(s => s.kind === options.kind);
    }

    return symbols;
  }

  private getEdges(symbols: Symbol[]): Relationship[] {
    const symbolIds = new Set(symbols.map(s => s.id));
    const edges: Relationship[] = [];

    for (const sym of symbols) {
      const outgoing = this.store.getRelationshipsFrom(sym.id);
      for (const rel of outgoing) {
        if (symbolIds.has(rel.targetId)) {
          edges.push(rel);
        }
      }
    }

    return edges;
  }

  private getMermaidShape(kind: string): [string, string] {
    switch (kind) {
      case 'class': return ['([', '])'];      // Stadium
      case 'function': return ['[', ']'];      // Rectangle
      case 'method': return ['[', ']'];        // Rectangle
      case 'interface': return ['{', '}'];     // Hexagon
      case 'enum': return ['{{', '}}'];        // Double circle
      case 'type': return ['[[', ']]'];        // Subroutine
      default: return ['(', ')'];              // Circle
    }
  }

  private bfs(start: string, adjList: Map<string, Set<string>>, visited: Set<string>): void {
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const node = queue.shift()!;
      const neighbors = adjList.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  private calculateClusteringCoefficient(adjList: Map<string, Set<string>>, symbols: Symbol[]): number {
    let totalCoeff = 0;
    let count = 0;

    for (const sym of symbols) {
      const neighbors = adjList.get(sym.id) ?? new Set();
      const k = neighbors.size;
      if (k < 2) continue;

      // Count triangles
      let triangles = 0;
      const neighborArray = Array.from(neighbors);
      for (let i = 0; i < neighborArray.length; i++) {
        for (let j = i + 1; j < neighborArray.length; j++) {
          const neighborNeighbors = adjList.get(neighborArray[i]) ?? new Set();
          if (neighborNeighbors.has(neighborArray[j])) {
            triangles++;
          }
        }
      }

      const coeff = (2 * triangles) / (k * (k - 1));
      totalCoeff += coeff;
      count++;
    }

    return count > 0 ? totalCoeff / count : 0;
  }

  private calculateStats(symbols: Symbol[], edges: Relationship[]): GraphStats {
    return this.getStats({ format: 'stats' });
  }
}
