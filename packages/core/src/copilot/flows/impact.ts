// ============================================================
// Flow: Impact Analysis — What happens if I change X?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { ImpactAnalyzer } from '../../analyzer/impact-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowImpact(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  const target = resolveTarget(store, intent);
  if (!target) return { answer: '❓ Symbol not found', symbols: [], conclusions: ['Not found'] };
  const depth = options.mode === 'deep' ? 4 : 2;
  steps.push('lookup', 'impact', 'callers', 'callees');
  const impact = new ImpactAnalyzer(store).analyze(target.id, depth);
  const callers = store.getCallers(target.id);
  const callees = store.getCallees(target.id);
  if (!impact) return { answer: '📋 Impact Analysis: "' + target.name + '"\n' + '═'.repeat(40) + '\n❌ Could not compute impact.', symbols: toSymbolRefs([target]), conclusions: ['Impact failed'] };
  const allSyms = [target, ...impact.direct.map((d: any) => d.symbol), ...impact.indirect.map((d: any) => d.symbol).slice(0, 10)];
  const symbols = toSymbolRefs(allSyms);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Impact Analysis: "' + target.name + '"');
  parts.push('═'.repeat(40));
  parts.push('Risk: **' + impact.risk.toUpperCase() + '**');
  parts.push('Direct effects: ' + impact.direct.length + ' | Indirect: ' + impact.indirect.length);
  parts.push('Affected files: ' + impact.affectedFiles.length);
  parts.push('Upstream (callers): ' + callers.length + ' | Downstream (callees): ' + callees.length);
  if (impact.direct.length > 0) {
    parts.push('\n🔴 Direct effects (1 hop):');
    for (const d of impact.direct.slice(0, 10)) parts.push('  • ' + d.symbol.name + ' (' + d.symbol.kind + ') @ ' + d.symbol.filePath + ' — via ' + d.relationshipKind);
  }
  if (impact.indirect.length > 0) {
    parts.push('\n🟡 Indirect effects (showing top ' + Math.min(impact.indirect.length, 8) + '):');
    for (const d of impact.indirect.slice(0, 8)) parts.push('  • ' + d.symbol.name + ' (' + d.symbol.kind + ') @ ' + d.symbol.filePath + ' — depth ' + d.depth);
  }
  conclusions.push(impact.risk + ' risk, ' + impact.affectedFiles.length + ' files, ' + (impact.direct.length + impact.indirect.length) + ' symbols');
  return { answer: parts.join('\n'), symbols, conclusions };
}
