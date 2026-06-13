// ============================================================
// File Store - Manages file metadata
// ============================================================

import type { SQLiteStore } from './sqlite-store.js';
import type { FileInfo } from '../graph/types.js';

export class FileStore {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  initSchema(): void {
    this.store.executeExec(`
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

  upsertFile(file: FileInfo): void {
    this.store.executeStatement('DELETE FROM files WHERE path = ?', [file.path]);
    this.store.executeStatement(`
      INSERT INTO files (path, language, size, line_count, hash, parsed_at, imports, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      file.path, file.language, file.size, file.lineCount,
      file.hash, file.parsedAt ?? null,
      file.imports ? JSON.stringify(file.imports) : null,
      file.metadata ? JSON.stringify(file.metadata) : null,
    ]);
  }

  getFile(filePath: string): FileInfo | undefined {
    const rows = this.store.executeQuery('SELECT * FROM files WHERE path = ?', [filePath]);
    if (rows.length === 0) return undefined;
    const row = rows[0];
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

  getFileHash(filePath: string): string | undefined {
    const rows = this.store.executeQuery('SELECT hash FROM files WHERE path = ?', [filePath]);
    return rows[0]?.hash;
  }

  getRecentFiles(limit: number = 10): FileInfo[] {
    const rows = this.store.executeQuery('SELECT * FROM files ORDER BY parsed_at DESC LIMIT ?', [limit]);
    return rows.map((row: any) => ({
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

  deleteFile(filePath: string): void {
    this.store.executeStatement('DELETE FROM files WHERE path = ?', [filePath]);
  }

  getAllFiles(): FileInfo[] {
    const rows = this.store.executeQuery('SELECT * FROM files ORDER BY path');
    return rows.map((row: any) => ({
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
}
