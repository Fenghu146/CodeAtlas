// ============================================================
// Flow: Refactor — How should I refactor X?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { SmellDetector } from '../../analyzer/smell-detector.js';
import { ImpactAnalyzer } from '../../analyzer/impact-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowRefactor(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  const target = resolveTarget(store, intent);
  steps.push('smells', 'impact', 'guard');
  const smellDetector = new SmellDetector(store);
  const smells = target
    ? smellDetector.detect().filter((s: any) => s.symbols.some((sym: any) => sym.name.toLowerCase() === target.name.toLowerCase() || sym.file === target.filePath))
    : smellDetector.detect();
  const allSymbols: any[] = target ? [target] : [];
  const symbols = toSymbolRefs(allSymbols);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Refactor Analysis' + (target ? ': "' + target.name + '"' : ': Project-Wide'));
  parts.push('═'.repeat(40));
  if (smells.length > 0) {
    parts.push('\n🔍 ' + smells.length + ' refactoring opportunity(ies):\n');
    for (let i = 0; i < Math.min(smells.length, 6); i++) {
      const smell = smells[i];
      parts.push((i + 1) + '. [' + smell.type + '] ' + smell.description);
      parts.push('   Severity: ' + smell.severity);
      parts.push('   Symbols: ' + smell.symbols.map((s: any) => s.name + ' @ ' + s.file).join(', '));
      parts.push('   💡 Suggestion: ' + smell.suggestion + '\n');
    }
    conclusions.push(smells.length + ' refactor suggestions');
    if (target) {
      const impact = new ImpactAnalyzer(store).analyze(target.id, 2);
      if (impact) parts.push('⚠️ Refactoring "' + target.name + '" will affect ' + (impact.direct.length + impact.indirect.length) + ' symbol(s) across ' + impact.affectedFiles.length + ' file(s).\n   Risk level: ' + impact.risk);
    }
  } else {
    parts.push('\n✅ No obvious refactoring opportunities found.');
    conclusions.push('No refactoring needed');
  }
  return { answer: parts.join('\n'), symbols, conclusions };
}
