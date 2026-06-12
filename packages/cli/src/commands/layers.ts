// ============================================================
// layers command - Show architecture layer classification
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function layersCommand() {
  const store = await SQLiteStore.create({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const stats = store.getStats();

    if (stats.symbols === 0) {
      console.log('\n⚠️  No symbols found in the graph.');
      console.log('  Run "codeatlas scan" first to build the code graph.\n');
      return;
    }

    console.log('\n🏗️  Architecture Layers');
    console.log('═'.repeat(50));
    console.log(`📊 Total: ${stats.symbols} symbols, ${stats.relationships} relationships, ${stats.files} files\n`);

    const layers = ['interface', 'business', 'data', 'utility', 'unknown'] as const;

    const layerConfig: Record<string, { emoji: string; description: string }> = {
      interface: { emoji: '🔵', description: 'UI, API endpoints, CLI commands' },
      business: { emoji: '🟢', description: 'Business logic, services, domain models' },
      data: { emoji: '🟠', description: 'Database, repositories, data access' },
      utility: { emoji: '⚪', description: 'Helpers, utils, shared functions' },
      unknown: { emoji: '❓', description: 'Unclassified symbols' },
    };

    for (const layer of layers) {
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

    // Show distribution
    console.log('─'.repeat(50));
    console.log('📈 Layer Distribution:');

    for (const layer of layers) {
      const symbols = store.getSymbolsByLayer(layer);
      const pct = stats.symbols > 0 ? Math.round((symbols.length / stats.symbols) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 5));
      console.log(`   ${layer.padEnd(10)} ${bar} ${pct}% (${symbols.length})`);
    }

    console.log();
  } finally {
    store.close();
  }
}
