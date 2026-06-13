// ============================================================
// impact command - Analyze change impact
// ============================================================

import path from 'path';
import { SQLiteStore, ImpactAnalyzer } from '@codeatlas/core';

export async function impactCommand(symbolId: string, options: { depth?: string; project?: string }) {
  const projectPath = path.resolve(options?.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  try {
    // Try multiple ID formats (handle path separator differences)
    let symbol = store.getSymbol(symbolId);

    if (!symbol) {
      // Try with forward slashes
      const forwardId = symbolId.replace(/\\/g, '/');
      symbol = store.getSymbol(forwardId);
    }

    if (!symbol) {
      // Try with backslashes
      const backslashId = symbolId.replace(/\//g, '\\');
      symbol = store.getSymbol(backslashId);
    }

    if (!symbol) {
      // Try searching by name — handle partial ID (filePath:name → just name)
      const searchName = symbolId.includes(':') ? symbolId.split(':').pop()! : symbolId;
      let results = store.searchSymbols(searchName, { limit: 20 });

      // Also try partial name matching
      if (results.length === 0) {
        const allSymbols = store.searchSymbols('', { limit: 5000 });
        const matches = allSymbols.filter(s =>
          s.name.toLowerCase().includes(searchName.toLowerCase()) ||
          searchName.toLowerCase().includes(s.name.toLowerCase())
        );
        results = matches.slice(0, 20);
      }

      if (results.length === 1) {
        symbol = results[0];
      } else if (results.length > 1) {
        // Smart matching: prefer exact name match, then class/function
        const exactMatch = results.find(s => s.name === symbolId);
        if (exactMatch) {
          symbol = exactMatch;
        } else {
          // Pick the best match: class > function > method
          const priority: Record<string, number> = {
            class: 1, function: 2, method: 3, interface: 4,
            type: 5, enum: 6, variable: 10, constant: 11,
          };
          results.sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));
          symbol = results[0];

          // Show other matches if there are multiple
          if (results.length > 1) {
            console.log(`\n🔍 Found ${results.length} matches, using best match:\n`);
            console.log(`  ✅ ${symbol.name} (${symbol.kind}) @ ${symbol.filePath}:${symbol.startLine}`);
            console.log(`\n  Other matches:`);
            for (const s of results.slice(1, 4)) {
              console.log(`    - ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`);
            }
            console.log();
          }
        }
      }
    }

    if (!symbol) {
      console.log(`\n❌ Symbol "${symbolId}" not found\n`);
      console.log('  Tips:');
      console.log('  - Make sure you have scanned the project: codeatlas scan');
      console.log('  - Use codeatlas search to find symbols\n');
      return;
    }

    const depth = parseInt(options.depth || '2');
    const analyzer = new ImpactAnalyzer(store);
    const result = analyzer.analyze(symbol.id, depth, {
      limitPerDepth: 15, // Limit results per depth level
    });

    if (!result) {
      console.log(`\n❌ Could not analyze impact for "${symbol.name}"\n`);
      return;
    }

    console.log(`\n💥 Impact Analysis: ${symbol.name}`);
    console.log('═'.repeat(50));
    console.log(result.summary);

  } finally {
    store.close();
  }
}
