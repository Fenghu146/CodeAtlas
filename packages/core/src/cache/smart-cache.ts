// ============================================================
// Smart Cache - Avoid redundant scans
// ============================================================
// Caches scan results and invalidates only when files change

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface CacheEntry {
  timestamp: number;
  fileHashes: Map<string, string>;
  result: any;
}

export class SmartCache {
  private cacheDir: string;
  private cache = new Map<string, CacheEntry>();

  constructor(projectPath: string) {
    this.cacheDir = path.join(projectPath, '.codeatlas', 'cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get cached result if valid
   */
  get<T>(key: string, files: string[]): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if any file has changed
    for (const file of files) {
      const currentHash = this.getFileHash(file);
      const cachedHash = entry.fileHashes.get(file);

      if (currentHash !== cachedHash) {
        // File changed, invalidate cache
        this.cache.delete(key);
        return null;
      }
    }

    return entry.result as T;
  }

  /**
   * Set cache entry
   */
  set<T>(key: string, files: string[], result: T): void {
    const fileHashes = new Map<string, string>();
    for (const file of files) {
      fileHashes.set(file, this.getFileHash(file));
    }

    this.cache.set(key, {
      timestamp: Date.now(),
      fileHashes,
      result,
    });
  }

  /**
   * Get file hash
   */
  private getFileHash(filePath: string): string {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  stats(): { entries: number; size: number } {
    return {
      entries: this.cache.size,
      size: JSON.stringify([...this.cache.values()]).length,
    };
  }
}
