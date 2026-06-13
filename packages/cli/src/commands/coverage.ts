// ============================================================
// coverage command - Test coverage mapping
// ============================================================

import path from 'path';
import { SQLiteStore, CoverageAnalyzer } from '@codeatlas/core';

export async function coverageCommand(options: { symbol?: string; format?: string }) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const analyzer = new CoverageAnalyzer(store);

    if (options.symbol) {
      // Show coverage for specific symbol
      const results = store.searchSymbols(options.symbol, { limit: 5 });

      if (results.length === 0) {
        console.log(`\n❌ Symbol "${options.symbol}" not found\n`);
        return;
      }

      const symbol = results.find(s => s.name === options.symbol) ?? results[0];
      const report = analyzer.analyze();
      const detail = report.coverageDetails.find(c => c.symbol.id === symbol.id);

      if (detail) {
        console.log(`\n📊 Coverage for ${symbol.name}:`);
        console.log('─'.repeat(40));
        console.log(`  Has test: ${detail.hasTest ? '✅ Yes' : '❌ No'}`);
        if (detail.testFiles.length > 0) {
          console.log('  Test files:');
          for (const f of detail.testFiles) {
            console.log(`    - ${f}`);
          }
        }
        if (detail.testSymbolNames.length > 0) {
          console.log('  Test functions:');
          for (const n of detail.testSymbolNames) {
            console.log(`    - ${n}`);
          }
        }
      }
    } else {
      // Show full coverage report
      const report = analyzer.analyze();
      console.log(CoverageAnalyzer.formatReport(report));
    }
  } finally {
    store.close();
  }
}
