// ============================================================
// FileWatcher - Real-time file monitoring with debounced scanning
// ============================================================

import { EventEmitter } from 'events';
import type { ProjectScanner, ScanResult } from './scanner.js';

// Dynamic import for chokidar (ESM)
let chokidarModule: any;
async function getChokidar() {
  if (!chokidarModule) {
    chokidarModule = await import('chokidar');
  }
  return chokidarModule.default || chokidarModule;
}

export interface WatcherOptions {
  /** Paths to watch (default: project root) */
  paths?: string[];
  /** Patterns to ignore */
  ignored?: (string | RegExp)[];
  /** Debounce delay in ms (default: 500) */
  debounceDelay?: number;
  /** Auto-scan on change (default: true) */
  autoScan?: boolean;
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  timestamp: number;
}

/**
 * Watches project files and triggers incremental scans on changes.
 *
 * Features:
 * - Debounced file change detection
 * - Automatic incremental scanning
 * - Event emission for downstream consumers
 * - Configurable ignore patterns
 */
export class FileWatcher extends EventEmitter {
  private watcher: any | null = null;
  private scanner: ProjectScanner;
  private projectPath: string;
  private options: Required<WatcherOptions>;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges = new Map<string, FileChangeEvent>();
  private isScanning = false;

  constructor(
    projectPath: string,
    scanner: ProjectScanner,
    options: WatcherOptions = {},
  ) {
    super();
    this.projectPath = projectPath;
    this.scanner = scanner;
    this.options = {
      paths: options.paths ?? [projectPath],
      ignored: options.ignored ?? [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.codeatlas/**',
        '**/*.min.js',
        '**/*.map',
      ],
      debounceDelay: options.debounceDelay ?? 500,
      autoScan: options.autoScan ?? true,
    };
  }

  /**
   * Start watching files
   */
  async start(): Promise<void> {
    if (this.watcher) {
      console.warn('FileWatcher already started');
      return;
    }

    const chokidar = await getChokidar();

    console.log(`\n👁️  Starting file watcher...`);
    console.log(`   Paths: ${this.options.paths.join(', ')}`);
    console.log(`   Debounce: ${this.options.debounceDelay}ms`);

    this.watcher = chokidar.watch(this.options.paths, {
      ignored: this.options.ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on('change', (path: string) => this.handleEvent('change', path))
      .on('add', (path: string) => this.handleEvent('add', path))
      .on('unlink', (path: string) => this.handleEvent('unlink', path))
      .on('error', (error: Error) => this.emit('error', error))
      .on('ready', () => {
        console.log('   ✅ Watching for changes...\n');
        this.emit('ready');
      });
  }

  /**
   * Stop watching files
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log('👁️  File watcher stopped');
    }
  }

  /**
   * Get watcher status
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Handle file change events
   */
  private handleEvent(type: 'add' | 'change' | 'unlink', filePath: string): void {
    const event: FileChangeEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
    };

    this.pendingChanges.set(filePath, event);
    this.emit('fileChange', event);

    // Debounce scanning
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processChanges();
    }, this.options.debounceDelay);
  }

  /**
   * Process accumulated changes and trigger scan
   */
  private async processChanges(): Promise<void> {
    if (this.isScanning || this.pendingChanges.size === 0) {
      return;
    }

    this.isScanning = true;
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    console.log(`\n📝 Detected ${changes.length} file changes`);

    // Group by change type
    const added = changes.filter(c => c.type === 'add');
    const modified = changes.filter(c => c.type === 'change');
    const deleted = changes.filter(c => c.type === 'unlink');

    if (added.length > 0) console.log(`   + ${added.length} added`);
    if (modified.length > 0) console.log(`   ~ ${modified.length} modified`);
    if (deleted.length > 0) console.log(`   - ${deleted.length} deleted`);

    if (this.options.autoScan) {
      try {
        this.emit('scanStart', changes);

        const result = await this.scanner.scan({
          projectPath: this.projectPath,
          full: false,
        });

        console.log(`   ✅ Scan complete in ${result.duration}ms`);
        console.log(`      ${result.symbolsFound} symbols, ${result.relationshipsFound} relationships\n`);

        this.emit('scanComplete', result);
        this.emit('update', result);
      } catch (error) {
        console.error('   ❌ Scan failed:', error);
        this.emit('error', error);
      } finally {
        this.isScanning = false;
      }
    } else {
      this.isScanning = false;
    }
  }
}
