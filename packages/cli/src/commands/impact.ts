// ============================================================
// impact command - Analyze change impact
// ============================================================

import path from 'path';
import { SQLiteStore, ImpactAnalyzer } from '@codeatlas/core';
import { resolveSymbol } from '../lib/symbols.js';
import { openStore } from '../lib/store.js';

export async function impactCommand(symbolId: string, options: { depth?: string; project?: string }) {
  const projectPath = path.resolve(options?.project || process.cwd());
  const store = openStore(options);

  try {
    const resolved = resolveSymbol(store, symbolId);
    if (!resolved.ok) {
      console.log(`\n❌ ${resolved.message}\n`);
      console.log('  Tips:');
      console.log('  - Make sure you have scanned the project: codeatlas scan');
      console.log('  - Use codeatlas search to find symbols\n');
      return;
    }
    const symbol = resolved.symbol;

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
