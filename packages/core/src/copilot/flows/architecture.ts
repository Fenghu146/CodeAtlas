// ============================================================
// Flow: Architecture Overview
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { DepAnalyzer } from '../../analyzer/dep-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';

export function flowArchitecture(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  steps.push('stats', 'layers', 'deps');

  const stats = store.getStats();
  const dep = new DepAnalyzer(store, projectPath).analyze();

  const symbols: Array<{ name: string; kind: string; file: string; id: string }> = [];
  const conclusions: string[] = [];

  const parts: string[] = [];
  parts.push('📋 Architecture Overview');
  parts.push('═'.repeat(40));

  parts.push(`\n📊 Project Stats:`);
  parts.push(`  Files: ${stats.files}`);
  parts.push(`  Symbols: ${stats.symbols}`);
  parts.push(`  Relationships: ${stats.relationships}`);
  parts.push(`  Languages: ${stats.languages.join(', ')}`);

  const kindBreakdown = store.searchSymbols('', { limit: 10000 });
  const byKind = new Map<string, number>();
  const byLayer = new Map<string, number>();
  for (const s of kindBreakdown) {
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
  }

  parts.push('\n🔷 By Kind:');
  for (const [kind, count] of byKind) {
    if (count > 0) parts.push(`  ${kind}: ${count}`);
  }

  parts.push('\n🏗️ By Layer:');
  for (const [layer, count] of byLayer) {
    if (count > 0) parts.push(`  ${layer}: ${count}`);
  }

  parts.push(`\n🔗 Dependency Health: ${dep.score}/100`);
  if (dep.circular.length > 0) {
    parts.push(`  ⚠️ ${dep.circular.length} circular dependency chain(s):`);
    for (const c of dep.circular.slice(0, 3)) {
      parts.push(`    ${c.chain.join(' → ')}`);
    }
  } else {
    parts.push('  ✅ No circular dependencies');
  }
  if (dep.unused.length > 0) {
    parts.push(`  📦 ${dep.unused.length} unused package(s): ${dep.unused.slice(0, 5).join(', ')}`);
  }

  conclusions.push(`${stats.symbols} symbols, ${stats.files} files, dep health ${dep.score}/100`);

  return { answer: parts.join('\n'), symbols, conclusions };
}
