// ============================================================
// Flow: Find Code — Where is the code that handles X?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { toSymbolRefs } from './_shared.js';

export function flowFindCode(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  steps.push('search');
  const query = intent.target ?? intent.keywords.join(' ');
  let results = store.searchSymbols(query, { limit: 15 });
  if (results.length < 3) {
    for (const kw of intent.keywords.slice(0, 3)) {
      const more = store.searchSymbols(kw, { limit: 5 });
      for (const m of more) { if (!results.find(r => r.id === m.id)) results.push(m); }
    }
  }
  const symbols = toSymbolRefs(results);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Code Search: "' + query + '"');
  parts.push('═'.repeat(40));
  if (results.length === 0) { parts.push('❌ No matching code found. Try different keywords.'); conclusions.push('No results'); }
  else {
    const byKind = new Map<string, any[]>();
    for (const s of results) { if (!byKind.has(s.kind)) byKind.set(s.kind, []); byKind.get(s.kind)!.push(s); }
    parts.push('Found ' + results.length + ' symbol(s):\n');
    for (const [kind, syms] of byKind) {
      parts.push('**' + kind.charAt(0).toUpperCase() + kind.slice(1) + 's:**');
      for (const s of syms.slice(0, 5)) {
        const layerTag = s.layer !== 'unknown' ? ' [' + s.layer + ']' : '';
        parts.push('  • ' + s.name + layerTag + ' @ ' + s.filePath + ':' + s.startLine);
        if (s.docComment) parts.push('    ' + s.docComment.slice(0, 100));
      }
    }
    conclusions.push(results.length + ' symbols found');
  }
  return { answer: parts.join('\n'), symbols, conclusions };
}
