// ============================================================
// Annotation Store - Manages code annotations
// ============================================================

import type { SQLiteStore } from './sqlite-store.js';

export class AnnotationStore {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  initSchema(): void {
    this.store.executeStatement(`
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
    this.store.executeStatement('CREATE INDEX IF NOT EXISTS idx_annotations_symbol ON annotations(symbol_id)');
    this.store.executeStatement('CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user_id)');
  }

  addAnnotation(symbolId: string, userId: string, content: string, type: string = 'comment'): string {
    const id = `${symbolId}:${userId}:${Date.now()}`;
    this.store.executeStatement(
      'INSERT INTO annotations (id, symbol_id, user_id, content, type) VALUES (?, ?, ?, ?, ?)',
      [id, symbolId, userId, content, type]
    );
    return id;
  }

  getAnnotations(symbolId: string): any[] {
    return this.store.executeQuery(
      'SELECT * FROM annotations WHERE symbol_id = ? ORDER BY created_at DESC',
      [symbolId]
    );
  }

  getAnnotationsByUser(userId: string): any[] {
    return this.store.executeQuery(
      'SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  updateAnnotation(id: string, content: string): void {
    this.store.executeStatement(
      'UPDATE annotations SET content = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [content, id]
    );
  }

  deleteAnnotation(id: string): void {
    this.store.executeStatement('DELETE FROM annotations WHERE id = ?', [id]);
  }

  resolveAnnotation(id: string, resolved: boolean): void {
    this.store.executeStatement(
      'UPDATE annotations SET resolved = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [resolved ? 1 : 0, id]
    );
  }

  getAnnotationCounts(): Map<string, number> {
    const rows = this.store.executeQuery(
      'SELECT symbol_id, COUNT(*) as count FROM annotations GROUP BY symbol_id'
    );
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.symbol_id, row.count);
    return map;
  }

  getUnresolvedCount(): number {
    const row = this.store.executeQuery(
      'SELECT COUNT(*) as count FROM annotations WHERE resolved = 0'
    );
    return (row[0] as any)?.count ?? 0;
  }
}
