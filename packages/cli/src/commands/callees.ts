// ============================================================
// callees command - Find all callees of a symbol
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function calleesCommand(symbolId: string, options?: { project?: string }) {
  const projectPath = path.resolve(options?.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
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

    // Find callees
    const callees = store.getCallees(symbol.id);

    if (callees.length === 0) {
      console.log(`\n📞 No callees found for "${symbol.name}"\n`);
      console.log('  This symbol does not call any other symbols.');
      console.log('  It might be:');
      console.log('  - A leaf function (no dependencies)');
      console.log('  - Using dynamic imports or callbacks\n');
      return;
    }

    console.log(`\n📞 Callees of "${symbol.name}" (${callees.length} found):\n`);

    // Group by file
    const byFile = new Map<string, typeof callees>();
    for (const callee of callees) {
      if (!byFile.has(callee.filePath)) {
        byFile.set(callee.filePath, []);
      }
      byFile.get(callee.filePath)!.push(callee);
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
