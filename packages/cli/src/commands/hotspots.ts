// ============================================================
// hotspots command - Find complex, high-risk code symbols
// ============================================================

import path from 'path';
import { SQLiteStore } from '@codeatlas/core';

export async function hotspotsCommand(options: {
  format?: string;
  project?: string;
  limit?: number;
  'min-score'?: number;
  kind?: string;
  layer?: string;
}) {
  const projectPath = path.resolve(options.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  try {
    const allSymbols = store.searchSymbols('', { limit: 10000 });
    const symbolIds = allSymbols.map(s => s.id);
    const callerCounts = store.getCallerCounts(symbolIds);
    const calleeCounts = store.getCalleeCounts(symbolIds);
    const limit = Math.min(options.limit ?? 10, 100);
    const minScore = options['min-score'] ?? 0;

    const hotspots: Array<{
      name: string; kind: string; file: string; line: number;
      layer: string; reason: string; score: number;
    }> = [];

    for (const symbol of allSymbols) {
      // Apply kind/layer filter
      if (options.kind && symbol.kind !== options.kind) continue;
      if (options.layer && symbol.layer !== options.layer) continue;

      let score = 0;
      const reasons: string[] = [];

      // Caller count
      const callerCount = callerCounts.get(symbol.id) ?? 0;
      if (callerCount > 3) {
        score += callerCount;
        reasons.push(`${callerCount} callers`);
      }

      // Callee count
      const calleeCount = calleeCounts.get(symbol.id) ?? 0;
      if (calleeCount > 3) {
        score += calleeCount;
        reasons.push(`${calleeCount} callees`);
      }

      // Code line count
      if (symbol.sourceCode) {
        const lines = symbol.sourceCode.split('\n').length;
        if (lines > 30) {
          const lineScore = Math.floor(lines / 10);
          score += lineScore;
          reasons.push(`${lines} lines`);
        }
      }

      if (score < minScore) continue;

      hotspots.push({
        name: symbol.name,
        kind: symbol.kind,
        file: symbol.filePath,
        line: symbol.startLine,
        layer: symbol.layer,
        reason: reasons.join(', '),
        score,
      });
    }

    // Sort by score descending
    hotspots.sort((a, b) => b.score - a.score);

    if (options.format === 'json') {
      console.log(JSON.stringify({ count: hotspots.length, limit, hotspots: hotspots.slice(0, limit) }, null, 2));
      return;
    }

    if (hotspots.length === 0) {
      console.log('\n🔥 Hotspots\n' + '═'.repeat(40));
      console.log('\n  ✅ No hotspots found. Codebase looks healthy!');
      return;
    }

    const display = hotspots.slice(0, limit);
    console.log(`\n🔥 Hotspots (${hotspots.length} found, showing top ${display.length})`);
    console.log('═'.repeat(50));
    for (const h of display) {
      const layerTag = h.layer !== 'unknown' ? ` [${h.layer}]` : '';
      console.log(`\n  🔶 ${h.name} (${h.kind})${layerTag}`);
      console.log(`     ${h.file}:${h.line}`);
      console.log(`     Score: ${h.score} — ${h.reason}`);
    }
    console.log();
  } finally {
    store.close();
  }
}
