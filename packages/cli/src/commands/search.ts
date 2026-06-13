// ============================================================
// search command - Search for symbols
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function searchCommand(
  query: string,
  options: { kind?: string; layer?: string; limit?: string; project?: string },
) {
  const projectPath = path.resolve(options.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  try {
    const limit = Math.min(parseInt(options.limit || '20'), 200);
    const results = store.searchSymbols(query, {
      kind: options.kind as any,
      layer: options.layer as any,
      limit,
    });

    if (results.length === 0) {
      console.log(`\n🔍 No results found for "${query}"\n`);
      console.log('  Tips:');
      console.log('  - Make sure you have scanned the project: codeatlas scan');
      console.log('  - Try broader search terms');
      console.log('  - Use --kind or --layer to filter results\n');
      return;
    }

    console.log(`\n🔍 Found ${results.length} results for "${query}":\n`);

    // Group by layer
    const byLayer = new Map<string, typeof results>();
    for (const s of results) {
      if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
      byLayer.get(s.layer)!.push(s);
    }

    const layerColors: Record<string, string> = {
      interface: '🔵',
      business: '🟢',
      data: '🟠',
      utility: '⚪',
      unknown: '❓',
    };

    for (const [layer, symbols] of byLayer) {
      console.log(`  ${layerColors[layer] ?? '❓'} ${layer.toUpperCase()}`);
      for (const s of symbols) {
        const exportTag = s.exported ? ' [export]' : '';
        console.log(`     ${s.name} (${s.kind})${exportTag} @ ${s.filePath}:${s.startLine}`);
      }
      console.log();
    }
  } finally {
    store.close();
  }
}
