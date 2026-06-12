// ============================================================
// Graph Copilot — Smart agent that maximizes code graph value
// ============================================================
// Single entry point for AI assistants. Internally orchestrates
// multiple analyzers based on recognized intent, maintains
// session memory, and returns structured actionable conclusions.
//
// Usage:
//   const copilot = new GraphCopilot(store, projectPath);
//   const result = await copilot.ask("Can I safely delete UserService?");
//   console.log(result.answer); // Structured, actionable answer

import { SQLiteStore } from '../store/sqlite-store.js';
import { ImpactAnalyzer } from '../analyzer/impact-analyzer.js';
import { GuardAnalyzer } from '../analyzer/guard-analyzer.js';
import { DepAnalyzer } from '../analyzer/dep-analyzer.js';
import { PathFinder } from '../analyzer/path-finder.js';
import { SmellDetector } from '../analyzer/smell-detector.js';
import { ContextBuilder } from '../analyzer/context-builder.js';
import { CoverageAnalyzer } from '../analyzer/coverage-analyzer.js';
import { EmbeddedAnalyzer } from '../analyzer/embedded-analyzer.js';
import { recognizeIntent, type Intent, type IntentType } from './intents.js';
import { SessionManager } from './session.js';
import type { Symbol } from '../graph/types.js';

// ========================
// Public Types
// ========================

export interface AskOptions {
  /** Analysis depth: 'quick' skips heavy analysis, 'deep' runs full pipeline */
  mode?: 'quick' | 'deep';
  /** Session ID for multi-turn memory */
  sessionId?: string;
  /** Override the recognized intent */
  intent?: IntentType;
  /** Max symbols to include in answer */
  maxSymbols?: number;
  /** Project path for DepAnalyzer */
  projectPath?: string;
}

export interface AskResult {
  /** The structured answer — ready for Claude to consume */
  answer: string;
  /** Recognized intent */
  intent: IntentType;
  /** Confidence in intent recognition (0-1) */
  confidence: number;
  /** Symbols referenced in the answer */
  symbols: Array<{ name: string; kind: string; file: string; id: string }>;
  /** Internal analysis steps taken */
  steps: string[];
  /** Time taken in ms */
  duration: number;
}

// ========================
// Graph Copilot
// ========================

export class GraphCopilot {
  private store: SQLiteStore;
  private session: SessionManager;
  private projectPath: string;

  constructor(store: SQLiteStore, projectPath: string = process.cwd()) {
    this.store = store;
    this.session = new SessionManager();
    this.projectPath = projectPath;
  }

  /**
   * Main entry point — ask anything about the code graph.
   */
  async ask(question: string, options: AskOptions = {}): Promise<AskResult> {
    const startTime = Date.now();
    const sessionId = options.sessionId ?? 'default';

    // 1. Resolve cross-turn references
    const resolvedQuestion = this.session.resolveReferences(sessionId, question);

    // 2. Recognize intent
    const intent = recognizeIntent(resolvedQuestion);
    if (options.intent) {
      intent.type = options.intent;
      intent.confidence = 1;
    }

    // 3. Dispatch to the right analysis flow
    const steps: string[] = [];
    let answer: string;
    let symbols: Array<{ name: string; kind: string; file: string; id: string }> = [];
    let conclusions: string[] = [];

    switch (intent.type) {
      case 'safe_delete':
        ({ answer, symbols, conclusions } = this.flowSafeDelete(intent, options, steps));
        break;
      case 'impact':
        ({ answer, symbols, conclusions } = this.flowImpact(intent, options, steps));
        break;
      case 'understand':
        ({ answer, symbols, conclusions } = this.flowUnderstand(intent, options, steps));
        break;
      case 'relationship':
        ({ answer, symbols, conclusions } = this.flowRelationship(intent, options, steps));
        break;
      case 'call_chain':
        ({ answer, symbols, conclusions } = this.flowCallChain(intent, options, steps));
        break;
      case 'code_review':
        ({ answer, symbols, conclusions } = this.flowCodeReview(intent, options, steps));
        break;
      case 'find_code':
        ({ answer, symbols, conclusions } = this.flowFindCode(intent, options, steps));
        break;
      case 'architecture':
        ({ answer, symbols, conclusions } = this.flowArchitecture(intent, options, steps));
        break;
      case 'refactor':
        ({ answer, symbols, conclusions } = this.flowRefactor(intent, options, steps));
        break;
      case 'overview':
        ({ answer, symbols, conclusions } = this.flowOverview(intent, options, steps));
        break;
      case 'entry_point':
        ({ answer, symbols, conclusions } = this.flowEntryPoint(intent, options, steps));
        break;
      case 'compare':
        ({ answer, symbols, conclusions } = this.flowCompare(intent, options, steps));
        break;
      case 'test_coverage':
        ({ answer, symbols, conclusions } = this.flowTestCoverage(intent, options, steps));
        break;
      case 'embedded_linux':
        ({ answer, symbols, conclusions } = this.flowEmbeddedLinux(intent, options, steps));
        break;
      default:
        ({ answer, symbols, conclusions } = this.flowFreeForm(intent, options, steps));
        break;
    }

    // 4. Append session context if multi-turn
    const sessionCtx = this.session.getContextSummary(sessionId);
    if (sessionCtx) {
      answer += `\n\n---\n📝 ${sessionCtx}`;
    }

    // 5. Record this turn
    this.session.recordTurn(sessionId, {
      question,
      intent: intent.type,
      target: intent.target,
      symbols,
      conclusions,
    });

    return {
      answer,
      intent: intent.type,
      confidence: intent.confidence,
      symbols,
      steps,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Reset session memory.
   */
  resetSession(sessionId: string = 'default'): void {
    this.session.reset(sessionId);
  }

  // ========================
  // Flow: Safe Delete
  // ========================

  private flowSafeDelete(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    if (!target) return this.notFound(intent);

    steps.push('lookup', 'callers', 'impact', 'guard');

    const callers = this.store.getCallers(target.id);
    const callees = this.store.getCallees(target.id);
    const impact = new ImpactAnalyzer(this.store).analyze(target.id, 2);
    const guard = new GuardAnalyzer(this.store).check();

    const directSyms = impact ? impact.direct.map((d: any) => d.symbol) : [];
    const symbols = this.toSymbolRefs([target, ...callers, ...directSyms]);
    const conclusions: string[] = [];

    // Build answer
    const parts: string[] = [];
    parts.push(`📋 Safe Delete Analysis: "${target.name}"`);
    parts.push('═'.repeat(40));

    if (callers.length === 0) {
      parts.push('');
      parts.push('✅ **No callers found** — this symbol is NOT called by any other code.');

      // Check if it's exported (might be a public API)
      if (target.exported) {
        parts.push('⚠️ However, it IS exported — external consumers may depend on it.');
        conclusions.push('Exported but no internal callers');
      }

      if (callees.length === 0) {
        parts.push('✅ No callees either — safe to delete.');
        conclusions.push('Safe to delete');
      } else {
        parts.push(`ℹ️ It calls ${callees.length} other symbol(s). Deleting it won't break them, but they may become orphaned.`);
      }

      // Check impact
      if (impact && impact.direct.length === 0 && impact.indirect.length === 0) {
        parts.push('✅ Zero blast radius — no other symbols affected.');
      }
    } else {
      parts.push('');
      parts.push(`❌ **Cannot safely delete** — ${callers.length} caller(s) found:`);
      for (const c of callers.slice(0, 8)) {
        parts.push(`  • ${c.name} (${c.kind}) @ ${c.filePath}:${c.startLine}`);
      }
      if (callers.length > 8) parts.push(`  ... and ${callers.length - 8} more`);

      parts.push('');
      if (impact) {
        parts.push(`📊 Impact: ${impact.direct.length} direct, ${impact.indirect.length} indirect affected`);
        parts.push(`📁 Affected files: ${impact.affectedFiles.length}`);
        conclusions.push(`Not safe: ${callers.length} callers, ${impact.affectedFiles.length} files affected`);
      } else {
        conclusions.push(`Not safe: ${callers.length} callers`);
      }

      parts.push('');
      parts.push('💡 To delete safely:');
      parts.push('  1. Migrate callers to an alternative implementation');
      parts.push('  2. Remove all import references');
      parts.push('  3. Re-run this analysis to verify zero callers');
    }

    // Guard check
    const violations = guard.violations.filter((v: any) => v.severity === 'error');
    if (violations.length > 0) {
      parts.push('');
      parts.push(`⚠️ Project has ${violations.length} existing guard violation(s) — fix those first.`);
    }

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Impact Analysis
  // ========================

  private flowImpact(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    if (!target) return this.notFound(intent);

    const depth = options.mode === 'deep' ? 4 : 2;
    steps.push('lookup', 'impact', 'callers', 'callees');

    const impact = new ImpactAnalyzer(this.store).analyze(target.id, depth);
    const callers = this.store.getCallers(target.id);
    const callees = this.store.getCallees(target.id);

    if (!impact) {
      return {
        answer: `📋 Impact Analysis: "${target.name}"\n${'═'.repeat(40)}\n❌ Could not compute impact. Symbol may have no outgoing relationships.`,
        symbols: this.toSymbolRefs([target]),
        conclusions: ['Impact analysis failed'],
      };
    }

    const allSymbols = [target, ...impact.direct.map((d: any) => d.symbol), ...impact.indirect.map((d: any) => d.symbol).slice(0, 10)];
    const symbols = this.toSymbolRefs(allSymbols);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Impact Analysis: "${target.name}"`);
    parts.push('═'.repeat(40));
    parts.push(`Risk: **${impact.risk.toUpperCase()}**`);
    parts.push(`Direct effects: ${impact.direct.length} | Indirect: ${impact.indirect.length}`);
    parts.push(`Affected files: ${impact.affectedFiles.length}`);
    parts.push(`Upstream (callers): ${callers.length} | Downstream (callees): ${callees.length}`);

    // Direct effects
    if (impact.direct.length > 0) {
      parts.push('');
      parts.push('🔴 Direct effects (1 hop):');
      for (const d of impact.direct.slice(0, 10)) {
        parts.push(`  • ${d.symbol.name} (${d.symbol.kind}) @ ${d.symbol.filePath} — via ${d.relationshipKind}`);
      }
    }

    // Indirect effects
    if (impact.indirect.length > 0) {
      parts.push('');
      parts.push(`🟡 Indirect effects (2+ hops, showing top ${Math.min(impact.indirect.length, 8)}):`);
      for (const d of impact.indirect.slice(0, 8)) {
        parts.push(`  • ${d.symbol.name} (${d.symbol.kind}) @ ${d.symbol.filePath} — depth ${d.depth}`);
      }
    }

    // Affected files
    if (impact.affectedFiles.length > 0) {
      parts.push('');
      parts.push('📁 Affected files:');
      for (const f of impact.affectedFiles.slice(0, 10)) {
        parts.push(`  • ${f}`);
      }
    }

    conclusions.push(`${impact.risk} risk, ${impact.affectedFiles.length} files, ${impact.direct.length + impact.indirect.length} symbols affected`);

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Understand / Explain
  // ========================

  private flowUnderstand(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    if (!target) return this.notFound(intent);

    steps.push('lookup', 'callers', 'callees', 'context');

    const callers = this.store.getCallers(target.id);
    const callees = this.store.getCallees(target.id);
    const ctxBuilder = new ContextBuilder(this.store);
    const ctx = ctxBuilder.buildReviewContext([target], {
      maxTokens: 2000,
      includeSource: 'full',
      includeCallers: true,
      includeCallees: true,
    });

    const symbols = this.toSymbolRefs([target, ...callers.slice(0, 5), ...callees.slice(0, 5)]);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Understanding: "${target.name}"`);
    parts.push('═'.repeat(40));
    parts.push(`Kind: ${target.kind} | Layer: ${target.layer} | Language: ${target.language}`);
    parts.push(`File: ${target.filePath}:${target.startLine}-${target.endLine}`);
    parts.push(`Exported: ${target.exported ? 'Yes' : 'No'} | Complexity: ${target.complexity ?? 'N/A'}`);

    // AI summary if available
    if (target.aiSummary) {
      parts.push('');
      parts.push(`🤖 AI Summary: ${target.aiSummary}`);
    }

    // Doc comment
    if (target.docComment) {
      parts.push('');
      parts.push(`📖 Documentation: ${target.docComment}`);
    }

    // Callers
    if (callers.length > 0) {
      parts.push('');
      parts.push(`⬆️ Called by (${callers.length}):`);
      for (const c of callers.slice(0, 6)) {
        parts.push(`  • ${c.name} (${c.kind}) @ ${c.filePath}`);
      }
      if (callers.length > 6) parts.push(`  ... and ${callers.length - 6} more`);
    }

    // Callees
    if (callees.length > 0) {
      parts.push('');
      parts.push(`⬇️ Calls (${callees.length}):`);
      for (const c of callees.slice(0, 6)) {
        parts.push(`  • ${c.name} (${c.kind}) @ ${c.filePath}`);
      }
      if (callees.length > 6) parts.push(`  ... and ${callees.length - 6} more`);
    }

    // Source preview
    if (target.sourceCode) {
      const lines = target.sourceCode.split('\n');
      const preview = lines.slice(0, 20).join('\n');
      parts.push('');
      parts.push('💻 Source (preview):');
      parts.push('```' + target.language);
      parts.push(preview);
      if (lines.length > 20) parts.push(`// ... ${lines.length - 20} more lines`);
      parts.push('```');
    }

    conclusions.push(`${target.kind} in ${target.layer} layer, ${callers.length} callers, ${callees.length} callees`);

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Relationship
  // ========================

  private flowRelationship(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    if (!intent.target || !intent.secondaryTarget) {
      // Try to find two targets from keywords
      const found = this.resolveTargetsFromKeywords(intent.keywords, 2);
      if (found.length < 2) {
        return {
          answer: `❓ Need two symbols to analyze relationship. Provide both names (e.g., "How are UserService and UserRepository related?")`,
          symbols: [], conclusions: [],
        };
      }
      intent.target = found[0].name;
      intent.secondaryTarget = found[1].name;
    }

    steps.push('lookup', 'path');

    const finder = new PathFinder(this.store);
    const result = finder.find(intent.target, intent.secondaryTarget);

    const symbols = this.toSymbolRefs(result.path);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Relationship: "${intent.target}" ↔ "${intent.secondaryTarget}"`);
    parts.push('═'.repeat(40));

    if (result.found) {
      parts.push('');
      parts.push(`✅ Path found (${result.path.length} hops):`);
      for (let i = 0; i < result.path.length; i++) {
        const sym = result.path[i];
        const prefix = i === 0 ? '  🟢' : i === result.path.length - 1 ? '  🔴' : '  ⬜';
        parts.push(`${prefix} ${sym.name} (${sym.kind}) @ ${sym.filePath}`);
        if (i < result.relationships.length) {
          const rel = result.relationships[i];
          parts.push(`     ── ${rel.kind} ──▶`);
        }
      }
      conclusions.push(`Connected via ${result.path.length - 1} hops`);
    } else {
      parts.push('');
      parts.push('❌ No direct path found between these symbols.');
      parts.push('They may be independent modules or connected through external dependencies.');
      conclusions.push('No direct relationship found');
    }

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Call Chain
  // ========================

  private flowCallChain(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    if (!target) return this.notFound(intent);

    const depth = options.mode === 'deep' ? 3 : 2;
    steps.push('lookup', 'callers', 'callees');

    const callers = this.store.getCallers(target.id);
    const callees = this.store.getCallees(target.id);

    // For deep mode, expand one more level
    let upstreamChain: Symbol[] = [];
    let downstreamChain: Symbol[] = [];

    if (options.mode === 'deep') {
      for (const c of callers.slice(0, 3)) {
        const cc = this.store.getCallers(c.id);
        upstreamChain.push(...cc);
      }
      for (const c of callees.slice(0, 3)) {
        const cc = this.store.getCallees(c.id);
        downstreamChain.push(...cc);
      }
    }

    const symbols = this.toSymbolRefs([target, ...callers, ...callees, ...upstreamChain.slice(0, 5), ...downstreamChain.slice(0, 5)]);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Call Chain: "${target.name}"`);
    parts.push('═'.repeat(40));

    // Upstream
    parts.push('');
    parts.push(`⬆️ Upstream — Who calls ${target.name} (${callers.length}):`);
    for (const c of callers.slice(0, 8)) {
      parts.push(`  • ${c.name} (${c.kind}) @ ${c.filePath}:${c.startLine}`);
    }

    if (options.mode === 'deep' && upstreamChain.length > 0) {
      parts.push('');
      parts.push('  📈 2nd-level callers:');
      const unique = [...new Map(upstreamChain.map(s => [s.id, s])).values()].slice(0, 5);
      for (const c of unique) {
        parts.push(`    • ${c.name} @ ${c.filePath}`);
      }
    }

    // Downstream
    parts.push('');
    parts.push(`⬇️ Downstream — What ${target.name} calls (${callees.length}):`);
    for (const c of callees.slice(0, 8)) {
      parts.push(`  • ${c.name} (${c.kind}) @ ${c.filePath}:${c.startLine}`);
    }

    if (options.mode === 'deep' && downstreamChain.length > 0) {
      parts.push('');
      parts.push('  📉 2nd-level callees:');
      const unique = [...new Map(downstreamChain.map(s => [s.id, s])).values()].slice(0, 5);
      for (const c of unique) {
        parts.push(`    • ${c.name} @ ${c.filePath}`);
      }
    }

    conclusions.push(`${callers.length} callers, ${callees.length} callees`);

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Code Review
  // ========================

  private flowCodeReview(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    steps.push('smells', 'guard');

    const smellDetector = new SmellDetector(this.store);
    const smells = target
      ? smellDetector.detect().filter(s => s.symbols.some(sym =>
        sym.name.toLowerCase() === target.name.toLowerCase() ||
        sym.file === target.filePath))
      : smellDetector.detect();

    const guard = new GuardAnalyzer(this.store).check();

    const allSymbols = target ? [target] : [];
    if (smells.length > 0) {
      for (const smell of smells) {
        for (const s of smell.symbols) {
          const found = this.store.searchSymbols(s.name, { limit: 1 });
          if (found.length > 0) allSymbols.push(found[0]);
        }
      }
    }
    const symbols = this.toSymbolRefs(allSymbols);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Code Review${target ? `: "${target.name}"` : ': Full Project'}`);
    parts.push('═'.repeat(40));

    // Smells
    if (smells.length > 0) {
      parts.push('');
      parts.push(`🔍 Code Smells Found: ${smells.length}`);
      for (const smell of smells.slice(0, 8)) {
        const severityIcon = smell.severity === 'error' ? '🔴' : smell.severity === 'warning' ? '🟡' : '🔵';
        parts.push(`  ${severityIcon} [${smell.type}] ${smell.description}`);
        parts.push(`     Symbols: ${smell.symbols.map(s => s.name).join(', ')}`);
        parts.push(`     Fix: ${smell.suggestion}`);
      }
      conclusions.push(`${smells.length} code smells detected`);
    } else {
      parts.push('');
      parts.push('✅ No code smells detected.');
      conclusions.push('No code smells');
    }

    // Guard
    const guardViolations = guard.violations.filter(v => v.severity === 'error');
    const guardWarnings = guard.violations.filter(v => v.severity === 'warning');

    if (guardViolations.length > 0 || guardWarnings.length > 0) {
      parts.push('');
      parts.push(`🛡️ Architecture Guard: ${guardViolations.length} errors, ${guardWarnings.length} warnings`);
      for (const v of guardViolations.slice(0, 5)) {
        parts.push(`  🔴 ${v.message}`);
      }
      for (const v of guardWarnings.slice(0, 5)) {
        parts.push(`  🟡 ${v.message}`);
      }
    }

    // Target-specific metrics
    if (target) {
      parts.push('');
      parts.push(`📊 Metrics for "${target.name}":`);
      parts.push(`  Complexity: ${target.complexity ?? 'N/A'}`);
      parts.push(`  Lines: ${target.endLine - target.startLine + 1}`);
      parts.push(`  Layer: ${target.layer}`);
    }

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Find Code
  // ========================

  private flowFindCode(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    steps.push('search');

    const query = intent.target ?? intent.keywords.join(' ');
    const results = this.store.searchSymbols(query, { limit: 15 });

    // Also try searching by keywords individually
    if (results.length < 3) {
      for (const kw of intent.keywords.slice(0, 3)) {
        const more = this.store.searchSymbols(kw, { limit: 5 });
        for (const m of more) {
          if (!results.find(r => r.id === m.id)) results.push(m);
        }
      }
    }

    const symbols = this.toSymbolRefs(results);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Code Search: "${query}"`);
    parts.push('═'.repeat(40));

    if (results.length === 0) {
      parts.push('❌ No matching code found. Try different keywords.');
      conclusions.push('No results');
    } else {
      // Group by kind
      const byKind = new Map<string, Symbol[]>();
      for (const s of results) {
        if (!byKind.has(s.kind)) byKind.set(s.kind, []);
        byKind.get(s.kind)!.push(s);
      }

      parts.push(`Found ${results.length} symbol(s):\n`);
      for (const [kind, syms] of byKind) {
        parts.push(`**${kind.charAt(0).toUpperCase() + kind.slice(1)}s:**`);
        for (const s of syms.slice(0, 5)) {
          const layerTag = s.layer !== 'unknown' ? ` [${s.layer}]` : '';
          parts.push(`  • ${s.name}${layerTag} @ ${s.filePath}:${s.startLine}`);
          if (s.docComment) parts.push(`    ${s.docComment.slice(0, 100)}`);
        }
      }
      conclusions.push(`${results.length} symbols found`);
    }

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Architecture
  // ========================

  private flowArchitecture(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    steps.push('stats', 'layers', 'deps');

    const stats = this.store.getStats();
    const dep = new DepAnalyzer(this.store, this.projectPath).analyze();

    const symbols: Array<{ name: string; kind: string; file: string; id: string }> = [];
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push('📋 Architecture Overview');
    parts.push('═'.repeat(40));

    // Stats
    parts.push(`\n📊 Project Stats:`);
    parts.push(`  Files: ${stats.files}`);
    parts.push(`  Symbols: ${stats.symbols}`);
    parts.push(`  Relationships: ${stats.relationships}`);
    parts.push(`  Languages: ${stats.languages.join(', ')}`);

    // By kind — query from store
    const kindBreakdown = this.store.searchSymbols('', { limit: 10000 });
    const byKind = new Map<string, number>();
    const byLayer = new Map<string, number>();
    for (const s of kindBreakdown) {
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
      byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    }

    parts.push('\n🔷 By Kind:');
    for (const [kind, count] of byKind) {
      if (count > 0) parts.push(`  ${kind}: ${count}`);
    }

    parts.push('\n🏗️ By Layer:');
    for (const [layer, count] of byLayer) {
      if (count > 0) parts.push(`  ${layer}: ${count}`);
    }

    // Dependency health
    parts.push(`\n🔗 Dependency Health: ${dep.score}/100`);
    if (dep.circular.length > 0) {
      parts.push(`  ⚠️ ${dep.circular.length} circular dependency chain(s):`);
      for (const c of dep.circular.slice(0, 3)) {
        parts.push(`    ${c.chain.join(' → ')}`);
      }
    } else {
      parts.push('  ✅ No circular dependencies');
    }
    if (dep.unused.length > 0) {
      parts.push(`  📦 ${dep.unused.length} unused package(s): ${dep.unused.slice(0, 5).join(', ')}`);
    }

    conclusions.push(`${stats.symbols} symbols, ${stats.files} files, dep health ${dep.score}/100`);

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Refactor
  // ========================

  private flowRefactor(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    steps.push('smells', 'impact', 'guard');

    const smellDetector = new SmellDetector(this.store);
    const smells = target
      ? smellDetector.detect().filter(s => s.symbols.some(sym =>
        sym.name.toLowerCase() === target.name.toLowerCase() ||
        sym.file === target.filePath))
      : smellDetector.detect();

    const allSymbols: Symbol[] = target ? [target] : [];
    const symbols = this.toSymbolRefs(allSymbols);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Refactor Analysis${target ? `: "${target.name}"` : ': Project-Wide'}`);
    parts.push('═'.repeat(40));

    if (smells.length > 0) {
      parts.push(`\n🔍 ${smells.length} refactoring opportunity(ies):\n`);
      for (let i = 0; i < Math.min(smells.length, 6); i++) {
        const smell = smells[i];
        parts.push(`${i + 1}. [${smell.type}] ${smell.description}`);
        parts.push(`   Severity: ${smell.severity}`);
        parts.push(`   Symbols: ${smell.symbols.map(s => `${s.name} @ ${s.file}`).join(', ')}`);
        parts.push(`   💡 Suggestion: ${smell.suggestion}`);
        parts.push('');
      }
      conclusions.push(`${smells.length} refactor suggestions`);

      // If target has impact, warn about refactor risk
      if (target) {
        const impact = new ImpactAnalyzer(this.store).analyze(target.id, 2);
        if (impact) {
          parts.push(`⚠️ Refactoring "${target.name}" will affect ${impact.direct.length + impact.indirect.length} symbol(s) across ${impact.affectedFiles.length} file(s).`);
          parts.push(`   Risk level: ${impact.risk}`);
        }
      }
    } else {
      parts.push('\n✅ No obvious refactoring opportunities found. Code looks clean!');
      conclusions.push('No refactoring needed');
    }

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Overview
  // ========================

  private flowOverview(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    return this.flowArchitecture(intent, options, steps);
  }

  // ========================
  // Flow: Entry Point
  // ========================

  private flowEntryPoint(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    steps.push('search');

    // Look for common entry point patterns
    const entryPatterns = ['main', 'index', 'app', 'server', 'bootstrap', 'start', 'run', 'handler'];
    const results: Symbol[] = [];
    const seen = new Set<string>();

    for (const pattern of entryPatterns) {
      const matches = this.store.searchSymbols(pattern, { limit: 5 });
      for (const m of matches) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          results.push(m);
        }
      }
    }

    // Filter for likely entry points (exported, low-level callers)
    const likelyEntries = results.filter(s =>
      s.exported || s.kind === 'function' || s.kind === 'module'
    );

    const symbols = this.toSymbolRefs(likelyEntries.slice(0, 10));
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push('📋 Entry Points');
    parts.push('═'.repeat(40));

    if (likelyEntries.length > 0) {
      parts.push(`\nFound ${likelyEntries.length} potential entry point(s):\n`);
      for (const s of likelyEntries.slice(0, 10)) {
        const callers = this.store.getCallers(s.id);
        const isRoot = callers.length === 0;
        const icon = isRoot ? '🟢' : '⬜';
        parts.push(`  ${icon} ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}${isRoot ? ' [ROOT — no callers]' : ''}`);
      }
      conclusions.push(`${likelyEntries.length} entry points found`);
    } else {
      parts.push('\n❌ No obvious entry points found.');
    }

    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Embedded Linux Analysis
  // ========================

  private flowEmbeddedLinux(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    steps.push('embedded-linux');
    const header = '🐧 Embedded Linux Analysis';

    try {
      const analyzer = new EmbeddedAnalyzer(this.store, this.projectPath, { profile: 'linux' });
      const result = analyzer.analyze();

      if (!result.linux) {
        return {
          answer: `📋 ${header}\n${'═'.repeat(40)}\n\n❌ No embedded Linux artifacts detected. This project does not appear to use Kbuild, Kconfig, device tree, kernel modules, Yocto, Buildroot, or systemd.`,
          symbols: [],
          conclusions: ['No embedded Linux detected'],
        };
      }

      const linux = result.linux;
      const symbols = linux.drivers.map(d => ({ name: d.name, kind: 'driver' as const, file: d.file, id: `${d.file}:${d.name}:${d.line}` }));

      const parts: string[] = [];
      parts.push(`📋 ${header}`);
      parts.push('═'.repeat(40));
      parts.push('');
      parts.push(linux.summary);

      // Driver-to-device-tree matching insights
      if (linux.deviceTree.unmatchedCompatibles.length > 0 && linux.drivers.length > 0) {
        parts.push('');
        parts.push('⚠️ **Matching insights:**');
        parts.push(`  ${linux.deviceTree.unmatchedCompatibles.length} compatible string(s) in device tree have no matching driver.`);
        parts.push('  Run `embedded devicetree` for full details.');
      }

      if (linux.findings.length > 0) {
        const warnings = linux.findings.filter(f => f.severity === 'warning');
        if (warnings.length > 0) {
          parts.push('');
          parts.push(`🔍 Key findings (${warnings.length} warnings):`);
          for (const w of warnings.slice(0, 5)) {
            const loc = w.file ? ` @ ${w.file}:${w.line}` : '';
            parts.push(`  ⚠️ ${w.message}${loc}`);
          }
        }
      }

      // Related commands
      parts.push('');
      parts.push('💡 **Next steps:**');
      parts.push('  • `embedded drivers` — List all kernel drivers and modules');
      parts.push('  • `embedded devicetree` — List device tree nodes and compatible matching');
      parts.push('  • `embedded kconfig` — List Kconfig options and dependencies');
      parts.push('  • `embedded interfaces` — List progfs/sysfs/debugfs/ioctl interfaces');

      return { answer: parts.join('\n'), symbols, conclusions: [`${linux.drivers.length} drivers, ${linux.deviceTree.nodes.length} DTS nodes, ${linux.findings.length} findings`] };
    } catch (err: any) {
      return {
        answer: `📋 ${header}\n${'═'.repeat(40)}\n\n❌ Failed to analyze: ${err.message}\n\nMake sure the project path contains Linux kernel/driver sources.`,
        symbols: [],
        conclusions: ['Analysis failed'],
      };
    }
  }

  // ========================
  // Flow: Free Form (fallback)
  // ========================

  private flowFreeForm(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    const target = this.resolveTarget(intent);
    steps.push('search');

    // If we have a target, do a mini-understand
    if (target) {
      return this.flowUnderstand(intent, options, steps);
    }

    // Otherwise, search by keywords
    return this.flowFindCode(intent, options, steps);
  }

  // ========================
  // Flow: Compare
  // ========================

  private flowCompare(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    // Resolve both targets
    let target1: Symbol | null = null;
    let target2: Symbol | null = null;

    if (intent.target && intent.secondaryTarget) {
      target1 = this.resolveTarget({ ...intent, target: intent.target });
      target2 = this.resolveTarget({ ...intent, target: intent.secondaryTarget });
    } else if (intent.target) {
      // Try to split by "and"/"与"/"和"/"vs"
      const parts = intent.rawQuestion.split(/\s+(?:and|与|和|vs\.?|versus)\s+/i);
      if (parts.length >= 2) {
        target1 = this.resolveTargetByName(parts[0].trim());
        target2 = this.resolveTargetByName(parts[1].trim());
      }
    }

    if (!target1 || !target2) {
      return {
        answer: `❓ Need two symbols to compare. Provide both names (e.g., "Compare UserService and UserRepository")`,
        symbols: [],
        conclusions: [],
      };
    }

    steps.push('lookup', 'compare');

    // Gather metrics for both
    const callers1 = this.store.getCallers(target1.id);
    const callees1 = this.store.getCallees(target1.id);
    const callers2 = this.store.getCallers(target2.id);
    const callees2 = this.store.getCallees(target2.id);

    const symbols = this.toSymbolRefs([target1, target2]);
    const conclusions: string[] = [];

    const parts: string[] = [];
    parts.push(`📋 Compare: "${target1.name}" vs "${target2.name}"`);
    parts.push('═'.repeat(50));

    // Side-by-side comparison table
    parts.push('');
    parts.push(`| Metric       | ${target1.name} | ${target2.name} |`);
    parts.push(`|--------------|${'-'.repeat(target1.name.length + 2)}|${'-'.repeat(target2.name.length + 2)}|`);
    parts.push(`| Kind         | ${target1.kind} | ${target2.kind} |`);
    parts.push(`| Layer        | ${target1.layer} | ${target2.layer} |`);
    parts.push(`| Language     | ${target1.language} | ${target2.language} |`);
    parts.push(`| Lines        | ${target1.endLine - target1.startLine + 1} | ${target2.endLine - target2.startLine + 1} |`);
    parts.push(`| Complexity   | ${target1.complexity ?? 'N/A'} | ${target2.complexity ?? 'N/A'} |`);
    parts.push(`| Callers      | ${callers1.length} | ${callers2.length} |`);
    parts.push(`| Callees      | ${callees1.length} | ${callees2.length} |`);
    parts.push(`| Exported     | ${target1.exported ? 'Yes' : 'No'} | ${target2.exported ? 'Yes' : 'No'} |`);
    parts.push(`| File         | ${target1.filePath} | ${target2.filePath} |`);

    // Relationship between them
    const pathFinder = new PathFinder(this.store);
    const pathResult = pathFinder.find(target1.name, target2.name);
    if (pathResult.found) {
      parts.push('');
      parts.push(`🔗 Connection: ${pathResult.summary}`);
      conclusions.push(`Connected via ${pathResult.path.length - 1} hops`);
    } else {
      parts.push('');
      parts.push('🔗 No direct connection found between these symbols.');
      conclusions.push('No direct connection');
    }

    // Differences summary
    const callerDiff = callers1.length - callers2.length;
    const lineDiff = (target1.endLine - target1.startLine) - (target2.endLine - target2.startLine);
    if (Math.abs(callerDiff) > 2 || Math.abs(lineDiff) > 20) {
      parts.push('');
      parts.push('💡 Key differences:');
      if (Math.abs(callerDiff) > 2) {
        const more = callerDiff > 0 ? target1.name : target2.name;
        parts.push(`  • ${more} has ${Math.abs(callerDiff)} more callers — it's more central to the codebase`);
      }
      if (Math.abs(lineDiff) > 20) {
        const bigger = lineDiff > 0 ? target1.name : target2.name;
        parts.push(`  • ${bigger} is ${Math.abs(lineDiff)} lines longer`);
      }
    }

    conclusions.push(`Compared ${target1.name} and ${target2.name}`);
    return { answer: parts.join('\n'), symbols, conclusions };
  }

  // ========================
  // Flow: Test Coverage
  // ========================

  private flowTestCoverage(
    intent: Intent, options: AskOptions, steps: string[],
  ): FlowResult {
    steps.push('coverage');

    const target = this.resolveTarget(intent);
    const coverageAnalyzer = new CoverageAnalyzer(this.store);

    if (target) {
      // Analyze specific symbol's coverage
      const report = coverageAnalyzer.analyze();
      const detail = report.coverageDetails.find(c => c.symbol.id === target.id);

      const symbols = this.toSymbolRefs([target]);
      const conclusions: string[] = [];

      const parts: string[] = [];
      parts.push(`📋 Test Coverage: "${target.name}"`);
      parts.push('═'.repeat(40));

      if (detail?.hasTest) {
        parts.push(`✅ Has test coverage`);
        if (detail.testFiles.length > 0) {
          parts.push(`  Test files: ${detail.testFiles.join(', ')}`);
        }
        if (detail.testSymbolNames.length > 0) {
          parts.push(`  Test symbols: ${detail.testSymbolNames.join(', ')}`);
        }
        conclusions.push(`Covered by ${detail.testFiles.length} test file(s)`);
      } else {
        parts.push(`❌ No test coverage detected`);
        parts.push(`  This symbol is not referenced in any test file.`);
        parts.push('');
        parts.push('💡 Suggestions:');
        parts.push(`  1. Create tests that exercise this symbol's public API`);
        parts.push(`  2. Add edge case tests for boundary conditions`);
        parts.push(`  3. Add integration tests if it has external dependencies`);
        conclusions.push('No test coverage');
      }

      return { answer: parts.join('\n'), symbols, conclusions };
    } else {
      // Project-wide coverage report
      const report = coverageAnalyzer.analyze();
      const symbols: Array<{ name: string; kind: string; file: string; id: string }> = [];
      const conclusions: string[] = [];

      const parts: string[] = [];
      parts.push('📋 Project Test Coverage');
      parts.push('═'.repeat(40));
      parts.push(`Total exported symbols: ${report.totalSymbols}`);
      parts.push(`Covered by tests: ${report.coveredSymbols}`);

      // Coverage bar
      const filled = Math.round(report.coveragePercent / 5);
      const empty = 20 - filled;
      parts.push(`[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${report.coveragePercent}%`);

      // Top uncovered symbols
      const uncovered = report.coverageDetails.filter(c => !c.hasTest).slice(0, 10);
      if (uncovered.length > 0) {
        parts.push('');
        parts.push('⚠️ Top uncovered symbols:');
        for (const u of uncovered) {
          parts.push(`  • ${u.symbol.name} (${u.symbol.kind}) @ ${u.symbol.filePath}`);
          symbols.push({ name: u.symbol.name, kind: u.symbol.kind, file: u.symbol.filePath, id: u.symbol.id });
        }
      }

      conclusions.push(`${report.coveragePercent}% coverage`);
      return { answer: parts.join('\n'), symbols, conclusions };
    }
  }

  // ========================
  // Helpers
  // ========================

  private resolveTarget(intent: Intent): Symbol | null {
    if (!intent.target) {
      // Try keywords
      const found = this.resolveTargetsFromKeywords(intent.keywords, 1);
      return found[0] ?? null;
    }

    // Strategy 1: Exact name match (highest confidence)
    let sym = this.store.getSymbol(intent.target);
    if (sym) return sym;

    // Strategy 2: Case-insensitive exact match
    const allSymbols = this.store.searchSymbols(intent.target, { limit: 10 });
    const caseInsensitiveExact = allSymbols.find(
      s => s.name.toLowerCase() === intent.target!.toLowerCase()
    );
    if (caseInsensitiveExact) return caseInsensitiveExact;

    // Strategy 3: Score-based ranking for multiple matches
    if (allSymbols.length === 1) return allSymbols[0];
    if (allSymbols.length > 1) {
      const scored = allSymbols.map(s => ({
        symbol: s,
        score: this.scoreSymbolMatch(s, intent.target!, intent.keywords),
      }));
      scored.sort((a, b) => b.score - a.score);

      // If top two scores are close, flag ambiguity but return top match
      if (scored.length >= 2 && scored[0].score - scored[1].score < 0.2) {
        return scored[0].symbol;
      }

      return scored[0].symbol;
    }

    return null;
  }

  /**
   * Score a symbol match against a query target.
   * Returns 0-1 score where higher is better.
   */
  private scoreSymbolMatch(symbol: Symbol, target: string, keywords: string[]): number {
    let score = 0;
    const targetLower = target.toLowerCase();
    const nameLower = symbol.name.toLowerCase();

    // Exact name match
    if (nameLower === targetLower) score += 1.0;
    // Name contains target
    else if (nameLower.includes(targetLower)) score += 0.7;
    // Target contains name (e.g., query "UserRepositoryFindById" matches symbol "UserRepository")
    else if (targetLower.includes(nameLower)) score += 0.5;

    // Fuzzy: check keyword overlap via CamelCase/underscore split
    const nameWords = symbol.name.split(/(?=[A-Z])|[_\-]/).map(w => w.toLowerCase());
    for (const kw of keywords) {
      if (nameWords.some(w => w.includes(kw.toLowerCase()))) score += 0.15;
    }

    // Prefer exported symbols (more likely to be the intended public API)
    if (symbol.exported) score += 0.1;

    // Prefer business layer over utility (more interesting to users)
    if (symbol.layer === 'business') score += 0.05;

    return Math.min(score, 1.0);
  }

  private resolveTargetByName(name: string): Symbol | null {
    // Try exact match
    let sym = this.store.getSymbol(name);
    if (sym) return sym;

    // Try case-insensitive exact match
    const results = this.store.searchSymbols(name, { limit: 10 });
    const caseInsensitive = results.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (caseInsensitive) return caseInsensitive;

    // Score and rank
    if (results.length === 1) return results[0];
    if (results.length > 1) {
      const scored = results.map(s => ({
        symbol: s,
        score: this.scoreSymbolMatch(s, name, []),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored[0].symbol;
    }

    return null;
  }

  private resolveTargetsFromKeywords(keywords: string[], count: number): Symbol[] {
    const results: Symbol[] = [];
    const seen = new Set<string>();

    for (const kw of keywords) {
      const matches = this.store.searchSymbols(kw, { limit: 3 });
      for (const m of matches) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          results.push(m);
        }
      }
      if (results.length >= count) break;
    }

    return results.slice(0, count);
  }

  private toSymbolRefs(symbols: Symbol[]): Array<{ name: string; kind: string; file: string; id: string }> {
    const seen = new Set<string>();
    const result: Array<{ name: string; kind: string; file: string; id: string }> = [];
    for (const s of symbols) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        result.push({ name: s.name, kind: s.kind, file: s.filePath, id: s.id });
      }
    }
    return result;
  }

  private notFound(intent: Intent): FlowResult {
    const query = intent.target ?? intent.keywords.join(' ');
    return {
      answer: `❓ Symbol "${query}" not found in the code graph.\n\n💡 Tips:\n  • Check the spelling\n  • Try a shorter name (e.g., "User" instead of "UserService")\n  • Run codeatlas_scan first to build the graph`,
      symbols: [],
      conclusions: ['Symbol not found'],
    };
  }
}

// ========================
// Internal Types
// ========================

interface FlowResult {
  answer: string;
  symbols: Array<{ name: string; kind: string; file: string; id: string }>;
  conclusions: string[];
}
