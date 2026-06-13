// ============================================================
// flow command - Call chain tracer
// ============================================================

import path from 'path';
import { SQLiteStore, FlowAnalyzer } from '@codeatlas/core';

export async function flowCommand(
  entrySymbol: string,
  options: { depth?: string; format?: string }
) {
  const depth = parseInt(options.depth || '5');
  const format = options.format || 'text';

  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    // Find the entry symbol
    const results = store.searchSymbols(entrySymbol, { limit: 5 });

    if (results.length === 0) {
      console.log(`\n❌ Symbol "${entrySymbol}" not found\n`);
      return;
    }

    // Use first result if exact match not found
    const entry = results.find(s => s.name === entrySymbol) ?? results[0];

    console.log(`\n📞 Tracing call chain for: ${entry.name}`);
    console.log(`   Max depth: ${depth}\n`);

    const analyzer = new FlowAnalyzer(store, depth);
    const result = analyzer.trace(entry.id);

    if (!result) {
      console.log('❌ Could not trace call chain');
      return;
    }

    if (format === 'mermaid') {
      console.log(FlowAnalyzer.formatAsMermaid(result));
    } else {
      console.log(FlowAnalyzer.formatAsText(result));
    }
  } finally {
    store.close();
  }
}
