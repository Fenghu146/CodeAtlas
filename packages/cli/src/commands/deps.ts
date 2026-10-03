// ============================================================
// deps command - Dependency health analysis
// ============================================================

import path from 'path';
import { SQLiteStore, DepAnalyzer } from '@codeatlas/core';
import { openStore, resolveProjectPath } from '../lib/store.js';

export async function depsCommand(options: { project?: string;
  format?: string;
  circular?: boolean;
}) {
  const store = openStore(options);

  try {
    const analyzer = new DepAnalyzer(store, process.cwd());
    const result = analyzer.analyze();

    if (options.circular) {
      // Only show circular dependencies
      if (result.circular.length === 0) {
        console.log('\n✅ No circular dependencies found\n');
      } else {
        console.log(`\n🔄 Circular Dependencies (${result.circular.length}):\n`);
        for (const c of result.circular) {
          console.log(`  ${c.chain.join(' → ')}`);
        }
      }
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Default: pretty print
    console.log(result.summary);

  } finally {
    store.close();
  }
}
