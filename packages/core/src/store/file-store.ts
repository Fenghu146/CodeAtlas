// ============================================================
// File Store - Manages file metadata
// ============================================================
// Extracted from SQLiteStore for better separation of concerns.
// Handles: upsert, get, hash, recent files.

import type { Database } from 'sql.js';
import type { FileInfo } from '../graph/types.js';

/**
 * Manages file metadata (path, language, hash, etc.).
 * Self-contained: only touches the files table.
 */
export class FileStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Create files table if not exists */
  initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        path        TEXT PRIMARY KEY,
        language    TEXT NOT NULL,
        size        INTEGER,
        line_count  INTEGER,
        hash        TEXT,
        parsed_at   TEXT,
        imports     TEXT,
        metadata    TEXT
      )
    `);
  }

  /** Insert or update a file */
  upsertFile(file: FileInfo): void {
    this.db.run('DELETE FROM files WHERE path = ?', [file.path]);
    this.db.run(`
      INSERT INTO files (path, language, size, line_count, hash, parsed_at, imports, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      file.path, file.language, file.size, file.lineCount,
      file.hash, file.parsedAt ?? null,
      file.imports ? JSON.stringify(file.imports) : null,
      file.metadata ? JSON.stringify(file.metadata) : null,
    ]);
  }

  /** Get file info by path */
  getFile(filePath: string): FileInfo | undefined {
    const row = this.queryOne('SELECT * FROM files WHERE path = ?', [filePath]);
    if (!row) return undefined;
    return {
      path: row.path,
      language: row.language,
      size: row.size,
      lineCount: row.line_count,
      hash: row.hash,
      parsedAt: row.parsed_at,
      imports: row.imports ? JSON.parse(row.imports) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /** Get file hash only (lightweight) */
  getFileHash(filePath: string): string | undefined {
    const row = this.queryOne('SELECT hash FROM files WHERE path = ?', [filePath]);
    return row?.hash;
  }

  /** Get recent files sorted by parsed_at */
  getRecentFiles(limit: number = 10): FileInfo[] {
    const rows = this.queryAll(
      'SELECT * FROM files ORDER BY parsed_at DESC LIMIT ?',
      [limit]
    );
    return rows.map(row => ({
      path: row.path,
      language: row.language,
      size: row.size,
      lineCount: row.line_count,
      hash: row.hash,
      parsedAt: row.parsed_at,
      imports: row.imports ? JSON.parse(row.imports) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  // Private helpers
  private queryOne(sql: string, params: any[] = []): Record<string, any> | undefined {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

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
}
