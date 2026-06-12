// ============================================================
// SQLite Storage - Persists the code graph to a local SQLite DB
// ============================================================
// Uses sql.js (SQLite compiled to WASM) for zero-dependency,
// cross-platform SQLite access. Includes FTS5 for full-text search.

import initSqlJs, { type Database } from 'sql.js';
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
 * Uses sql.js (pure WASM SQLite) for zero native-dependency operation.
 * Must call `await SQLiteStore.create(config)` instead of `new SQLiteStore(config)`.
 */
export class SQLiteStore {
  private db: Database;
  private dbPath: string;
  private dirty = false;
  private _annotations: AnnotationStore;
  private _meta: ProjectMetaStore;
  private _files: FileStore;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
    this._annotations = new AnnotationStore(db);
    this._meta = new ProjectMetaStore(db);
    this._files = new FileStore(db);
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

  /**
   * Async factory - creates and initializes a SQLiteStore.
   * sql.js requires async WASM initialization before use.
   */
  static async create(config: StoreConfig): Promise<SQLiteStore> {
    const SQL = await initSqlJs();
    
    // Ensure directory exists
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let db: Database;
    if (fs.existsSync(config.dbPath)) {
      const buffer = fs.readFileSync(config.dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA foreign_keys = ON');
    // Enable WAL mode for better write performance (3-5x faster)
    db.run('PRAGMA journal_mode = WAL');
    // Increase cache size for better performance
    db.run('PRAGMA cache_size = -64000'); // 64MB cache
    // Disable synchronous for faster writes (safe with WAL)
    db.run('PRAGMA synchronous = NORMAL');

    const store = new SQLiteStore(db, config.dbPath);
    store.initSchema();
    return store;
  }

  /** Create tables if they don't exist */
  private initSchema(): void {
    this.db.run(`
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

    this.db.run('CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_symbols_layer ON symbols(layer)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)');

    // Migration: Add imports column to files table if it doesn't exist
    this.migrateFilesTable();

    this.db.run(`
      CREATE TABLE IF NOT EXISTS relationships (
        id          TEXT PRIMARY KEY,
        source_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        target_id   TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        line        INTEGER,
        metadata    TEXT
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_rel_kind ON relationships(kind)');

    // Files table (delegated to FileStore)
    this._files.initSchema();

    // Project metadata table (delegated to ProjectMetaStore)
    this._meta.initSchema();

    // Annotations table (delegated to AnnotationStore)
    this._annotations.initSchema();

    // FTS5 index
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
          name, doc_comment, source_code, ai_summary,
          content='symbols',
          content_rowid='rowid',
          tokenize='porter unicode61'
        )
      `);

      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
          INSERT INTO symbols_fts(rowid, name, doc_comment, source_code, ai_summary)
          VALUES (new.rowid, new.name, new.doc_comment, new.source_code, new.ai_summary);
        END
      `);

      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
          INSERT INTO symbols_fts(symbols_fts, rowid, name, doc_comment, source_code, ai_summary)
          VALUES ('delete', old.rowid, old.name, old.doc_comment, old.source_code, old.ai_summary);
        END
      `);

      this.db.run(`
        CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
          INSERT INTO symbols_fts(symbols_fts, rowid, name, doc_comment, source_code, ai_summary)
          VALUES ('delete', old.rowid, old.name, old.doc_comment, old.source_code, old.ai_summary);
          INSERT INTO symbols_fts(rowid, name, doc_comment, source_code, ai_summary)
          VALUES (new.rowid, new.name, new.doc_comment, new.source_code, new.ai_summary);
        END
      `);
    } catch {
      // FTS5 not available in sql.js WASM, fallback to LIKE search (silent)
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
        this.db.run('ALTER TABLE files ADD COLUMN imports TEXT');
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
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows: Record<string, any>[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  /** Run a SELECT and return first row object or undefined */
  private queryOne(sql: string, params: any[] = []): Record<string, any> | undefined {
    const rows = this.queryAll(sql, params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  /** Run a write statement and mark as dirty */
  private run(sql: string, params: any[] = []): void {
    this.db.run(sql, params);
    this.dirty = true;
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

  /** Search symbols by name (FTS or LIKE fallback) */
  searchSymbols(query: string, options?: { kind?: SymbolKind; layer?: Layer; limit?: number }): Symbol[] {
    const limit = options?.limit ?? 50;
    let rows: Record<string, any>[];

    // Try FTS5 first
    try {
      rows = this.queryAll(`
        SELECT s.* FROM symbols s
        JOIN symbols_fts fts ON s.rowid = fts.rowid
        WHERE symbols_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `, [query, limit]);
    } catch {
      // Fallback to LIKE (also used for empty/broad queries)
      const like = `%${query}%`;
      rows = this.queryAll(`
        SELECT * FROM symbols
        WHERE name LIKE ? OR doc_comment LIKE ?
        ORDER BY name
        LIMIT ?
      `, [like, like, limit]);
    }

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
    this.persist();
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
  // Bulk Operations
  // ========================

  /** Save an entire graph to the store (optimized with batch operations) */
  saveGraph(graph: CodeGraph): void {
    // Disable FTS triggers during bulk insert for faster writes
    try {
      this.db.run('DROP TRIGGER IF EXISTS symbols_ai');
      this.db.run('DROP TRIGGER IF EXISTS symbols_ad');
      this.db.run('DROP TRIGGER IF EXISTS symbols_au');
    } catch { /* ignore */ }

    this.run('BEGIN TRANSACTION');
    try {
      // Batch insert symbols
      const symbolStmt = this.db.prepare(`
        INSERT INTO symbols (id, name, kind, file_path, start_line, end_line, start_col, end_col,
                             source_code, language, layer, doc_comment, ai_summary, complexity, exported, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const symbol of graph.symbols.values()) {
        symbolStmt.run([
          symbol.id, symbol.name, symbol.kind, symbol.filePath,
          symbol.startLine, symbol.endLine, symbol.startCol ?? null, symbol.endCol ?? null,
          symbol.sourceCode ?? null, symbol.language, symbol.layer,
          symbol.docComment ?? null, symbol.aiSummary ?? null,
          symbol.complexity ?? null, symbol.exported ? 1 : 0,
          symbol.metadata ? JSON.stringify(symbol.metadata) : null,
        ]);
      }

      // Batch insert relationships
      const relStmt = this.db.prepare(`
        INSERT OR IGNORE INTO relationships (id, source_id, target_id, kind, line, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const rel of graph.relationships) {
        relStmt.run([
          rel.id, rel.sourceId, rel.targetId, rel.kind,
          rel.line ?? null, rel.metadata ? JSON.stringify(rel.metadata) : null,
        ]);
      }

      // Batch insert files
      const fileStmt = this.db.prepare(`
        INSERT INTO files (path, language, size, line_count, hash, parsed_at, imports, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          language = excluded.language, size = excluded.size, line_count = excluded.line_count,
          hash = excluded.hash, parsed_at = excluded.parsed_at, imports = excluded.imports, metadata = excluded.metadata
      `);

      for (const file of graph.files.values()) {
        fileStmt.run([
          file.path, file.language, file.size, file.lineCount,
          file.hash, file.parsedAt ?? null,
          file.imports ? JSON.stringify(file.imports) : null,
          file.metadata ? JSON.stringify(file.metadata) : null,
        ]);
      }

      this.run('COMMIT');
    } catch (err) {
      this.run('ROLLBACK');
      throw err;
    }

    // Rebuild FTS index after bulk insert
    this.rebuildFTSIndex();

    this.persist();
  }

  /** Rebuild FTS5 index (call after bulk inserts) */
  private rebuildFTSIndex(): void {
    try {
      // Recreate FTS table
      this.db.run('DROP TABLE IF EXISTS symbols_fts');
      this.db.run(`
        CREATE VIRTUAL TABLE symbols_fts USING fts5(
          name, doc_comment, source_code, ai_summary,
          content='symbols',
          content_rowid='rowid',
          tokenize='porter unicode61'
        )
      `);

      // Repopulate FTS index
      this.db.run(`
        INSERT INTO symbols_fts(rowid, name, doc_comment, source_code, ai_summary)
        SELECT rowid, name, doc_comment, source_code, ai_summary FROM symbols
      `);

      // Recreate triggers
      this.db.run(`
        CREATE TRIGGER symbols_ai AFTER INSERT ON symbols BEGIN
          INSERT INTO symbols_fts(rowid, name, doc_comment, source_code, ai_summary)
          VALUES (new.rowid, new.name, new.doc_comment, new.source_code, new.ai_summary);
        END
      `);
      this.db.run(`
        CREATE TRIGGER symbols_ad AFTER DELETE ON symbols BEGIN
          INSERT INTO symbols_fts(symbols_fts, rowid, name, doc_comment, source_code, ai_summary)
          VALUES ('delete', old.rowid, old.name, old.doc_comment, old.source_code, old.ai_summary);
        END
      `);
      this.db.run(`
        CREATE TRIGGER symbols_au AFTER UPDATE ON symbols BEGIN
          INSERT INTO symbols_fts(symbols_fts, rowid, name, doc_comment, source_code, ai_summary)
          VALUES ('delete', old.rowid, old.name, old.doc_comment, old.source_code, old.ai_summary);
          INSERT INTO symbols_fts(rowid, name, doc_comment, source_code, ai_summary)
          VALUES (new.rowid, new.name, new.doc_comment, new.source_code, new.ai_summary);
        END
      `);
    } catch {
      // FTS5 might not be available in WASM build, silently skip
    }
  }

  // ========================
  // Annotation Operations (delegated to AnnotationStore)
  // ========================

  /** Add an annotation to a symbol */
  addAnnotation(symbolId: string, userId: string, content: string, type: string = 'comment'): string {
    const id = this._annotations.addAnnotation(symbolId, userId, content, type);
    this.persist();
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
    this.persist();
  }

  /** Delete an annotation */
  deleteAnnotation(id: string): void {
    this._annotations.deleteAnnotation(id);
    this.persist();
  }

  /** Mark annotation as resolved/unresolved */
  resolveAnnotation(id: string, resolved: boolean): void {
    this._annotations.resolveAnnotation(id, resolved);
    this.persist();
  }

  /** Get annotation count per symbol */
  getAnnotationCounts(): Map<string, number> {
    return this._annotations.getAnnotationCounts();
  }

  // ========================
  // Vector/Embedding Operations
  // ========================

  /** Execute raw SQL query (for internal use) */
  executeQuery(sql: string, params: any[] = []): Record<string, any>[] {
    return this.queryAll(sql, params);
  }

  /** Execute raw SQL statement */
  executeStatement(sql: string, params: any[] = []): void {
    this.run(sql, params);
  }

  /** Clear all data */
  clear(): void {
    this.run('DELETE FROM relationships');
    this.run('DELETE FROM symbols');
    this.run('DELETE FROM files');
    this.persist();
  }

  /** Close the database connection and save to disk */
  close(): void {
    this.persist();
    this.db.close();
  }

  /** Save database to file if there are pending changes */
  private persist(): void {
    if (this.dirty) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.dirty = false;
    }
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
