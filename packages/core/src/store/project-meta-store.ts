// ============================================================
// Project Meta Store - Manages scan metadata
// ============================================================

import type { SQLiteStore } from './sqlite-store.js';

export class ProjectMetaStore {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  initSchema(): void {
    this.store.executeExec(`
      CREATE TABLE IF NOT EXISTS project_meta (
        key         TEXT PRIMARY KEY,
        value       TEXT
      )
    `);
  }

  getMeta(key: string): string | undefined {
    const rows = this.store.executeQuery('SELECT value FROM project_meta WHERE key = ?', [key]);
    return rows[0]?.value;
  }

  setMeta(key: string, value: string): void {
    this.store.executeStatement('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)', [key, value]);
  }

  getLastScanInfo(): { path?: string; timestamp?: string; languages?: string[] } {
    return {
      path: this.getMeta('last_scan_path'),
      timestamp: this.getMeta('last_scan_timestamp'),
      languages: this.getMeta('last_scan_languages')?.split(','),
    };
  }

  saveScanInfo(projectPath: string, languages: string[]): void {
    this.setMeta('last_scan_path', projectPath);
    this.setMeta('last_scan_timestamp', new Date().toISOString());
    this.setMeta('last_scan_languages', languages.join(','));
  }
}
