// ============================================================
// Project Scanner - Orchestrates the full scanning pipeline
// ============================================================

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { glob } from 'glob';
import ignore from 'ignore';
import { CodeParser, detectLanguage } from '../parser/index.js';
import { GraphBuilder } from '../graph/builder.js';
import { SQLiteStore } from '../store/sqlite-store.js';
import { ModuleExplainer } from '../analyzer/module-explainer.js';
import { loadConfig, getAIConfig } from '../config/config-loader.js';
import type { FileInfo, CodeGraph } from '../graph/types.js';
import type { ParseResult } from '../parser/index.js';

export interface ScanOptions {
  projectPath: string;
  full?: boolean;
  include?: string[];
  exclude?: string[];
  onProgress?: (current: number, total: number, file: string) => void;
  enableAI?: boolean;
}

export interface ScanResult {
  filesScanned: number;
  filesSkipped: number;
  symbolsFound: number;
  relationshipsFound: number;
  languages: string[];
  duration: number;
}

/**
 * Orchestrates the complete scanning pipeline with timeout recovery.
 */
export class ProjectScanner {
  private parser: CodeParser;
  private graphBuilder: GraphBuilder;
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.parser = new CodeParser();
    this.graphBuilder = new GraphBuilder();
    this.store = store;
  }

  /**
   * Scan a project directory and build/update the code graph.
   * Includes timeout recovery and path change detection.
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    const startTime = Date.now();
    const { projectPath, full = false } = options;

    // Load config
    const config = loadConfig(projectPath);

    // Check if scan path changed — auto-trigger full scan
    const lastScanInfo = this.store.getLastScanInfo();
    let forceFull = full;
    if (!full && lastScanInfo.path && lastScanInfo.path !== projectPath) {
      console.log(`⚠️  Scan path changed: ${lastScanInfo.path} → ${projectPath}`);
      console.log(`   Auto-triggering full scan...`);
      forceFull = true;
    }

    // Initialize parser
    await this.parser.init();

    // Discover files
    const files = await this.discoverFiles(projectPath, {
      ...options,
      exclude: [...(options.exclude || []), ...(config.scan?.exclude || [])],
    });

    // Detect changes
    const { toParse, toSkip } = forceFull
      ? { toParse: files, toSkip: [] as string[] }
      : this.detectChanges(files, projectPath);

    // Load required languages
    const languagesNeeded = new Set(
      toParse.map(f => detectLanguage(f)).filter(Boolean) as string[]
    );
    for (const lang of languagesNeeded) {
      await this.parser.loadLanguage(lang);
    }

    // Parse files with timeout protection
    const BATCH_SIZE = toParse.length > 500 ? 5 : toParse.length > 100 ? 10 : 15;
    const MAX_FILE_SIZE = 100 * 1024;
    const PARSE_TIMEOUT = 5000;
    const SCAN_TIMEOUT = 120000; // 2 minutes total

    const parseResults: ParseResult[] = [];
    const fileInfoMap = new Map<string, FileInfo>();
    let parseErrors = 0;

    // Parse with overall timeout
    const scanStartTime = Date.now();
    let timedOut = false;

    for (let i = 0; i < toParse.length && !timedOut; i += BATCH_SIZE) {
      // Check overall timeout
      if (Date.now() - scanStartTime > SCAN_TIMEOUT) {
        console.warn(`⚠️  Scan timed out after ${SCAN_TIMEOUT / 1000}s. Processed ${i}/${toParse.length} files.`);
        timedOut = true;
        break;
      }

      const batch = toParse.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (absolutePath, batchIndex) => {
          const relativePath = path.relative(projectPath, absolutePath);
          const globalIndex = i + batchIndex + 1;
          options.onProgress?.(globalIndex, toParse.length, relativePath);

          // Skip large files
          try {
            const stats = fs.statSync(absolutePath);
            if (stats.size > MAX_FILE_SIZE) {
              return null;
            }
          } catch {
            return null;
          }

          try {
            const sourceCode = fs.readFileSync(absolutePath, 'utf-8');

            // Parse with timeout
            const result = await Promise.race([
              Promise.resolve(this.parser.parse(sourceCode, relativePath)),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Parse timeout')), PARSE_TIMEOUT)
              ),
            ]);

            const hash = crypto.createHash('sha256').update(sourceCode).digest('hex');
            const fileInfo: FileInfo = {
              path: relativePath,
              language: result.language,
              size: Buffer.byteLength(sourceCode),
              lineCount: sourceCode.split('\n').length,
              hash,
              parsedAt: new Date().toISOString(),
            };

            return { result, fileInfo };
          } catch (err) {
            parseErrors++;
            return null;
          }
        })
      );

      // Collect successful results
      for (const item of batchResults) {
        if (item.status === 'fulfilled' && item.value) {
          parseResults.push(item.value.result);
          fileInfoMap.set(item.value.fileInfo.path, item.value.fileInfo);
        }
      }
    }

    if (parseErrors > 0) {
      console.warn(`⚠️  ${parseErrors} files failed to parse`);
    }

    // Build graph
    const graph = this.graphBuilder.build(parseResults, fileInfoMap, config.layers);

    // AI Analysis (optional)
    if (options.enableAI) {
      try {
        const aiConfig = getAIConfig(config);
        if (aiConfig.provider) {
          const explainer = new ModuleExplainer({
            provider: aiConfig.provider,
            model: aiConfig.model,
            apiKey: aiConfig.apiKey,
            baseUrl: aiConfig.baseUrl,
          });

          let explained = 0;
          for (const [id, symbol] of graph.symbols) {
            if (!symbol.aiSummary && symbol.sourceCode) {
              try {
                const summary = await explainer.explainSymbol(symbol);
                symbol.aiSummary = summary;
                explained++;
                if (aiConfig.batchSize && explained >= aiConfig.batchSize) break;
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* skip */ }
    }

    // Persist
    if (!full && !forceFull) {
      for (const filePath of toParse) {
        const relativePath = path.relative(projectPath, filePath);
        this.store.deleteSymbolsByFile(relativePath);
      }
    } else {
      this.store.clear();
    }
    this.store.saveGraph(graph);

    // Save scan metadata for next run
    this.store.saveScanInfo(projectPath, Array.from(languagesNeeded));

    return {
      filesScanned: toParse.length,
      filesSkipped: toSkip.length,
      symbolsFound: graph.symbols.size,
      relationshipsFound: graph.relationships.length,
      languages: Array.from(languagesNeeded),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Discover all parseable files in the project directory.
   */
  private async discoverFiles(projectPath: string, options: ScanOptions): Promise<string[]> {
    const gitignorePath = path.join(projectPath, '.gitignore');
    const ig = ignore();

    // Default exclusions
    const defaultExcludes = [
      'node_modules', 'vendor', 'target', 'dist', 'build', 'out',
      '.git', '.svn', '.hg', '.vscode', '.idea',
      'coverage', '.nyc_output', '__pycache__', '.venv', 'venv',
      '.next', '.nuxt', '.output',
      '.pio', '.pioenvs', '.piolibdeps',
      'lib', 'Lib', 'external', 'deps', 'third_party', 'third-party',
      'Debug', 'Release',
    ];

    ig.add(defaultExcludes);

    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, 'utf-8'));
    }

    const supportedExtensions = [
      'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'go', 'rs',
      'java', 'rb', 'php', 'cs', 'c', 'h', 'cpp', 'hpp',
    ];

    const includePattern = options.include?.length
      ? options.include
      : [`**/*.{${supportedExtensions.join(',')}}`];

    const allExcludes = [...(options.exclude ?? []), ...defaultExcludes];

    const allFiles = await glob(includePattern, {
      cwd: projectPath,
      absolute: true,
      nodir: true,
      ignore: allExcludes,
    });

    const filteredFiles = allFiles.filter(f => {
      const relative = path.relative(projectPath, f);
      return !ig.ignores(relative);
    });

    // Limit for very large projects
    const MAX_FILES = 5000;
    if (filteredFiles.length > MAX_FILES) {
      console.warn(`⚠️  Project has ${filteredFiles.length} files. Limiting to ${MAX_FILES}.`);
      return filteredFiles.slice(0, MAX_FILES);
    }

    return filteredFiles;
  }

  /**
   * Detect which files have changed since last scan.
   */
  private detectChanges(files: string[], projectPath: string): { toParse: string[]; toSkip: string[] } {
    const toParse: string[] = [];
    const toSkip: string[] = [];

    for (const filePath of files) {
      const relativePath = path.relative(projectPath, filePath);
      const storedHash = this.store.getFileHash(relativePath);

      if (!storedHash) {
        toParse.push(filePath);
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const currentHash = crypto.createHash('sha256').update(content).digest('hex');

        if (currentHash !== storedHash) {
          toParse.push(filePath);
        } else {
          toSkip.push(filePath);
        }
      } catch {
        toParse.push(filePath);
      }
    }

    return { toParse, toSkip };
  }
}
