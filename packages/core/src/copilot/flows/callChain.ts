// ============================================================
// Flow: Call Chain — Who calls X? What does X call?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowCallChain(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  const target = resolveTarget(store, intent);
  if (!target) return { answer: '❓ Symbol not found', symbols: [], conclusions: ['Not found'] };
  const depth = options.mode === 'deep' ? 3 : 2;
  steps.push('lookup', 'callers', 'callees');
  const callers = store.getCallers(target.id);
  const callees = store.getCallees(target.id);
  let upstreamChain: any[] = [];
  let downstreamChain: any[] = [];
  if (options.mode === 'deep') {
    for (const c of callers.slice(0, 3)) { const cc = store.getCallers(c.id); upstreamChain.push(...cc); }
    for (const c of callees.slice(0, 3)) { const cc = store.getCallees(c.id); downstreamChain.push(...cc); }
  }
  const symbols = toSymbolRefs([target, ...callers, ...callees, ...upstreamChain.slice(0, 5), ...downstreamChain.slice(0, 5)]);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Call Chain: "' + target.name + '"');
  parts.push('═'.repeat(40));
  parts.push('\n⬆️ Upstream — Who calls ' + target.name + ' (' + callers.length + '):');
  for (const c of callers.slice(0, 8)) parts.push('  • ' + c.name + ' (' + c.kind + ') @ ' + c.filePath + ':' + c.startLine);
  if (options.mode === 'deep' && upstreamChain.length > 0) {
    parts.push('\n  📈 2nd-level callers:');
    const unique = [...new Map(upstreamChain.map((s: any) => [s.id, s])).values()].slice(0, 5);
    for (const c of unique) parts.push('    • ' + c.name + ' @ ' + c.filePath);
  }
  parts.push('\n⬇️ Downstream — What ' + target.name + ' calls (' + callees.length + '):');
  for (const c of callees.slice(0, 8)) parts.push('  • ' + c.name + ' (' + c.kind + ') @ ' + c.filePath + ':' + c.startLine);
  if (options.mode === 'deep' && downstreamChain.length > 0) {
    parts.push('\n  📉 2nd-level callees:');
    const unique = [...new Map(downstreamChain.map((s: any) => [s.id, s])).values()].slice(0, 5);
    for (const c of unique) parts.push('    • ' + c.name + ' @ ' + c.filePath);
  }
  conclusions.push(callers.length + ' callers, ' + callees.length + ' callees');
  return { answer: parts.join('\n'), symbols, conclusions };
}
