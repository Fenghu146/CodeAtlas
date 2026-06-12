// ============================================================
// Agent Orchestrator - Manages multiple agents
// ============================================================
// Decomposes tasks, schedules agents, and merges results.

import { SQLiteStore } from '../store/sqlite-store.js';
import { AgentRuntime, type AgentTask, type AgentResult, type SubTask } from '../analyzer/agent-runtime.js';
import type { Symbol } from '../graph/types.js';

export interface TaskDAG {
  /** Root task description */
  description: string;
  /** Decomposed subtasks with dependencies */
  subtasks: SubTask[];
  /** Execution plan (topological order) */
  executionPlan: string[][];
}

export interface OrchestrationResult {
  /** Original task */
  task: string;
  /** Results from each agent */
  results: AgentResult[];
  /** Merged summary */
  summary: string;
  /** Total execution time */
  duration: number;
}

/**
 * Orchestrates multiple agents for complex tasks.
 */
export class AgentOrchestrator {
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
   * Decompose a complex task into parallelizable subtasks.
   */
  decompose(task: string): TaskDAG {
    const keywords = task.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    // Find relevant symbols
    const relevantSymbols = new Map<string, Symbol>();
    for (const keyword of keywords) {
      const matches = this.store.searchSymbols(keyword, { limit: 5 });
      for (const m of matches) {
        relevantSymbols.set(m.id, m);
      }
    }

    // Group symbols by file for parallel processing
    const byFile = new Map<string, Symbol[]>();
    for (const sym of relevantSymbols.values()) {
      if (!byFile.has(sym.filePath)) {
        byFile.set(sym.filePath, []);
      }
      byFile.get(sym.filePath)!.push(sym);
    }

    // Create subtasks
    const subtasks: SubTask[] = [];
    let taskId = 0;

    // Analysis subtask (always first)
    subtasks.push({
      id: `analyze-${taskId++}`,
      description: `Analyze task: ${task}`,
      type: 'analyze',
      dependencies: [],
      status: 'pending',
    });

    // Per-file subtasks (can run in parallel)
    const fileSubtasks: string[] = [];
    for (const [filePath, symbols] of byFile) {
      const subtaskId = `generate-${taskId++}`;
      const symbolNames = symbols.map(s => s.name).join(', ');
      subtasks.push({
        id: subtaskId,
        description: `Modify ${filePath} (${symbolNames})`,
        type: 'generate',
        dependencies: [`analyze-0`],
        status: 'pending',
      });
      fileSubtasks.push(subtaskId);
    }

    // Verification subtask (after all generations)
    subtasks.push({
      id: `verify-${taskId++}`,
      description: 'Verify all changes',
      type: 'verify',
      dependencies: fileSubtasks,
      status: 'pending',
    });

    // Build execution plan (topological order)
    const executionPlan = this.topologicalSort(subtasks);

    return {
      description: task,
      subtasks,
      executionPlan,
    };
  }

  /**
   * Execute a task DAG with multiple agents.
   */
  async execute(dag: TaskDAG): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const results: AgentResult[] = [];

    // Execute subtasks in topological order
    for (const level of dag.executionPlan) {
      // Execute all subtasks in this level in parallel
      const levelPromises = level.map(subtaskId => {
        const subtask = dag.subtasks.find(s => s.id === subtaskId);
        if (!subtask) return Promise.resolve(null);

        return this.executeSubtask(subtask);
      });

      const levelResults = await Promise.all(levelPromises);
      results.push(...levelResults.filter(r => r !== null));
    }

    const duration = Date.now() - startTime;
    const summary = this.buildSummary(dag, results, duration);

    return {
      task: dag.description,
      results,
      summary,
      duration,
    };
  }

  /**
   * Execute a single subtask.
   */
  private async executeSubtask(subtask: SubTask): Promise<AgentResult | null> {
    try {
      return await this.agentRuntime.execute({
        description: subtask.description,
        autoVerify: subtask.type === 'verify',
        dryRun: subtask.type === 'analyze',
      });
    } catch (err) {
      console.error(`Failed to execute subtask ${subtask.id}:`, err);
      return null;
    }
  }

  /**
   * Topological sort for execution plan.
   */
  private topologicalSort(subtasks: SubTask[]): string[][] {
    const levels: string[][] = [];
    const visited = new Set<string>();
    const levelMap = new Map<string, number>();

    // Calculate levels
    for (const subtask of subtasks) {
      const maxDepLevel = subtask.dependencies.reduce((max, dep) => {
        return Math.max(max, (levelMap.get(dep) ?? -1) + 1);
      }, 0);
      levelMap.set(subtask.id, maxDepLevel);
    }

    // Group by level
    const maxLevel = Math.max(...Array.from(levelMap.values()), 0);
    for (let i = 0; i <= maxLevel; i++) {
      const level = subtasks.filter(s => levelMap.get(s.id) === i).map(s => s.id);
      if (level.length > 0) levels.push(level);
    }

    return levels;
  }

  /**
   * Build summary of orchestration.
   */
  private buildSummary(dag: TaskDAG, results: AgentResult[], duration: number): string {
    const parts: string[] = [];

    parts.push('🎯 Orchestration Summary');
    parts.push('═'.repeat(40));
    parts.push(`Task: ${dag.description}`);
    parts.push(`Subtasks: ${dag.subtasks.length}`);
    parts.push(`Execution time: ${(duration / 1000).toFixed(1)}s`);
    parts.push('');

    // Execution plan visualization
    parts.push('Execution Plan:');
    for (let i = 0; i < dag.executionPlan.length; i++) {
      const level = dag.executionPlan[i];
      const parallel = level.length > 1 ? ' (parallel)' : '';
      parts.push(`  Level ${i + 1}: ${level.join(', ')}${parallel}`);
    }

    // Results summary
    if (results.length > 0) {
      parts.push('');
      parts.push(`Results: ${results.length} completed`);
      const successes = results.filter(r => !r.verification || r.verification.passed);
      parts.push(`  ✅ Success: ${successes.length}`);
      parts.push(`  ❌ Failed: ${results.length - successes.length}`);
    }

    return parts.join('\n');
  }
}
