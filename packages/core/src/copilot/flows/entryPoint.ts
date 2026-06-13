// ============================================================
// Flow: Entry Point — Where does the app start?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { toSymbolRefs } from './_shared.js';

export function flowEntryPoint(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  steps.push('search');
  const entryPatterns = ['main', 'index', 'app', 'server', 'bootstrap', 'start', 'run', 'handler'];
  const results: any[] = [];
  const seen = new Set<string>();
  for (const pattern of entryPatterns) {
    const matches = store.searchSymbols(pattern, { limit: 5 });
    for (const m of matches) { if (!seen.has(m.id)) { seen.add(m.id); results.push(m); } }
  }
  const likelyEntries = results.filter((s: any) => s.exported || s.kind === 'function' || s.kind === 'module');
  const symbols = toSymbolRefs(likelyEntries.slice(0, 10));
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Entry Points');
  parts.push('═'.repeat(40));
  if (likelyEntries.length > 0) {
    parts.push('\nFound ' + likelyEntries.length + ' potential entry point(s):\n');
    for (const s of likelyEntries.slice(0, 10)) {
      const callers = store.getCallers(s.id);
      const isRoot = callers.length === 0;
      parts.push('  ' + (isRoot ? '🟢' : '⬜') + ' ' + s.name + ' (' + s.kind + ') @ ' + s.filePath + ':' + s.startLine + (isRoot ? ' [ROOT]' : ''));
    }
    conclusions.push(likelyEntries.length + ' entry points found');
  } else {
    parts.push('\n❌ No obvious entry points found.');
  }
  return { answer: parts.join('\n'), symbols, conclusions };
}
