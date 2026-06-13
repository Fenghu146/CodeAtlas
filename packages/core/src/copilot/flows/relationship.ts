// ============================================================
// Flow: Relationship — How are X and Y related?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { PathFinder } from '../../analyzer/path-finder.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowRelationship(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  if (!intent.target || !intent.secondaryTarget) {
    const found = resolveTarget(store, intent);
    if (!found) return { answer: '❓ Need two symbols to analyze relationship.', symbols: [], conclusions: [] };
    return { answer: '❓ Need two symbols. Provide both names (e.g., "How are X and Y related?")', symbols: [], conclusions: [] };
  }
  steps.push('lookup', 'path');
  const finder = new PathFinder(store);
  const result = finder.find(intent.target, intent.secondaryTarget);
  const symbols = toSymbolRefs(result.path);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Relationship: "' + intent.target + '" ↔ "' + intent.secondaryTarget + '"');
  parts.push('═'.repeat(40));
  if (result.found) {
    parts.push('\n✅ Path found (' + result.path.length + ' hops):');
    for (let i = 0; i < result.path.length; i++) {
      const sym = result.path[i];
      const prefix = i === 0 ? '  🟢' : i === result.path.length - 1 ? '  🔴' : '  ⬜';
      parts.push(prefix + ' ' + sym.name + ' (' + sym.kind + ') @ ' + sym.filePath);
      if (i < result.relationships.length) parts.push('     ── ' + result.relationships[i].kind + ' ──▶');
    }
    conclusions.push('Connected via ' + (result.path.length - 1) + ' hops');
  } else {
    parts.push('\n❌ No direct path found between these symbols.');
    conclusions.push('No direct relationship found');
  }
  return { answer: parts.join('\n'), symbols, conclusions };
}
