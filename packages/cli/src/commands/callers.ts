// ============================================================
// callers command - Find all callers of a symbol
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function callersCommand(symbolId: string) {
  const store = await SQLiteStore.create({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    // Try multiple ID formats (handle path separator differences)
    let symbol = store.getSymbol(symbolId);

    // Try with forward slashes
    if (!symbol) {
      const forwardId = symbolId.replace(/\\/g, '/');
      symbol = store.getSymbol(forwardId);
    }

    // Try with backslashes
    if (!symbol) {
      const backslashId = symbolId.replace(/\//g, '\\');
      symbol = store.getSymbol(backslashId);
    }

    if (!symbol) {
      // Try searching by name
      const results = store.searchSymbols(symbolId, { limit: 5 });
      if (results.length === 1) {
        symbol = results[0];
      } else if (results.length > 1) {
        console.log(`\n🔍 Found ${results.length} symbols matching "${symbolId}":\n`);
        for (const s of results) {
          console.log(`  - ${s.id}`);
          console.log(`    ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`);
        }
        console.log('\n  Please use the full ID\n');
        return;
      }
    }

    if (!symbol) {
      console.log(`\n❌ Symbol "${symbolId}" not found\n`);
      console.log('  Tips:');
      console.log('  - Make sure you have scanned the project: codeatlas scan');
      console.log('  - Use codeatlas search to find symbols\n');
      return;
    }

    // Find callers
    const callers = store.getCallers(symbol.id);

    if (callers.length === 0) {
      console.log(`\n📞 No callers found for "${symbol.name}"\n`);
      console.log('  This symbol is not called by any other symbol in the codebase.');
      console.log('  It might be:');
      console.log('  - An entry point (main, exported function)');
      console.log('  - Dead code (unused)');
      console.log('  - Called dynamically (not detected by static analysis)\n');
      return;
    }

    console.log(`\n📞 Callers of "${symbol.name}" (${callers.length} found):\n`);

    // Group by file
    const byFile = new Map<string, typeof callers>();
    for (const caller of callers) {
      if (!byFile.has(caller.filePath)) {
        byFile.set(caller.filePath, []);
      }
      byFile.get(caller.filePath)!.push(caller);
    }

    for (const [file, symbols] of byFile) {
      console.log(`  📄 ${file}`);
      for (const s of symbols) {
        const exportTag = s.exported ? ' [export]' : '';
        console.log(`     • ${s.name} (${s.kind})${exportTag} @ line ${s.startLine}`);
      }
      console.log();
    }
  } finally {
    store.close();
  }
}
