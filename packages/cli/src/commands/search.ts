// ============================================================
// search command - Search for symbols
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function searchCommand(
  query: string,
  options: { kind?: string; layer?: string; limit?: string; project?: string; file?: string },
) {
  const projectPath = path.resolve(options.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  try {
    const limit = Math.min(parseInt(options.limit || '20'), 200);

    // P0#1: Support regex pipe (|) — split query into multiple terms
    const searchTerms = query.includes('|') ? query.split('|').map(s => s.trim()).filter(Boolean) : [query];

    // Collect results from all search terms
    let results: any[] = [];
    const seenIds = new Set<string>();
    for (const term of searchTerms) {
      const termResults = store.searchSymbols(term, {
        kind: options.kind as any,
        layer: options.layer as any,
        limit,
      });
      for (const r of termResults) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          results.push(r);
        }
      }
      if (results.length >= limit) break;
    }

    // P0#3: --file filter — filter by file path
    if (options.file) {
      const fileQuery = options.file.replace(/\\/g, '/').toLowerCase();
      results = results.filter((s: any) =>
        s.filePath.toLowerCase().includes(fileQuery)
      );
    }

    if (results.length === 0) {
      console.log(`\n🔍 No results found for "${query}"\n`);
      console.log('  Tips:');
      console.log('  - Use | for OR search: llama_decode | llama_encode');
      console.log('  - Use --file to search within a file: --file "include/llama.h"');
      console.log('  - Use --limit 200 to show more results');
      console.log('  - Use --kind function or --layer business to filter\n');
      return;
    }

    console.log(`\n🔍 Found ${results.length} results for "${query}"${searchTerms.length > 1 ? ' (' + searchTerms.join(' | ') + ')' : ''}:\n`);

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
