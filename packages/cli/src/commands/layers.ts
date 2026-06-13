// ============================================================
// layers command - Show architecture layer classification
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

interface LayersOptions {
  byFile?: boolean;
  sort?: string;
  limit?: number;
}

export async function layersCommand(options: LayersOptions = {}) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const stats = store.getStats();

    if (stats.symbols === 0) {
      console.log('\n⚠️  No symbols found in the graph.');
      console.log('  Run "codeatlas scan" first to build the code graph.\n');
      return;
    }

    // ── File-level aggregation view ──
    if (options.byFile) {
      await showFileSummary(store, stats, options);
      return;
    }

    // ── Layer view (default, unchanged) ──
    await showLayerView(store, stats);
  } finally {
    store.close();
  }
}

// ========================
// File-level aggregation table (like cloc)
// ========================

async function showFileSummary(store: SQLiteStore, stats: any, options: LayersOptions) {
  const allSymbols = store.searchSymbols('', { limit: 10000 });

  // Aggregate by file
  const fileMap = new Map<string, {
    symbols: number;
    kinds: Set<string>;
    layers: Map<string, number>;
    maxComplexity: number;
    topSymbol: string;
  }>();

  for (const s of allSymbols) {
    if (!fileMap.has(s.filePath)) {
      fileMap.set(s.filePath, {
        symbols: 0,
        kinds: new Set(),
        layers: new Map(),
        maxComplexity: 0,
        topSymbol: s.name,
      });
    }
    const entry = fileMap.get(s.filePath)!;
    entry.symbols++;
    entry.kinds.add(s.kind);
    entry.layers.set(s.layer, (entry.layers.get(s.layer) ?? 0) + 1);
    if (s.complexity && s.complexity > entry.maxComplexity) {
      entry.maxComplexity = s.complexity;
      entry.topSymbol = s.name;
    }
    // Track first named symbol for "top" if no complexity
    if (!entry.topSymbol && s.name !== s.filePath) {
      entry.topSymbol = s.name;
    }
  }

  // Sort by chosen field
  const sortField = options.sort ?? 'syms';
  const entries = Array.from(fileMap.entries()).sort((a, b) => {
    if (sortField === 'name') return a[0].localeCompare(b[0]);
    if (sortField === 'complexity') return b[1].maxComplexity - a[1].maxComplexity;
    return b[1].symbols - a[1].symbols; // default: syms
  });

  const limit = Math.min(options.limit ?? 25, entries.length);

  console.log('\n📊 File-level symbol summary');
  console.log('═'.repeat(70));
  console.log(`  ${stats.symbols} symbols across ${fileMap.size} files\n`);

  // Table header
  const header = [
    'File'.padEnd(36),
    'Syms'.padStart(5),
    'Kinds'.padEnd(14),
    'Layers'.padEnd(14),
    'MaxCpx'.padStart(6),
  ];
  console.log(`  ${header.join(' ')}`);
  console.log(`  ${'─'.repeat(75)}`);

  for (let i = 0; i < limit; i++) {
    const [file, entry] = entries[i];
    const relPath = file.length > 35 ? '…' + file.slice(-34) : file;
    const kindsStr = Array.from(entry.kinds).slice(0, 3).join(',');
    const layersStr = Array.from(entry.layers.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([l, c]) => `${l[0].toUpperCase()}${c}`)
      .join(' ');
    const cpxStr = entry.maxComplexity > 0 ? `${entry.maxComplexity}` : '—';

    const row = [
      relPath.padEnd(36),
      `${entry.symbols}`.padStart(5),
      kindsStr.padEnd(14),
      layersStr.padEnd(14),
      cpxStr.padStart(6),
    ];
    console.log(`  ${row.join(' ')}`);
  }

  if (entries.length > limit) {
    console.log(`\n  ... and ${entries.length - limit} more files (use --limit to show more)`);
  }

  // Footer distribution
  console.log(`\n  ${'─'.repeat(36)} total: ${stats.symbols} syms, ${stats.files} files, ${stats.relationships} rels`);
  console.log();
}

// ========================
// Layer view (original)
// ========================

async function showLayerView(store: SQLiteStore, stats: any) {
  console.log('\n🏗️  Architecture Layers');
  console.log('═'.repeat(50));
  console.log(`📊 Total: ${stats.symbols} symbols, ${stats.relationships} relationships, ${stats.files} files\n`);

  const layersList = ['interface', 'business', 'data', 'utility', 'unknown'] as const;

  const layerConfig: Record<string, { emoji: string; description: string }> = {
    interface: { emoji: '🔵', description: 'UI, API endpoints, CLI commands' },
    business: { emoji: '🟢', description: 'Business logic, services, domain models' },
    data: { emoji: '🟠', description: 'Database, repositories, data access' },
    utility: { emoji: '⚪', description: 'Helpers, utils, shared functions' },
    unknown: { emoji: '❓', description: 'Unclassified symbols' },
  };

  for (const layer of layersList) {
    const symbols = store.getSymbolsByLayer(layer);
    const config = layerConfig[layer];

    if (symbols.length === 0) continue;

    console.log(`${config.emoji} ${layer.toUpperCase()} (${symbols.length} symbols)`);
    console.log(`   ${config.description}`);

    // Group by file
    const byFile = new Map<string, typeof symbols>();
    for (const s of symbols) {
      if (!byFile.has(s.filePath)) {
        byFile.set(s.filePath, []);
      }
      byFile.get(s.filePath)!.push(s);
    }

    // Show files (max 5)
    let fileCount = 0;
    for (const [file, fileSymbols] of byFile) {
      if (fileCount >= 5) {
        console.log(`   ... and ${byFile.size - 5} more files`);
        break;
      }

      console.log(`\n   📄 ${file}`);

      // Show symbols (max 3 per file)
      let symCount = 0;
      for (const s of fileSymbols) {
        if (symCount >= 3) {
          console.log(`      ... and ${fileSymbols.length - 3} more symbols`);
          break;
        }
        console.log(`      • ${s.name} (${s.kind})`);
        symCount++;
      }

      fileCount++;
    }

    console.log();
  }

  // Layer distribution bar
  console.log('─'.repeat(50));
  console.log('📈 Layer Distribution:');

  for (const layer of layersList) {
    const symbols = store.getSymbolsByLayer(layer);
    const pct = stats.symbols > 0 ? Math.round((symbols.length / stats.symbols) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 5));
    console.log(`   ${layer.padEnd(10)} ${bar} ${pct}% (${symbols.length})`);
  }

  console.log();
}
