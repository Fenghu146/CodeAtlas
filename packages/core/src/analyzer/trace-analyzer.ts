// ============================================================
// Trace Analyzer - Analyzes execution flow from Flowtrace
// ============================================================
// Combines static code analysis with runtime execution history
// to find hot paths, failure patterns, and coverage gaps.

import { SQLiteStore } from '../store/sqlite-store.js';
import { TraceReader } from '../trace/trace-reader.js';
import type { TraceData, TraceStepWithContext, StepStatus } from '../trace/types.js';
import type { Symbol } from '../graph/types.js';

export interface HotPath {
  /** Steps in the path */
  steps: string[];
  /** Execution frequency (if available) */
  frequency: number;
  /** Total execution time */
  duration?: number;
}

export interface FailurePattern {
  /** Failed step */
  stepId: string;
  /** Error message */
  message: string;
  /** Upstream steps that might have caused the failure */
  upstream: string[];
  /** Suggested fix */
  suggestion: string;
}

export interface ExecutionDiff {
  /** Code symbols that were executed */
  executedSymbols: Symbol[];
  /** Code symbols that exist but were never executed */
  unexecutedSymbols: Symbol[];
  /** Static calls that were never made at runtime */
  unusedCalls: Array<{ from: string; to: string }>;
  /** Dynamic calls that aren't in static analysis */
  dynamicCalls: Array<{ from: string; to: string }>;
  /** Coverage percentage */
  coverage: number;
}

export interface TraceAnalysisResult {
  /** Hot execution paths */
  hotPaths: HotPath[];
  /** Failure patterns */
  failures: FailurePattern[];
  /** Execution vs static diff */
  executionDiff: ExecutionDiff;
  /** Summary */
  summary: string;
}

/**
 * Analyzes execution flow from Flowtrace data.
 * Combines static code graph with runtime execution history.
 */
export class TraceAnalyzer {
  private store: SQLiteStore;
  private traceReader: TraceReader;

  constructor(store: SQLiteStore, tracePath: string) {
    this.store = store;
    this.traceReader = new TraceReader(tracePath);
  }

  /**
   * Run full trace analysis.
   */
  analyze(): TraceAnalysisResult | null {
    const traceData = this.traceReader.load();
    if (!traceData) return null;

    const steps = this.traceReader.getStepsWithContext();
    const hotPaths = this.findHotPaths(steps);
    const failures = this.findFailures(steps);
    const executionDiff = this.analyzeExecutionDiff(traceData, steps);

    const summary = this.buildSummary(hotPaths, failures, executionDiff);

    return {
      hotPaths,
      failures,
      executionDiff,
      summary,
    };
  }

  /**
   * Find hot execution paths (most frequently executed steps).
   */
  private findHotPaths(steps: TraceStepWithContext[]): HotPath[] {
    // Count incoming edges (how many steps depend on each step)
    const incomingCount = new Map<string, number>();
    for (const step of steps) {
      for (const upstream of step.upstream) {
        incomingCount.set(upstream, (incomingCount.get(upstream) ?? 0) + 1);
      }
    }

    // Hot paths are steps with many downstream dependents
    const hotPaths: HotPath[] = [];
    for (const [stepId, count] of incomingCount) {
      if (count >= 2) {
        const downstream = this.getDownstreamChain(stepId, steps);
        hotPaths.push({
          steps: [stepId, ...downstream],
          frequency: count,
        });
      }
    }

    // Sort by frequency
    hotPaths.sort((a, b) => b.frequency - a.frequency);

    return hotPaths.slice(0, 5);
  }

  /**
   * Get the chain of downstream steps.
   */
  private getDownstreamChain(startId: string, steps: TraceStepWithContext[]): string[] {
    const chain: string[] = [];
    const visited = new Set<string>([startId]);

    let currentId = startId;
    while (currentId) {
      const step = steps.find(s => s.id === currentId);
      if (!step || step.downstream.length === 0) break;

      const next = step.downstream.find(d => !visited.has(d));
      if (!next) break;

      chain.push(next);
      visited.add(next);
      currentId = next;
    }

    return chain;
  }

  /**
   * Find failure patterns in the execution.
   */
  private findFailures(steps: TraceStepWithContext[]): FailurePattern[] {
    const failures: FailurePattern[] = [];

    for (const step of steps) {
      if (step.status?.kind === 'error') {
        failures.push({
          stepId: step.id,
          message: step.status.message,
          upstream: step.upstream,
          suggestion: this.suggestFix(step),
        });
      }
    }

    return failures;
  }

  /**
   * Suggest a fix for a failed step.
   */
  private suggestFix(step: TraceStepWithContext): string {
    if (step.upstream.length === 0) {
      return 'Check input data and step configuration';
    }

    const upstreamStatuses = step.upstream.map(u => ({
      id: u,
      status: 'unknown', // Would need to look up actual status
    }));

    const failedUpstream = upstreamStatuses.filter(u => u.status === 'error');
    if (failedUpstream.length > 0) {
      return `Fix upstream failures first: ${failedUpstream.map(u => u.id).join(', ')}`;
    }

    return 'Check step logic and dependencies';
  }

  /**
   * Analyze execution vs static code.
   */
  private analyzeExecutionDiff(
    traceData: TraceData,
    steps: TraceStepWithContext[],
  ): ExecutionDiff {
    // Get all symbols from code graph
    const allSymbols = this.store.searchSymbols('', { limit: 10000 });

    // For now, use a simple heuristic: match step names to symbol names
    const executedSymbols: Symbol[] = [];
    const unexecutedSymbols: Symbol[] = [];

    for (const symbol of allSymbols) {
      const isExecuted = steps.some(s =>
        s.spec.name.toLowerCase().includes(symbol.name.toLowerCase()) ||
        symbol.name.toLowerCase().includes(s.id.toLowerCase())
      );

      if (isExecuted) {
        executedSymbols.push(symbol);
      } else {
        unexecutedSymbols.push(symbol);
      }
    }

    // Calculate coverage
    const totalSymbols = allSymbols.length;
    const coverage = totalSymbols > 0 ? executedSymbols.length / totalSymbols : 0;

    return {
      executedSymbols,
      unexecutedSymbols,
      unusedCalls: [], // Would need deeper analysis
      dynamicCalls: [],
      coverage,
    };
  }

  /**
   * Build summary text.
   */
  private buildSummary(
    hotPaths: HotPath[],
    failures: FailurePattern[],
    executionDiff: ExecutionDiff,
  ): string {
    const parts: string[] = [];

    parts.push('📊 Trace Analysis Summary');
    parts.push('═'.repeat(40));

    // Execution coverage
    parts.push(`\n📈 Execution Coverage: ${(executionDiff.coverage * 100).toFixed(1)}%`);
    parts.push(`   Executed: ${executionDiff.executedSymbols.length} symbols`);
    parts.push(`   Unexecuted: ${executionDiff.unexecutedSymbols.length} symbols`);

    // Hot paths
    if (hotPaths.length > 0) {
      parts.push(`\n🔥 Hot Paths (${hotPaths.length}):`);
      for (const path of hotPaths.slice(0, 3)) {
        parts.push(`   ${path.steps.join(' → ')} (freq: ${path.frequency})`);
      }
    }

    // Failures
    if (failures.length > 0) {
      parts.push(`\n❌ Failures (${failures.length}):`);
      for (const f of failures) {
        parts.push(`   ${f.stepId}: ${f.message}`);
        parts.push(`   Suggestion: ${f.suggestion}`);
      }
    }

    // Recommendations
    parts.push('\n💡 Recommendations:');
    if (executionDiff.coverage < 0.5) {
      parts.push('   - Low coverage: Consider adding tests for unexecuted code');
    }
    if (failures.length > 0) {
      parts.push('   - Fix failures before optimizing performance');
    }
    if (hotPaths.length > 0) {
      parts.push(`   - Focus optimization on hot path: ${hotPaths[0].steps[0]}`);
    }

    return parts.join('\n');
  }
}
