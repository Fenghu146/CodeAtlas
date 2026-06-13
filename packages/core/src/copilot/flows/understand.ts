// ============================================================
// Flow: Understand / Explain — What does X do?
// ============================================================

import { SQLiteStore } from '../../store/sqlite-store.js';
import { ContextBuilder } from '../../analyzer/context-builder.js';
import type { AskOptions } from '../graph-copilot.js';
import type { Intent } from '../intents.js';
import type { FlowResult } from './_shared.js';
import { resolveTarget, toSymbolRefs } from './_shared.js';

export function flowUnderstand(
  store: SQLiteStore, projectPath: string,
  intent: Intent, options: AskOptions, steps: string[],
): FlowResult {
  const target = resolveTarget(store, intent);
  if (!target) return { answer: '❓ Symbol not found', symbols: [], conclusions: ['Not found'] };
  steps.push('lookup', 'callers', 'callees', 'context');
  const callers = store.getCallers(target.id);
  const callees = store.getCallees(target.id);
  const ctxBuilder = new ContextBuilder(store);
  const ctx = ctxBuilder.buildReviewContext([target], { maxTokens: 2000, includeSource: 'full', includeCallers: true, includeCallees: true });
  const symbols = toSymbolRefs([target, ...callers.slice(0, 5), ...callees.slice(0, 5)]);
  const conclusions: string[] = [];
  const parts: string[] = [];
  parts.push('📋 Understanding: "' + target.name + '"');
  parts.push('═'.repeat(40));
  parts.push('Kind: ' + target.kind + ' | Layer: ' + target.layer + ' | Language: ' + target.language);
  parts.push('File: ' + target.filePath + ':' + target.startLine + '-' + target.endLine);
  parts.push('Exported: ' + (target.exported ? 'Yes' : 'No') + ' | Complexity: ' + (target.complexity ?? 'N/A'));
  if (target.aiSummary) parts.push('\n🤖 AI Summary: ' + target.aiSummary);
  if (target.docComment) parts.push('\n📖 Documentation: ' + target.docComment);
  if (callers.length > 0) {
    parts.push('\n⬆️ Called by (' + callers.length + '):');
    for (const c of callers.slice(0, 6)) parts.push('  • ' + c.name + ' (' + c.kind + ') @ ' + c.filePath);
    if (callers.length > 6) parts.push('  ... and ' + (callers.length - 6) + ' more');
  }
  if (callees.length > 0) {
    parts.push('\n⬇️ Calls (' + callees.length + '):');
    for (const c of callees.slice(0, 6)) parts.push('  • ' + c.name + ' (' + c.kind + ') @ ' + c.filePath);
    if (callees.length > 6) parts.push('  ... and ' + (callees.length - 6) + ' more');
  }
  if (target.sourceCode) {
    const lines = target.sourceCode.split('\n');
    const preview = lines.slice(0, 20).join('\n');
    parts.push('\n💻 Source (preview):');
    parts.push('```' + target.language);
    parts.push(preview);
    if (lines.length > 20) parts.push('// ... ' + (lines.length - 20) + ' more lines');
    parts.push('```');
  }
  conclusions.push(target.kind + ' in ' + target.layer + ' layer, ' + callers.length + ' callers, ' + callees.length + ' callees');
  return { answer: parts.join('\n'), symbols, conclusions };
}
