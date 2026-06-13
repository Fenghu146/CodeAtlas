// ============================================================
// diff command - Compare graph states
// ============================================================

import path from 'path';
import fs from 'fs';
import { SQLiteStore, DiffAnalyzer } from '@codeatlas/core';

export async function diffCommand(options: {
  baseline?: string;
  save?: string;
  format?: string;
}) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const analyzer = new DiffAnalyzer(store);

    // Save baseline mode
    if (options.save) {
      const savePath = path.resolve(options.save);
      analyzer.saveBaseline(savePath);

      // Output summary
      const stats = store.getStats();
      console.log(`✅ Baseline saved to ${savePath}`);
      console.log(`   📊 Snapshot: ${stats.symbols} symbols, ${stats.relationships} relationships, ${stats.files} files`);
      console.log(`   🌐 Languages: ${stats.languages.join(', ')}`);
      return;
    }

    // Compare mode
    const baselinePath = options.baseline ? path.resolve(options.baseline) : undefined;
    const result = analyzer.analyze(baselinePath);

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.summary);
    }

  } finally {
    store.close();
  }
}
