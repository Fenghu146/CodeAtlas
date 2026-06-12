// ============================================================
// Core type definitions for the CodeAtlas graph model
// ============================================================

/** Architectural layer classification */
export type Layer = 'interface' | 'business' | 'data' | 'utility' | 'unknown';

/** Symbol kinds extracted from AST */
export type SymbolKind =
  | 'class'
  | 'function'
  | 'method'
  | 'variable'
  | 'interface'
  | 'type'
  | 'enum'
  | 'module'
  | 'constant'
  | 'property'
  | 'namespace';

/** Relationship types between symbols */
export type RelationshipKind =
  | 'calls'          // A calls B
  | 'imports'        // A imports from B's file
  | 'extends'        // A extends B (class inheritance)
  | 'implements'     // A implements B (interface)
  | 'contains'       // A contains B (parent-child, e.g. class → method)
  | 'uses_type'      // A references B as a type
  | 'overrides'      // A overrides B
  | 'exports'        // A exports B
  | 'creates'        // A instantiates B (new B())
  | 'decorates';     // A decorates B

/** A code symbol (function, class, variable, etc.) */
export interface Symbol {
  id: string;                   // Unique ID: `${filePath}:${name}:${startLine}`
  name: string;
  kind: SymbolKind;
  filePath: string;             // Relative to project root
  startLine: number;
  endLine: number;
  startCol?: number;
  endCol?: number;
  sourceCode?: string;
  language: string;
  layer: Layer;
  docComment?: string;
  aiSummary?: string;
  complexity?: number;
  exported: boolean;
  metadata?: Record<string, unknown>;
}

/** A directed relationship between two symbols */
export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationshipKind;
  line?: number;
  metadata?: Record<string, unknown>;
}

/** File-level metadata */
export interface FileInfo {
  path: string;
  language: string;
  size: number;
  lineCount: number;
  hash: string;
  parsedAt?: string;
  /** External package imports (e.g., ['express', 'prisma']) — used for layer classification */
  imports?: string[];
  metadata?: Record<string, unknown>;
}

/** The complete code graph */
export interface CodeGraph {
  symbols: Map<string, Symbol>;
  relationships: Relationship[];
  files: Map<string, FileInfo>;

  // Convenience accessors (implemented as methods)
  getSymbolById(id: string): Symbol | undefined;
  getSymbolsByFile(filePath: string): Symbol[];
  getSymbolsByKind(kind: SymbolKind): Symbol[];
  getSymbolsByLayer(layer: Layer): Symbol[];
  getRelationshipsFrom(symbolId: string): Relationship[];
  getRelationshipsTo(symbolId: string): Relationship[];
}

/** Statistics about the graph */
export interface GraphStats {
  totalSymbols: number;
  totalRelationships: number;
  totalFiles: number;
  symbolsByKind: Record<SymbolKind, number>;
  symbolsByLayer: Record<Layer, number>;
  relationshipsByKind: Record<RelationshipKind, number>;
  languages: string[];
}
