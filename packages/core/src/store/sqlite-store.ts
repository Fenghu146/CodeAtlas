// ============================================================
// SQLite Storage - Persists the code graph to a local SQLite DB
// ============================================================
// Uses Node.js built-in node:sqlite (Node 24+) — zero external dependencies.
// No WASM overhead, no native addon compilation, direct disk I/O.

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import type { Symbol, Relationship, FileInfo, CodeGraph, Layer, SymbolKind, RelationshipKind } from '../graph/types.js';
import { AnnotationStore } from './annotation-store.js';
import { ProjectMetaStore } from './project-meta-store.js';
import { FileStore } from './file-store.js';

export interface StoreConfig {
  dbPath: string;  // Path to the .sqlite file
}

/**
 * SQLite-backed storage for the code graph.
 * 
 * Uses Node.js built-in node:sqlite (Node 24+) — zero external dependencies.
 * No WASM overhead, no native addon compilation, direct disk I/O.
 */
export class SQLiteStore {
  private db: DatabaseSync;
  private dbPath: string;
  private _annotations: AnnotationStore;
  private _meta: ProjectMetaStore;
  private _files: FileStore;

  /**
   * Create a new SQLiteStore backed by Node.js built-in node:sqlite.
   * Synchronous constructor — no WASM loading overhead.
   */
  constructor(config: StoreConfig) {
    this.dbPath = config.dbPath;

    // Ensure directory exists
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(config.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA cache_size = -64000');
    this.db.exec('PRAGMA synchronous = NORMAL');

    this._annotations = new AnnotationStore(this);
    this._meta = new ProjectMetaStore(this);
    this._files = new FileStore(this);

    this.initSchema();
  }

  /** Access annotation operations */
  get annotations(): AnnotationStore {
    return this._annotations;
  }

  /** Access project metadata operations */
  get meta(): ProjectMetaStore {
    return this._meta;
  }

  /** Access file operations */
  get files(): FileStore {
    return this._files;
  }

  /** Create tables if they don't exist */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symbols (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        start_line  INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        start_col   INTEGER,
        end_col     INTEGER,
        source_code TEXT,
        language    TEXT NOT NULL,
        layer       TEXT DEFAULT 'unknown',
        doc_comment TEXT,
        ai_summary  TEXT,
        complexity  INTEGER,
        exported    INTEGER DEFAULT 0,
        metadata    TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_layer ON symbols(layer)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)');

    // Migration: Add imports column to files table if it doesn't exist
    this.migrateFilesTable();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relationships (
        id          TEXT PRIMARY KEY,
        source_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        target_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        line        INTEGER,
        metadata    TEXT
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_rel_kind ON relationships(kind)');

    // Files table (delegated to FileStore)
    this._files.initSchema();

    // Project metadata table (delegated to ProjectMetaStore)
    this._meta.initSchema();

    // Annotations table (delegated to AnnotationStore)
    this._annotations.initSchema();

    // Indexes for symbol search
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_layer ON symbols(layer)');
    } catch {
      // Indexes may already exist
    }
  }

  // ========================
  // Migrations
  // ========================

  /** Migrate files table to add imports column */
  private migrateFilesTable(): void {
    try {
      // Check if imports column exists
      const columns = this.queryAll("PRAGMA table_info(files)");
      const hasImports = columns.some((col: any) => col.name === 'imports');

      if (!hasImports) {
        this.db.exec('ALTER TABLE files ADD COLUMN imports TEXT');
      }
    } catch {
      // Table might not exist yet, skip migration
    }
  }

  // ========================
  // Query Helpers
  // ========================

  /** Run a SELECT and return array of row objects */
  private queryAll(sql: string, params: any[] = []): Record<string, any>[] {
    try {
      const stmt = this.db.prepare(sql);
      if (params.length > 0) return stmt.all(...params) as Record<string, any>[];
      return stmt.all() as Record<string, any>[];
    } catch (err) {
      throw err;
    }
  }

  /** Run a SELECT and return first row object or undefined */
  private queryOne(sql: string, params: any[] = []): Record<string, any> | undefined {
    try {
      return this.db.prepare(sql).get(...params) as Record<string, any> | undefined;
    } catch {
      return undefined;
    }
  }

  /** Run a write statement */
  private run(sql: string, params: any[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  // ========================
  // Symbol Operations
  // ========================

  /** Insert or update a symbol */
  upsertSymbol(symbol: Symbol): void {
    // Delete existing if present (simulates ON CONFLICT DO UPDATE)
    this.run('DELETE FROM symbols WHERE id = ?', [symbol.id]);
    this.run(`
      INSERT INTO symbols (id, name, kind, file_path, start_line, end_line, start_col, end_col,
                           source_code, language, layer, doc_comment, ai_summary, complexity, exported, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      symbol.id,
      symbol.name,
      symbol.kind,
      symbol.filePath,
      symbol.startLine,
      symbol.endLine,
      symbol.startCol ?? null,
      symbol.endCol ?? null,
      symbol.sourceCode ?? null,
      symbol.language,
      symbol.layer,
      symbol.docComment ?? null,
      symbol.aiSummary ?? null,
      symbol.complexity ?? null,
      symbol.exported ? 1 : 0,
      symbol.metadata ? JSON.stringify(symbol.metadata) : null,
    ]);
  }

  /** Get a symbol by ID */
  getSymbol(id: string): Symbol | undefined {
    const row = this.queryOne('SELECT * FROM symbols WHERE id = ?', [id]);
    return row ? this.rowToSymbol(row) : undefined;
  }

  /** Search symbols by name (LIKE-based, always available) */
  searchSymbols(query: string, options?: { kind?: SymbolKind; layer?: Layer; limit?: number }): Symbol[] {
    const limit = options?.limit ?? 50;
    const like = `%${query}%`;
    let rows = this.queryAll(`
      SELECT * FROM symbols
      WHERE name LIKE ? OR doc_comment LIKE ?
      ORDER BY name
      LIMIT ?
    `, [like, like, limit]);

    // Apply additional filters
    if (options?.kind) rows = rows.filter(r => r.kind === options.kind);
    if (options?.layer) rows = rows.filter(r => r.layer === options.layer);

    return rows.map(r => this.rowToSymbol(r));
  }

  /** Get symbols by file path */
  getSymbolsByFile(filePath: string): Symbol[] {
    const rows = this.queryAll('SELECT * FROM symbols WHERE file_path = ? ORDER BY start_line', [filePath]);
    return rows.map(r => this.rowToSymbol(r));
  }

  /** Get symbols by layer */
  getSymbolsByLayer(layer: Layer): Symbol[] {
    const rows = this.queryAll('SELECT * FROM symbols WHERE layer = ? ORDER BY file_path, start_line', [layer]);
    return rows.map(r => this.rowToSymbol(r));
  }

  /** Delete all symbols and their relationships belonging to a file */
  deleteSymbolsByFile(filePath: string): number {
    // First delete relationships involving symbols in this file
    this.run(`
      DELETE FROM relationships
      WHERE source_id IN (SELECT id FROM symbols WHERE file_path = ?)
         OR target_id IN (SELECT id FROM symbols WHERE file_path = ?)
    `, [filePath, filePath]);

    // Then delete the symbols
    const before = this.queryOne('SELECT COUNT(*) as count FROM symbols WHERE file_path = ?', [filePath]);
    this.run('DELETE FROM symbols WHERE file_path = ?', [filePath]);
    const after = this.queryOne('SELECT COUNT(*) as count FROM symbols WHERE file_path = ?', [filePath]);
    /* persist no longer needed — node:sqlite writes directly to disk */
    return (before?.count ?? 0) - (after?.count ?? 0);
  }

  // ========================
  // Relationship Operations
  // ========================

  /** Insert a relationship */
  insertRelationship(rel: Relationship): void {
    // INSERT OR IGNORE
    const existing = this.queryOne('SELECT id FROM relationships WHERE id = ?', [rel.id]);
    if (!existing) {
      this.run(`
        INSERT INTO relationships (id, source_id, target_id, kind, line, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        rel.id,
        rel.sourceId,
        rel.targetId,
        rel.kind,
        rel.line ?? null,
        rel.metadata ? JSON.stringify(rel.metadata) : null,
      ]);
    }
  }

  /** Get callers of a symbol (who calls this?) */
  getCallers(symbolId: string): Symbol[] {
    const rows = this.queryAll(`
      SELECT s.* FROM symbols s
      JOIN relationships r ON r.source_id = s.id
      WHERE r.target_id = ? AND r.kind = 'calls'
    `, [symbolId]);
    return rows.map(r => this.rowToSymbol(r));
  }

  /** Get callees of a symbol (who does this call?) */
  getCallees(symbolId: string): Symbol[] {
    const rows = this.queryAll(`
      SELECT s.* FROM symbols s
      JOIN relationships r ON r.target_id = s.id
      WHERE r.source_id = ? AND r.kind = 'calls'
    `, [symbolId]);
    return rows.map(r => this.rowToSymbol(r));
  }

  /** Get all relationships from a symbol */
  getRelationshipsFrom(symbolId: string): Relationship[] {
    const rows = this.queryAll('SELECT * FROM relationships WHERE source_id = ?', [symbolId]);
    return rows.map(r => this.rowToRelationship(r));
  }

  /** Get all relationships to a symbol */
  getRelationshipsTo(symbolId: string): Relationship[] {
    const rows = this.queryAll('SELECT * FROM relationships WHERE target_id = ?', [symbolId]);
    return rows.map(r => this.rowToRelationship(r));
  }

  /** Get count of relationships by kind */
  getRelationshipsByKind(kind: string): number {
    const row = this.queryOne('SELECT COUNT(*) as count FROM relationships WHERE kind = ?', [kind]);
    return row?.count ?? 0;
  }

  /**
   * Impact analysis: find all symbols transitively connected to the given symbol.
   * BFS traversal up to maxDepth levels.
   */
  getImpact(symbolId: string, maxDepth: number = 3): { symbol: Symbol; depth: number }[] {
    const visited = new Set<string>([symbolId]);
    const queue: { id: string; depth: number }[] = [{ id: symbolId, depth: 0 }];
    const result: { symbol: Symbol; depth: number }[] = [];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const rels = this.getRelationshipsTo(id);
      for (const rel of rels) {
        if (!visited.has(rel.sourceId)) {
          visited.add(rel.sourceId);
          const sym = this.getSymbol(rel.sourceId);
          if (sym) {
            result.push({ symbol: sym, depth: depth + 1 });
            queue.push({ id: rel.sourceId, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  // ========================
  // File Operations (delegated to FileStore)
  // ========================

  upsertFile(file: FileInfo): void {
    this._files.upsertFile(file);
  }

  getFile(filePath: string): FileInfo | undefined {
    return this._files.getFile(filePath);
  }

  getFileHash(filePath: string): string | undefined {
    return this._files.getFileHash(filePath);
  }

  // ========================
  // Batch Operations
  // ========================

  /** Get caller counts for multiple symbols in a single query */
  getCallerCounts(symbolIds: string[]): Map<string, number> {
    if (symbolIds.length === 0) return new Map();
    const placeholders = symbolIds.map(() => '?').join(',');
    const rows = this.queryAll(
      `SELECT target_id, COUNT(*) as count FROM relationships
       WHERE target_id IN (${placeholders}) AND kind = 'calls'
       GROUP BY target_id`,
      symbolIds
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.target_id, row.count);
    }
    return counts;
  }

  /** Get callee counts for multiple symbols in a single query */
  getCalleeCounts(symbolIds: string[]): Map<string, number> {
    if (symbolIds.length === 0) return new Map();
    const placeholders = symbolIds.map(() => '?').join(',');
    const rows = this.queryAll(
      `SELECT source_id, COUNT(*) as count FROM relationships
       WHERE source_id IN (${placeholders}) AND kind = 'calls'
       GROUP BY source_id`,
      symbolIds
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.source_id, row.count);
    }
    return counts;
  }

  // ========================
  // Stats
  // ========================

  /** Get files sorted by parsed_at (most recent first) */
  getRecentFiles(limit: number = 10): FileInfo[] {
    return this._files.getRecentFiles(limit);
  }

  getStats() {
    const symbolRow = this.queryOne('SELECT COUNT(*) as count FROM symbols');
    const relRow = this.queryOne('SELECT COUNT(*) as count FROM relationships');
    const fileRow = this.queryOne('SELECT COUNT(*) as count FROM files');
    const languages = this.queryAll('SELECT DISTINCT language FROM files');

    return {
      symbols: symbolRow?.count ?? 0,
      relationships: relRow?.count ?? 0,
      files: fileRow?.count ?? 0,
      languages: languages.map(r => r.language),
    };
  }

  // ========================
  // Project Metadata (delegated to ProjectMetaStore)
  // ========================

  /** Get project metadata value */
  getMeta(key: string): string | undefined {
    return this._meta.getMeta(key);
  }

  /** Set metadata value */
  setMeta(key: string, value: string): void {
    this._meta.setMeta(key, value);
  }

  /** Get last scan info */
  getLastScanInfo(): { path?: string; timestamp?: string; languages?: string[] } {
    return this._meta.getLastScanInfo();
  }

  /** Save scan info */
  saveScanInfo(projectPath: string, languages: string[]): void {
    this._meta.saveScanInfo(projectPath, languages);
  }

  // ========================
  // Bulk Operations — Streaming Batch API
  // ========================

  /** Prepare store for a large bulk insert session (call before batch ops) */
  beginBulkInsert(): void {
    try {
      this.db.exec('PRAGMA synchronous = OFF');
      this.db.exec('PRAGMA cache_size = -64000');
    } catch { /* pragma may fail */ }
    this.run('BEGIN TRANSACTION');
  }

  /** Finalize a bulk insert session (call after all batch ops) */
  endBulkInsert(): void {
    this.run('COMMIT');
    try { this.db.exec('DROP TABLE IF EXISTS symbols_fts'); } catch { /* ignore */ }
  }

  /** Insert or replace a single symbol (ON CONFLICT → overwrite) */
  saveSymbol(symbol: Symbol): void {
    this.run(`
      INSERT INTO symbols (id, name, kind, file_path, start_line, end_line, start_col, end_col,
                           source_code, language, layer, doc_comment, ai_summary, complexity, exported, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, kind=excluded.kind, source_code=excluded.source_code,
        layer=excluded.layer, complexity=excluded.complexity
    `, [
      symbol.id, symbol.name, symbol.kind, symbol.filePath,
      symbol.startLine, symbol.endLine, symbol.startCol ?? null, symbol.endCol ?? null,
      symbol.sourceCode ?? null, symbol.language, symbol.layer,
      symbol.docComment ?? null, symbol.aiSummary ?? null,
      symbol.complexity ?? null, symbol.exported ? 1 : 0,
      symbol.metadata ? JSON.stringify(symbol.metadata) : null,
    ]);
  }

  /** Insert a single relationship (duplicates ignored) */
  saveRelationship(rel: Relationship): void {
    this.run(`
      INSERT OR IGNORE INTO relationships (id, source_id, target_id, kind, line, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      rel.id, rel.sourceId, rel.targetId, rel.kind,
      rel.line ?? null, rel.metadata ? JSON.stringify(rel.metadata) : null,
    ]);
  }

  /** Upsert a single file record */
  saveFile(file: FileInfo): void {
    this.run(`
      INSERT INTO files (path, language, size, line_count, hash, parsed_at, imports, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        language=excluded.language, size=excluded.size, line_count=excluded.line_count,
        hash=excluded.hash, parsed_at=excluded.parsed_at,
        imports=excluded.imports, metadata=excluded.metadata
    `, [
      file.path, file.language, file.size, file.lineCount,
      file.hash, file.parsedAt ?? null,
      file.imports ? JSON.stringify(file.imports) : null,
      file.metadata ? JSON.stringify(file.metadata) : null,
    ]);
  }

  /** Save an entire graph to the store (bulk, for backward compatibility) */
  saveGraph(graph: CodeGraph): void {
    this.beginBulkInsert();
    try {
      for (const symbol of graph.symbols.values()) this.saveSymbol(symbol);
      for (const rel of graph.relationships) this.saveRelationship(rel);
      for (const file of graph.files.values()) this.saveFile(file);
    } catch (err) {
      this.run('ROLLBACK');
      throw err;
    }
    this.endBulkInsert();
  }

  // ========================
  // Annotation Operations (delegated to AnnotationStore)
  // ========================

  /** Add an annotation to a symbol */
  addAnnotation(symbolId: string, userId: string, content: string, type: string = 'comment'): string {
    const id = this._annotations.addAnnotation(symbolId, userId, content, type);
    /* persist no longer needed — node:sqlite writes directly to disk */
    return id;
  }

  /** Get all annotations for a symbol */
  getAnnotations(symbolId: string): any[] {
    return this._annotations.getAnnotations(symbolId);
  }

  /** Get all annotations by a user */
  getAnnotationsByUser(userId: string): any[] {
    return this._annotations.getAnnotationsByUser(userId);
  }

  /** Update an annotation */
  updateAnnotation(id: string, content: string): void {
    this._annotations.updateAnnotation(id, content);
    /* persist no longer needed — node:sqlite writes directly to disk */
  }

  /** Delete an annotation */
  deleteAnnotation(id: string): void {
    this._annotations.deleteAnnotation(id);
    /* persist no longer needed — node:sqlite writes directly to disk */
  }

  /** Mark annotation as resolved/unresolved */
  resolveAnnotation(id: string, resolved: boolean): void {
    this._annotations.resolveAnnotation(id, resolved);
    /* persist no longer needed — node:sqlite writes directly to disk */
  }

  /** Get annotation count per symbol */
  getAnnotationCounts(): Map<string, number> {
    return this._annotations.getAnnotationCounts();
  }

  // ========================
  // Vector/Embedding Operations
  // ========================

  /** Execute raw SQL query (for internal use by sub-stores) */
  executeQuery(sql: string, params: any[] = []): Record<string, any>[] {
    return this.queryAll(sql, params);
  }

  /** Execute raw SQL statement (writes with params) */
  executeStatement(sql: string, params: any[] = []): void {
    this.run(sql, params);
  }

  /** Execute raw DDL (no params, for schema creation) */
  executeExec(sql: string): void {
    this.db.exec(sql);
  }

  /** Clear all data */
  clear(): void {
    this.db.exec('DELETE FROM relationships');
    this.db.exec('DELETE FROM symbols');
    this.db.exec('DELETE FROM files');
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  // ========================
  // Helpers
  // ========================

  private rowToRelationship(row: any): Relationship {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      kind: row.kind as RelationshipKind,
      line: row.line,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToSymbol(row: any): Symbol {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as SymbolKind,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      startCol: row.start_col,
      endCol: row.end_col,
      sourceCode: row.source_code,
      language: row.language,
      layer: row.layer as Layer,
      docComment: row.doc_comment,
      aiSummary: row.ai_summary,
      complexity: row.complexity,
      exported: !!row.exported,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
