// ============================================================
// Trace Agent - Agent with execution awareness
// ============================================================
// Extends the base AgentRuntime with Flowtrace execution data
// for more intelligent decision making.

import { SQLiteStore } from '../store/sqlite-store.js';
import { AgentRuntime, type AgentTask, type AgentResult } from './agent-runtime.js';
import { TraceAnalyzer, type TraceAnalysisResult } from './trace-analyzer.js';
import { TraceReader } from '../trace/trace-reader.js';
import type { TraceData, TraceStepWithContext } from '../trace/types.js';

export interface TraceAgentTask extends AgentTask {
  /** Path to Flowtrace trace directory */
  tracePath?: string;
  /** Focus on specific execution step */
  focusStep?: string;
}

export interface TraceAgentResult extends AgentResult {
  /** Trace analysis (if tracePath provided) */
  traceAnalysis?: TraceAnalysisResult;
  /** Execution-aware recommendations */
  executionRecommendations: string[];
}

/**
 * Agent with execution awareness from Flowtrace.
 * Combines static code analysis with runtime execution history.
 */
export class TraceAgent {
  private store: SQLiteStore;
  private agentRuntime: AgentRuntime;

  constructor(store: SQLiteStore, options?: {
    llmProvider?: 'claude' | 'openai' | 'local';
    llmModel?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
  }) {
    this.store = store;
    this.agentRuntime = new AgentRuntime(store, options);
  }

  /**
   * Execute a task with execution awareness.
   */
  async execute(task: TraceAgentTask): Promise<TraceAgentResult> {
    // Get trace analysis if tracePath provided
    let traceAnalysis: TraceAnalysisResult | undefined;
    let executionRecommendations: string[] = [];

    if (task.tracePath) {
      const traceAnalyzer = new TraceAnalyzer(this.store, task.tracePath);
      traceAnalysis = traceAnalyzer.analyze() ?? undefined;

      if (traceAnalysis) {
        executionRecommendations = this.generateExecutionRecommendations(
          traceAnalysis,
          task,
        );
      }
    }

    // Run base agent execution
    const baseResult = await this.agentRuntime.execute(task);

    // Merge results
    return {
      ...baseResult,
      traceAnalysis,
      executionRecommendations,
    };
  }

  /**
   * Generate recommendations based on execution data.
   */
  private generateExecutionRecommendations(
    analysis: TraceAnalysisResult,
    task: TraceAgentTask,
  ): string[] {
    const recommendations: string[] = [];

    // Hot path recommendations
    if (analysis.hotPaths.length > 0) {
      const hotPath = analysis.hotPaths[0];
      recommendations.push(
        `🔥 Hot path detected: ${hotPath.steps.join(' → ')}. Consider optimizing this path.`
      );
    }

    // Failure recommendations
    if (analysis.failures.length > 0) {
      for (const failure of analysis.failures) {
        recommendations.push(
          `❌ Failure in ${failure.stepId}: ${failure.message}. ${failure.suggestion}`
        );
      }
    }

    // Coverage recommendations
    if (analysis.executionDiff.coverage < 0.3) {
      recommendations.push(
        `📈 Low execution coverage (${(analysis.executionDiff.coverage * 100).toFixed(0)}%). Consider adding tests for unexecuted code.`
      );
    }

    // Focus step recommendations
    if (task.focusStep) {
      const stepInPath = analysis.hotPaths.some(p => p.steps.includes(task.focusStep!));
      if (stepInPath) {
        recommendations.push(
          `🎯 Focus step "${task.focusStep}" is on a hot path — changes here have high impact.`
        );
      }
    }

    return recommendations;
  }
}
