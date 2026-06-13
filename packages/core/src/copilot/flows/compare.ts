import { SQLiteStore } from '../../store/sqlite-store.js';
import { PathFinder } from '../../analyzer/path-finder.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowCompare(store: SQLiteStore, projectPath: string, intent: Intent, options: AskOptions, steps: string[]): FlowResult {
  let t1: any = null, t2: any = null;
  if (intent.target && intent.secondaryTarget) {
    t1 = resolveTarget(store, { ...intent, target: intent.target });
    t2 = resolveTarget(store, { ...intent, target: intent.secondaryTarget });
  } else if (intent.target) {
    const parts = intent.rawQuestion.split(/\s+(?:and|与|和|vs\.?|versus)\s+/i);
    if (parts.length >= 2) { t1 = resolveTarget(store, { ...intent, target: parts[0].trim() }); t2 = resolveTarget(store, { ...intent, target: parts[1].trim() }); }
  }
  if (!t1 || !t2) return { answer: 'Need two symbols to compare.', symbols: [], conclusions: [] };
  steps.push('lookup', 'compare');
  const c1s = store.getCallers(t1.id), c1e = store.getCallees(t1.id);
  const c2s = store.getCallers(t2.id), c2e = store.getCallees(t2.id);
  const symbols = toSymbolRefs([t1, t2]);
  const conclusions: string[] = [];
  const p: string[] = [];
  p.push('📋 Compare: "' + t1.name + '" vs "' + t2.name + '"'); p.push(''.padEnd(50, '='));
  p.push('| Metric     | ' + t1.name + ' | ' + t2.name + ' |'); p.push('|------------|' + '-'.repeat(t1.name.length + 2) + '|' + '-'.repeat(t2.name.length + 2) + '|');
  p.push('| Kind       | ' + t1.kind + ' | ' + t2.kind + ' |'); p.push('| Layer      | ' + t1.layer + ' | ' + t2.layer + ' |');
  p.push('| Lines      | ' + (t1.endLine - t1.startLine + 1) + ' | ' + (t2.endLine - t2.startLine + 1) + ' |');
  p.push('| Complexity | ' + (t1.complexity ?? 'N/A') + ' | ' + (t2.complexity ?? 'N/A') + ' |');
  p.push('| Callers    | ' + c1s.length + ' | ' + c2s.length + ' |'); p.push('| Callees    | ' + c1e.length + ' | ' + c2e.length + ' |');
  p.push('| Exported   | ' + (t1.exported ? 'Yes' : 'No') + ' | ' + (t2.exported ? 'Yes' : 'No') + ' |');
  const pr = new PathFinder(store).find(t1.name, t2.name);
  if (pr.found) { p.push('\nConnection: ' + pr.summary); conclusions.push('Connected via ' + (pr.path.length - 1) + ' hops'); }
  else { p.push('\nNo direct connection.'); conclusions.push('No direct connection'); }
  return { answer: p.join('\n'), symbols, conclusions };
}
