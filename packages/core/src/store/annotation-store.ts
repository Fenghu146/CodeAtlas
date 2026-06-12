// ============================================================
// Annotation Store - Manages code annotations
// ============================================================
// Extracted from SQLiteStore for better separation of concerns.
// Handles: add, get, update, delete, resolve annotations.

import type { Database } from 'sql.js';

/**
 * Manages code annotations (comments, TODOs, issues, questions).
 * Self-contained: only touches the annotations table.
 */
export class AnnotationStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Create annotations table if not exists */
  initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS annotations (
        id          TEXT PRIMARY KEY,
        symbol_id   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        content     TEXT NOT NULL,
        type        TEXT DEFAULT 'comment',
        resolved    INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_annotations_symbol ON annotations(symbol_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user_id)');
  }

  /** Add an annotation to a symbol */
  addAnnotation(symbolId: string, userId: string, content: string, type: string = 'comment'): string {
    const id = `${symbolId}:${userId}:${Date.now()}`;
    this.db.run(
      'INSERT INTO annotations (id, symbol_id, user_id, content, type) VALUES (?, ?, ?, ?, ?)',
      [id, symbolId, userId, content, type]
    );
    return id;
  }

  /** Get all annotations for a symbol */
  getAnnotations(symbolId: string): any[] {
    return this.queryAll(
      'SELECT * FROM annotations WHERE symbol_id = ? ORDER BY created_at DESC',
      [symbolId]
    );
  }

  /** Get all annotations by a user */
  getAnnotationsByUser(userId: string): any[] {
    return this.queryAll(
      'SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  /** Update an annotation */
  updateAnnotation(id: string, content: string): void {
    this.db.run(
      'UPDATE annotations SET content = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [content, id]
    );
  }

  /** Delete an annotation */
  deleteAnnotation(id: string): void {
    this.db.run('DELETE FROM annotations WHERE id = ?', [id]);
  }

  /** Mark annotation as resolved/unresolved */
  resolveAnnotation(id: string, resolved: boolean): void {
    this.db.run(
      'UPDATE annotations SET resolved = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [resolved ? 1 : 0, id]
    );
  }

  /** Get annotation count per symbol */
  getAnnotationCounts(): Map<string, number> {
    const rows = this.queryAll(
      'SELECT symbol_id, COUNT(*) as count FROM annotations GROUP BY symbol_id'
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.symbol_id, row.count);
    }
    return counts;
  }

  // Private helper
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
