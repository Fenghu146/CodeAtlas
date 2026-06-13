// ============================================================
// info command - Show detailed symbol information
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function infoCommand(symbolId: string, options?: { project?: string }) {
  const projectPath = path.resolve(options?.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  try {
    // Try multiple ID formats (Windows path handling)
    const normalizedId = symbolId.replace(/\\/g, '/');
    let symbol = store.getSymbol(normalizedId);

    if (!symbol) {
      // Try with original ID
      symbol = store.getSymbol(symbolId);
    }

    if (!symbol) {
      // Try with backslashes (Windows)
      const backslashId = normalizedId.replace(/\//g, '\\');
      symbol = store.getSymbol(backslashId);
    }

    if (!symbol) {
      // Search by name as fallback
      // Handle partial ID format (filePath:name without line number): extract just the name
      const searchName = symbolId.includes(':') ? symbolId.split(':').pop()! : symbolId;
      const results = store.searchSymbols(searchName, { limit: 20 });

      if (results.length === 0) {
        console.log(`\n❌ Symbol "${symbolId}" not found\n`);
        console.log('  Tips:');
        console.log('  - Make sure you have scanned the project: codeatlas scan');
        console.log('  - Use codeatlas search to find symbols');
        console.log('  - ID format: filePath:name:startLine (e.g., src/index.ts:main:1)\n');
        return;
      }

      if (results.length === 1) {
        symbol = results[0];
      } else {
        // Smart matching: prefer class/function over variable
        const exactNameMatch = results.filter(s => s.name === symbolId);
        const preferred = exactNameMatch.length > 0 ? exactNameMatch : results;

        // Priority: class > function > method > interface > others
        const priority: Record<string, number> = {
          class: 1, function: 2, method: 3, interface: 4,
          type: 5, enum: 6, variable: 10, constant: 11,
        };

        // Language preference: C/C++ files get priority over JS/TS when kinds are close
        const cExts = new Set(['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx']);
        const jsExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

        preferred.sort((a, b) => {
          const kindDiff = (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99);
          if (kindDiff !== 0) return kindDiff;
          // Same kind: prefer C over JS (C struct vs JS class with same name)
          const aIsC = cExts.has(path.extname(a.filePath).toLowerCase());
          const bIsC = cExts.has(path.extname(b.filePath).toLowerCase());
          if (aIsC && !bIsC) return -1;
          if (!aIsC && bIsC) return 1;
          return 0;
        });
        symbol = preferred[0];

        // Show warning if multiple matches
        if (preferred.length > 1) {
          console.log(`\n⚠️  Multiple matches found, showing best match (${symbol.kind}):\n`);
          console.log(`  Selected: ${symbol.name} (${symbol.kind}) @ ${symbol.filePath}:${symbol.startLine}`);
          console.log(`  Other matches:`);
          for (const s of preferred.slice(1, 5)) {
            console.log(`    - ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`);
          }
          if (preferred.length > 5) {
            console.log(`    ... and ${preferred.length - 5} more`);
          }
          console.log();
        }
      }
    }

    // Display symbol info
    const layerEmoji: Record<string, string> = {
      interface: '🔵',
      business: '🟢',
      data: '🟠',
      utility: '⚪',
      unknown: '❓',
    };

    console.log(`\n${layerEmoji[symbol.layer] ?? '❓'} Symbol: ${symbol.name}`);
    console.log('─'.repeat(50));
    console.log(`  ID:         ${symbol.id}`);
    console.log(`  Kind:       ${symbol.kind}`);
    console.log(`  Layer:      ${symbol.layer}`);
    console.log(`  File:       ${symbol.filePath}:${symbol.startLine}-${symbol.endLine}`);
    console.log(`  Language:   ${symbol.language}`);
    console.log(`  Exported:   ${symbol.exported ? 'Yes' : 'No'}`);

    if (symbol.complexity !== undefined) {
      console.log(`  Complexity: ${symbol.complexity}`);
    }

    if (symbol.docComment) {
      console.log(`\n  📝 Documentation:`);
      console.log(`  ${symbol.docComment}`);
    }

    if (symbol.aiSummary) {
      console.log(`\n  🤖 AI Summary:`);
      console.log(`  ${symbol.aiSummary}`);
    }

    if (symbol.sourceCode) {
      console.log(`\n  💻 Source Code:`);
      console.log('  ' + '─'.repeat(46));
      const lines = symbol.sourceCode.split('\n');
      for (const line of lines.slice(0, 20)) {
        console.log(`  │ ${line}`);
      }
      if (lines.length > 20) {
        console.log(`  │ ... (${lines.length - 20} more lines)`);
      }
      console.log('  ' + '─'.repeat(46));
    }

    // Show relationships
    const outgoing = store.getRelationshipsFrom(symbol.id);
    const incoming = store.getRelationshipsTo(symbol.id);

    if (outgoing.length > 0) {
      console.log(`\n  🔗 Outgoing Relationships (${outgoing.length}):`);
      for (const rel of outgoing.slice(0, 10)) {
        const target = store.getSymbol(rel.targetId);
        console.log(`     → ${rel.kind}: ${target?.name ?? rel.targetId}`);
      }
      if (outgoing.length > 10) {
        console.log(`     ... and ${outgoing.length - 10} more`);
      }
    }

    if (incoming.length > 0) {
      console.log(`\n  🔗 Incoming Relationships (${incoming.length}):`);
      for (const rel of incoming.slice(0, 10)) {
        const source = store.getSymbol(rel.sourceId);
        console.log(`     ← ${rel.kind}: ${source?.name ?? rel.sourceId}`);
      }
      if (incoming.length > 10) {
        console.log(`     ... and ${incoming.length - 10} more`);
      }
    }

    console.log();
  } finally {
    store.close();
  }
}
