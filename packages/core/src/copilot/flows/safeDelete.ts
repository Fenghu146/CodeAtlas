// ============================================================
// Flow: Safe Delete — Can I safely delete this symbol?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { ImpactAnalyzer } from '../../analyzer/impact-analyzer.js';
import { GuardAnalyzer } from '../../analyzer/guard-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowSafeDelete(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  const target = resolveTarget(store, intent);
  if (!target) return { answer: '❓ Symbol not found', symbols: [], conclusions: ['Not found'] };
  steps.push('lookup', 'callers', 'impact', 'guard');
  const callers = store.getCallers(target.id);
  const callees = store.getCallees(target.id);
  const impact = new ImpactAnalyzer(store).analyze(target.id, 2);
  const guard = new GuardAnalyzer(store).check();
  const directSyms = impact ? impact.direct.map((d: any) => d.symbol) : [];
  const symbols = toSymbolRefs([target, ...callers, ...directSyms]);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Safe Delete Analysis: "' + target.name + '"');
  parts.push('═'.repeat(40));
  if (callers.length === 0) {
    parts.push('\n✅ **No callers found** — this symbol is NOT called by any other code.');
    if (target.exported) { parts.push('⚠️ However, it IS exported — external consumers may depend on it.'); conclusions.push('Exported but no internal callers'); }
    if (callees.length === 0) { parts.push('✅ No callees either — safe to delete.'); conclusions.push('Safe to delete'); }
    else { parts.push('ℹ️ It calls ' + callees.length + ' other symbol(s). Deleting it won\'t break them, but they may become orphaned.'); }
    if (impact && impact.direct.length === 0 && impact.indirect.length === 0) parts.push('✅ Zero blast radius — no other symbols affected.');
  } else {
    parts.push('\n❌ **Cannot safely delete** — ' + callers.length + ' caller(s) found:');
    for (const c of callers.slice(0, 8)) parts.push('  • ' + c.name + ' (' + c.kind + ') @ ' + c.filePath + ':' + c.startLine);
    if (callers.length > 8) parts.push('  ... and ' + (callers.length - 8) + ' more');
    if (impact) {
      parts.push('\n📊 Impact: ' + impact.direct.length + ' direct, ' + impact.indirect.length + ' indirect affected');
      parts.push('📁 Affected files: ' + impact.affectedFiles.length);
      conclusions.push('Not safe: ' + callers.length + ' callers, ' + impact.affectedFiles.length + ' files affected');
    } else { conclusions.push('Not safe: ' + callers.length + ' callers'); }
    parts.push('\n💡 To delete safely:\n  1. Migrate callers to an alternative\n  2. Remove all import references\n  3. Re-run this analysis to verify zero callers');
  }
  const violations = guard.violations.filter((v: any) => v.severity === 'error');
  if (violations.length > 0) parts.push('\n⚠️ Project has ' + violations.length + ' existing guard violation(s) — fix those first.');
  return { answer: parts.join('\n'), symbols, conclusions };
}
