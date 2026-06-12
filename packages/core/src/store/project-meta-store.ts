// ============================================================
// Project Meta Store - Manages project metadata
// ============================================================
// Extracted from SQLiteStore for better separation of concerns.
// Handles: get/set metadata, scan info persistence.

import type { Database } from 'sql.js';

/**
 * Manages project-level metadata (scan info, config, etc.).
 * Self-contained: only touches the project_meta table.
 */
export class ProjectMetaStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Create project_meta table if not exists */
  initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_meta (
        key         TEXT PRIMARY KEY,
        value       TEXT
      )
    `);
  }

  /** Get metadata value */
  getMeta(key: string): string | undefined {
    const row = this.queryOne('SELECT value FROM project_meta WHERE key = ?', [key]);
    return row?.value;
  }

  /** Set metadata value */
  setMeta(key: string, value: string): void {
    this.db.run('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)', [key, value]);
  }

  /** Get last scan info */
  getLastScanInfo(): { path?: string; timestamp?: string; languages?: string[] } {
    return {
      path: this.getMeta('last_scan_path'),
      timestamp: this.getMeta('last_scan_timestamp'),
      languages: this.getMeta('last_scan_languages')?.split(','),
    };
  }

  /** Save scan info */
  saveScanInfo(projectPath: string, languages: string[]): void {
    this.setMeta('last_scan_path', projectPath);
    this.setMeta('last_scan_timestamp', new Date().toISOString());
    this.setMeta('last_scan_languages', languages.join(','));
  }

  // Private helper
  private queryOne(sql: string, params: any[] = []): Record<string, any> | undefined {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }
}
