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
import { resolveTarget, resolveTargetByName, resolveTargetsFromKeywords, toSymbolRefs, notFound, scoreSymbolMatch, type FlowResult } from './flows/_shared.js';
import { flowArchitecture } from './flows/architecture.js';
import { flowOverview } from './flows/overview.js';
import { flowSafeDelete } from './flows/safeDelete.js';
import { flowImpact } from './flows/impact.js';
import { flowUnderstand } from './flows/understand.js';
import { flowRelationship } from './flows/relationship.js';
import { flowCallChain } from './flows/callChain.js';
import { flowCodeReview } from './flows/codeReview.js';
import { flowFindCode } from './flows/findCode.js';
import { flowRefactor } from './flows/refactor.js';
import { flowEntryPoint } from './flows/entryPoint.js';
import { flowEmbeddedLinux } from './flows/embeddedLinux.js';
import { flowFreeForm } from './flows/freeForm.js';
import { flowCompare } from './flows/compare.js';
import { flowTestCoverage } from './flows/testCoverage.js';
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
        ({ answer, symbols, conclusions } = flowSafeDelete(this.store, this.projectPath, intent, options, steps));
        break;
      case 'impact':
        ({ answer, symbols, conclusions } = flowImpact(this.store, this.projectPath, intent, options, steps));
        break;
      case 'understand':
        ({ answer, symbols, conclusions } = flowUnderstand(this.store, this.projectPath, intent, options, steps));
        break;
      case 'relationship':
        ({ answer, symbols, conclusions } = flowRelationship(this.store, this.projectPath, intent, options, steps));
        break;
      case 'call_chain':
        ({ answer, symbols, conclusions } = flowCallChain(this.store, this.projectPath, intent, options, steps));
        break;
      case 'code_review':
        ({ answer, symbols, conclusions } = flowCodeReview(this.store, this.projectPath, intent, options, steps));
        break;
      case 'find_code':
        ({ answer, symbols, conclusions } = flowFindCode(this.store, this.projectPath, intent, options, steps));
        break;
      case 'architecture':
        ({ answer, symbols, conclusions } = flowArchitecture(this.store, this.projectPath, intent, options, steps));
        break;
      case 'refactor':
        ({ answer, symbols, conclusions } = flowRefactor(this.store, this.projectPath, intent, options, steps));
        break;
      case 'overview':
        ({ answer, symbols, conclusions } = flowOverview(this.store, this.projectPath, intent, options, steps));
        break;
      case 'entry_point':
        ({ answer, symbols, conclusions } = flowEntryPoint(this.store, this.projectPath, intent, options, steps));
        break;
      case 'compare':
        ({ answer, symbols, conclusions } = flowCompare(this.store, this.projectPath, intent, options, steps));
        break;
      case 'test_coverage':
        ({ answer, symbols, conclusions } = flowTestCoverage(this.store, this.projectPath, intent, options, steps));
        break;
      case 'embedded_linux':
        ({ answer, symbols, conclusions } = flowEmbeddedLinux(this.store, this.projectPath, intent, options, steps));
        break;
      default:
        ({ answer, symbols, conclusions } = flowFreeForm(this.store, this.projectPath, intent, options, steps));
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

  // Helpers (delegated to flows/_shared.ts)
  // ========================

  private resolveTarget(intent: Intent): Symbol | null {
    return resolveTarget(this.store, intent);
  }

  private resolveTargetByName(name: string): Symbol | null {
    return resolveTargetByName(this.store, name);
  }

  private resolveTargetsFromKeywords(keywords: string[], count: number): Symbol[] {
    return resolveTargetsFromKeywords(this.store, keywords, count);
  }

  private toSymbolRefs(symbols: Symbol[]): Array<{ name: string; kind: string; file: string; id: string }> {
    return toSymbolRefs(symbols);
  }

  private notFound(intent: Intent): FlowResult {
    return notFound(intent);
  }
}
