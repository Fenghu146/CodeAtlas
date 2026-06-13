// ============================================================
// Flow: Code Review — Is there anything wrong with X?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { SmellDetector } from '../../analyzer/smell-detector.js';
import { GuardAnalyzer } from '../../analyzer/guard-analyzer.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowCodeReview(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  const target = resolveTarget(store, intent);
  steps.push('smells', 'guard');
  const smellDetector = new SmellDetector(store);
  const smells = target
    ? smellDetector.detect().filter((s: any) => s.symbols.some((sym: any) => sym.name.toLowerCase() === target.name.toLowerCase() || sym.file === target.filePath))
    : smellDetector.detect();
  const guard = new GuardAnalyzer(store).check();
  const allSymbols: any[] = target ? [target] : [];
  if (smells.length > 0) {
    for (const smell of smells) {
      for (const s of smell.symbols) {
        const found = store.searchSymbols(s.name, { limit: 1 });
        if (found.length > 0) allSymbols.push(found[0]);
      }
    }
  }
  const symbols = toSymbolRefs(allSymbols);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Code Review' + (target ? ': "' + target.name + '"' : ': Full Project'));
  parts.push('═'.repeat(40));
  if (smells.length > 0) {
    parts.push('\n🔍 Code Smells Found: ' + smells.length);
    for (const smell of smells.slice(0, 8)) {
      const sev = smell.severity === 'error' ? '🔴' : smell.severity === 'warning' ? '🟡' : '🔵';
      parts.push('  ' + sev + ' [' + smell.type + '] ' + smell.description);
      parts.push('     Symbols: ' + smell.symbols.map((s: any) => s.name).join(', '));
      parts.push('     Fix: ' + smell.suggestion);
    }
    conclusions.push(smells.length + ' code smells detected');
  } else {
    parts.push('\n✅ No code smells detected.');
    conclusions.push('No code smells');
  }
  const guardErrors = guard.violations.filter((v: any) => v.severity === 'error');
  const guardWarnings = guard.violations.filter((v: any) => v.severity === 'warning');
  if (guardErrors.length > 0 || guardWarnings.length > 0) {
    parts.push('\n🛡️ Architecture Guard: ' + guardErrors.length + ' errors, ' + guardWarnings.length + ' warnings');
    for (const v of guardErrors.slice(0, 5)) parts.push('  🔴 ' + v.message);
    for (const v of guardWarnings.slice(0, 5)) parts.push('  🟡 ' + v.message);
  }
  if (target) {
    const srcLen = target.sourceCode ? target.sourceCode.split('\n').length : 0;
    parts.push('\n📊 Metrics:');
    parts.push('  Complexity: ' + (target.complexity ?? 'N/A'));
    parts.push('  Lines: ' + srcLen);
    parts.push('  Layer: ' + target.layer);
  }
  return { answer: parts.join('\n'), symbols, conclusions };
}
