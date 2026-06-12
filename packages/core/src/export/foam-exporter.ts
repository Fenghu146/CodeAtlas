// ============================================================
// Foam Exporter - Generate Foam-compatible markdown knowledge graph
// ============================================================
//
// Transforms the CodeAtlas code graph into Foam-friendly markdown files.
// When opened in VSCode with the Foam extension, users get:
//   - Interactive graph visualization with layer-based coloring
//   - Wiki-link navigation between files and symbols
//   - Automatic backlink discovery (who references what)
//   - Tag-based filtering by layer, kind, language
//   - Tag Explorer for browsing the codebase
//
// Output structure:
//   .codeatlas/foam/
//     ├── _index.md              # Dashboard / navigation hub
//     ├── files/                 # One note per source file
//     │   ├── src-index-ts.md
//     │   ├── src-services-user-service-ts.md
//     │   └── ...
//     ├── modules/               # One note per logical module (directory)
//     │   ├── src-services.md
//     │   └── ...
//     └── .vscode/
//         └── settings.json      # Foam graph config with layer colors

import fs from 'fs';
import path from 'path';
import type { Symbol, Relationship, CodeGraph, FileInfo, Layer, SymbolKind } from '../graph/types.js';
import { SQLiteStore } from '../store/sqlite-store.js';

export interface FoamExportOptions {
  /** Project root path */
  projectPath: string;
  /** Output directory (default: .codeatlas/foam) */
  outputDir?: string;
  /** Include source code in file notes */
  includeSource?: boolean;
  /** Include AI summaries if available */
  includeAISummary?: boolean;
  /** Generate per-symbol detail notes (for large symbols) */
  generateSymbolNotes?: boolean;
  /** Minimum complexity to generate a symbol note */
  symbolComplexityThreshold?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number, label: string) => void;
}

/** Layer → Foam graph color mapping */
const LAYER_COLORS: Record<Layer, string> = {
  interface: '#3b82f6',   // Blue
  business: '#22c55e',    // Green
  data: '#f97316',        // Orange
  utility: '#94a3b8',     // Slate
  unknown: '#6b7280',     // Gray
};

/** Symbol kind → emoji mapping for visual distinction */
const KIND_ICONS: Record<string, string> = {
  class: '🔷',
  function: 'ƒ',
  method: '⚙',
  interface: '📐',
  type: '🏷',
  enum: '📋',
  variable: '▪',
  constant: '▪',
  module: '📦',
  property: '▪',
  namespace: '📁',
};

/**
 * Exports the code graph as Foam-compatible markdown files.
 */
export class FoamExporter {
  private store: SQLiteStore;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Generate all Foam files from the current code graph.
   */
  async export(options: FoamExportOptions): Promise<{ filesGenerated: number; outputDir: string }> {
    const outputDir = options.outputDir ?? path.join(options.projectPath, '.codeatlas', 'foam');
    const filesDir = path.join(outputDir, 'files');
    const modulesDir = path.join(outputDir, 'modules');
    const vscodeDir = path.join(outputDir, '.vscode');

    // Ensure directories exist
    for (const dir of [outputDir, filesDir, modulesDir, vscodeDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Gather all data from the store
    const stats = this.store.getStats();
    const allLayers: Layer[] = ['interface', 'business', 'data', 'utility'];
    const allFiles: string[] = [];
    let filesGenerated = 0;

    // ==============================
    // 1. Generate index/dashboard
    // ==============================
    const indexContent = this.generateIndex(options.projectPath, stats, allLayers);
    fs.writeFileSync(path.join(outputDir, '_index.md'), indexContent, 'utf-8');
    filesGenerated++;

    // ==============================
    // 2. Generate per-file notes
    // ==============================
    for (const layer of [...allLayers, 'unknown' as Layer]) {
      const symbols = this.store.getSymbolsByLayer(layer);
      const byFile = this.groupByFile(symbols);

      for (const [filePath, fileSymbols] of byFile) {
        const noteName = this.fileToNoteName(filePath);
        const content = this.generateFileNote(filePath, fileSymbols, options);
        fs.writeFileSync(path.join(filesDir, `${noteName}.md`), content, 'utf-8');
        allFiles.push(`${noteName}.md`);
        filesGenerated++;
        options.onProgress?.(filesGenerated, 0, filePath);
      }
    }

    // ==============================
    // 3. Generate module notes (directory-level)
    // ==============================
    const directories = this.extractDirectories(allFiles, filesDir);
    for (const dir of directories) {
      const content = this.generateModuleNote(dir, options);
      const moduleNoteName = dir.replace(/\//g, '-').replace(/^-/, '') || 'root';
      fs.writeFileSync(path.join(modulesDir, `${moduleNoteName}.md`), content, 'utf-8');
      filesGenerated++;
    }

    // ==============================
    // 4. Generate VSCode/Foam settings
    // ==============================
    const settings = this.generateFoamSettings(outputDir);
    fs.writeFileSync(path.join(vscodeDir, 'settings.json'), settings, 'utf-8');

    return { filesGenerated, outputDir };
  }

  // ================================
  // Index / Dashboard
  // ================================
  private generateIndex(
    projectPath: string,
    stats: { symbols: number; relationships: number; files: number; languages: string[] },
    layers: Layer[],
  ): string {
    const projectName = path.basename(projectPath);
    const lines: string[] = [];

    lines.push('---');
    lines.push('tags: [codeatlas/index]');
    lines.push(`project: "${projectName}"`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${projectName} - Code Graph`);
    lines.push('');
    lines.push(`> Generated by [CodeAtlas](https://github.com/codeatlas) on ${new Date().toISOString().split('T')[0]}`);
    lines.push('');
    lines.push('## Project Stats');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Files | ${stats.files} |`);
    lines.push(`| Symbols | ${stats.symbols} |`);
    lines.push(`| Relationships | ${stats.relationships} |`);
    lines.push(`| Languages | ${stats.languages.join(', ')} |`);
    lines.push('');

    // Layer breakdown
    lines.push('## Architecture Layers');
    lines.push('');
    for (const layer of layers) {
      const symbols = this.store.getSymbolsByLayer(layer);
      const color = LAYER_COLORS[layer];
      lines.push(`### ${layer.charAt(0).toUpperCase() + layer.slice(1)} <span style="color:${color}">●</span> (${symbols.length})`);
      lines.push('');

      const byFile = this.groupByFile(symbols);
      for (const [filePath, syms] of byFile) {
        const noteName = this.fileToNoteName(filePath);
        const symbolList = syms.map(s => `\`${s.name}\``).join(', ');
        lines.push(`- [[${noteName}|${filePath}]] — ${symbolList}`);
      }
      lines.push('');
    }

    // Usage tips
    lines.push('---');
    lines.push('');
    lines.push('## How to Use This Graph');
    lines.push('');
    lines.push('- **Navigate**: Click any `[[wikilink]]` to jump to a file note');
    lines.push('- **Graph View**: Run `Foam: Show Graph` from the command palette to see the interactive visualization');
    lines.push('- **Backlinks**: When viewing a file note, check the backlinks panel to see who references it');
    lines.push('- **Tags**: Use the Tag Explorer to filter by layer (`#layer/interface`, `#layer/business`, etc.)');
    lines.push('- **Colors**: In the graph view, nodes are colored by architecture layer (blue=interface, green=business, orange=data, gray=utility)');

    return lines.join('\n');
  }

  // ================================
  // Per-File Note
  // ================================
  private generateFileNote(
    filePath: string,
    symbols: Symbol[],
    options: FoamExportOptions,
  ): string {
    const lines: string[] = [];
    const primaryLayer = symbols[0]?.layer ?? 'unknown';
    const language = symbols[0]?.language ?? 'unknown';
    const tags = [
      `layer/${primaryLayer}`,
      `lang/${language}`,
      'codeatlas/file',
    ];

    // Frontmatter
    lines.push('---');
    lines.push(`tags: [${tags.join(', ')}]`);
    lines.push(`file_path: "${filePath}"`);
    lines.push(`layer: "${primaryLayer}"`);
    lines.push(`language: "${language}"`);
    lines.push(`symbol_count: ${symbols.length}`);
    lines.push('---');
    lines.push('');

    // Title
    const fileName = path.basename(filePath);
    lines.push(`# ${fileName}`);
    lines.push('');
    lines.push(`> \`${filePath}\` · ${symbols.length} symbols · Layer: **${primaryLayer}** · Language: ${language}`);
    lines.push('');

    // Symbols section
    lines.push('## Symbols');
    lines.push('');

    // Sort: exported first, then by start line
    const sorted = [...symbols].sort((a, b) => {
      if (a.exported !== b.exported) return a.exported ? -1 : 1;
      return a.startLine - b.startLine;
    });

    for (const sym of sorted) {
      const icon = KIND_ICONS[sym.kind] ?? '▪';
      const exportBadge = sym.exported ? ' `export`' : '';
      const complexity = sym.complexity ? ` · complexity: ${sym.complexity}` : '';

      lines.push(`### ${icon} ${sym.name} ${exportBadge}`);
      lines.push('');
      lines.push(`- **Kind**: ${sym.kind}`);
      lines.push(`- **Lines**: ${sym.startLine}–${sym.endLine}`);
      if (sym.complexity) lines.push(`- **Complexity**: ${sym.complexity}`);

      // Doc comment
      if (sym.docComment) {
        lines.push(`- **Docs**: ${sym.docComment.split('\n')[0].replace(/^[/*#]+/, '').trim()}`);
      }

      // AI Summary
      if (options.includeAISummary && sym.aiSummary) {
        lines.push('');
        lines.push(`> 💡 ${sym.aiSummary}`);
      }

      // Relationships (as wikilinks)
      const outgoing = this.store.getRelationshipsFrom(sym.id);
      const incoming = this.store.getRelationshipsTo(sym.id);

      if (outgoing.length > 0) {
        const targets = new Map<string, string>();
        for (const rel of outgoing) {
          const target = this.store.getSymbol(rel.targetId);
          if (target) {
            const targetNote = this.fileToNoteName(target.filePath);
            targets.set(targetNote, `${rel.kind} → \`${target.name}\``);
          }
        }
        if (targets.size > 0) {
          lines.push('');
          lines.push('**Depends on:**');
          for (const [note, desc] of targets) {
            lines.push(`- [[${note}]] — ${desc}`);
          }
        }
      }

      if (incoming.length > 0) {
        const sources = new Map<string, string>();
        for (const rel of incoming) {
          const source = this.store.getSymbol(rel.sourceId);
          if (source) {
            const sourceNote = this.fileToNoteName(source.filePath);
            sources.set(sourceNote, `${rel.kind} ← \`${source.name}\``);
          }
        }
        if (sources.size > 0) {
          lines.push('');
          lines.push('**Used by:**');
          for (const [note, desc] of sources) {
            lines.push(`- [[${note}]] — ${desc}`);
          }
        }
      }

      // Source code
      if (options.includeSource !== false && sym.sourceCode) {
        lines.push('');
        lines.push('<details>');
        lines.push(`<summary>View source (${sym.endLine - sym.startLine + 1} lines)</summary>`);
        lines.push('');
        lines.push(`\`\`\`${language}`);
        lines.push(sym.sourceCode);
        lines.push('```');
        lines.push('');
        lines.push('</details>');
      }

      lines.push('');
    }

    // Footer navigation
    lines.push('---');
    lines.push('');
    lines.push('[[ _index | ← Back to Index]]');

    return lines.join('\n');
  }

  // ================================
  // Module (Directory) Note
  // ================================
  private generateModuleNote(dir: string, options: FoamExportOptions): string {
    const lines: string[] = [];
    const dirName = path.basename(dir) || path.basename(options.projectPath);

    // Find all files in this directory
    const layerSymbols = ['interface', 'business', 'data', 'utility', 'unknown']
      .flatMap(layer => this.store.getSymbolsByLayer(layer as Layer))
      .filter(s => s.filePath.startsWith(dir + '/') || s.filePath.startsWith(dir + path.sep));

    const byLayer = new Map<string, Symbol[]>();
    for (const s of layerSymbols) {
      if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
      byLayer.get(s.layer)!.push(s);
    }

    // Determine primary layer
    let primaryLayer = 'unknown';
    let maxCount = 0;
    for (const [layer, syms] of byLayer) {
      if (syms.length > maxCount) {
        maxCount = syms.length;
        primaryLayer = layer;
      }
    }

    // Frontmatter
    lines.push('---');
    lines.push(`tags: [codeatlas/module, layer/${primaryLayer}]`);
    lines.push(`directory: "${dir}"`);
    lines.push(`layer: "${primaryLayer}"`);
    lines.push('---');
    lines.push('');
    lines.push(`# 📁 ${dirName}`);
    lines.push('');
    lines.push(`> Directory: \`${dir}/\` · ${layerSymbols.length} symbols · Primary layer: **${primaryLayer}**`);
    lines.push('');

    // Files in this module
    const fileSet = new Set(layerSymbols.map(s => s.filePath));
    lines.push('## Files');
    lines.push('');
    for (const filePath of fileSet) {
      const noteName = this.fileToNoteName(filePath);
      const fileSymbols = layerSymbols.filter(s => s.filePath === filePath);
      lines.push(`- [[${noteName}|${path.basename(filePath)}]] — ${fileSymbols.length} symbols`);
    }

    // Layer breakdown
    lines.push('');
    lines.push('## Layer Breakdown');
    lines.push('');
    for (const [layer, syms] of byLayer) {
      const color = LAYER_COLORS[layer as Layer] ?? LAYER_COLORS.unknown;
      lines.push(`- <span style="color:${color}">●</span> **${layer}**: ${syms.length} symbols`);
    }

    // Sub-modules (child directories)
    const childDirs = new Set<string>();
    for (const sym of layerSymbols) {
      const relDir = path.relative(dir, path.dirname(sym.filePath));
      if (relDir && !relDir.startsWith('..')) {
        const firstSeg = relDir.split(path.sep)[0];
        if (firstSeg) childDirs.add(path.join(dir, firstSeg));
      }
    }
    if (childDirs.size > 0) {
      lines.push('');
      lines.push('## Sub-modules');
      lines.push('');
      for (const child of childDirs) {
        const moduleNoteName = child.replace(/\//g, '-').replace(/\\/g, '-').replace(/^-/, '');
        lines.push(`- [[${moduleNoteName}|${path.basename(child)}/]]`);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('[[ _index | ← Back to Index]]');

    return lines.join('\n');
  }

  // ================================
  // Foam VSCode Settings (Graph Config)
  // ================================
  private generateFoamSettings(foamDir: string): string {
    const settings = {
      'foam.graph.views': {
        'Code Architecture': {
          colorBy: 'tag',
          groups: [
            {
              query: 'tag:layer/interface',
              color: LAYER_COLORS.interface,
              label: 'Interface Layer',
            },
            {
              query: 'tag:layer/business',
              color: LAYER_COLORS.business,
              label: 'Business Layer',
            },
            {
              query: 'tag:layer/data',
              color: LAYER_COLORS.data,
              label: 'Data Layer',
            },
            {
              query: 'tag:layer/utility',
              color: LAYER_COLORS.utility,
              label: 'Utility Layer',
            },
            {
              query: 'tag:codeatlas/index',
              color: '#f59e0b',
              label: 'Index',
            },
            {
              query: 'tag:codeatlas/module',
              color: '#a78bfa',
              label: 'Modules',
            },
          ],
        },
        'By Language': {
          colorBy: 'tag',
          groups: [
            { query: 'tag:lang/typescript', color: '#3178c6', label: 'TypeScript' },
            { query: 'tag:lang/javascript', color: '#f7df1e', label: 'JavaScript' },
            { query: 'tag:lang/python', color: '#3776ab', label: 'Python' },
            { query: 'tag:lang/go', color: '#00add8', label: 'Go' },
            { query: 'tag:lang/rust', color: '#dea584', label: 'Rust' },
          ],
        },
      },
      'foam.files.ignore': [
        '**/node_modules/**',
        '**/.git/**',
      ],
    };

    return JSON.stringify(settings, null, 2);
  }

  // ================================
  // Helpers
  // ================================

  /**
   * Convert a file path to a Foam-compatible note name.
   * e.g. "src/services/user-service.ts" → "src-services-user-service-ts"
   */
  private fileToNoteName(filePath: string): string {
    return filePath
      .replace(/[/\\]/g, '-')           // Replace path separators
      .replace(/\./g, '-')              // Replace dots
      .replace(/[^a-zA-Z0-9\-_]/g, '')  // Remove special chars
      .replace(/-+/g, '-')              // Collapse multiple dashes
      .replace(/^-|-$/g, '');           // Trim dashes
  }

  /** Group symbols by their file path */
  private groupByFile(symbols: Symbol[]): Map<string, Symbol[]> {
    const map = new Map<string, Symbol[]>();
    for (const s of symbols) {
      if (!map.has(s.filePath)) map.set(s.filePath, []);
      map.get(s.filePath)!.push(s);
    }
    return map;
  }

  /** Extract unique directory paths from the file list */
  private extractDirectories(fileNames: string[], filesDir: string): string[] {
    const dirs = new Set<string>();

    // Get all file paths from symbols
    const allLayers: Layer[] = ['interface', 'business', 'data', 'utility', 'unknown' as Layer];
    for (const layer of allLayers) {
      for (const sym of this.store.getSymbolsByLayer(layer)) {
        const dir = path.dirname(sym.filePath);
        if (dir && dir !== '.') {
          // Add all ancestor directories
          const parts = dir.split(/[/\\]/);
          for (let i = 1; i <= parts.length; i++) {
            dirs.add(parts.slice(0, i).join('/'));
          }
        }
      }
    }

    return Array.from(dirs).sort();
  }
}
