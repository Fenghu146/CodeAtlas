// ============================================================
// Trace Reader - Reads Flowtrace data files
// ============================================================
// Parses trace.json, state.json, and replies to build
// a complete trace data structure.

import fs from 'fs';
import path from 'path';
import type {
  TraceSpec,
  RunState,
  StructuredOutput,
  TraceData,
  TraceStepWithContext,
  ExecutionStats,
} from './types.js';

/**
 * Reads and parses Flowtrace data from a trace directory.
 */
export class TraceReader {
  private tracePath: string;

  constructor(tracePath: string) {
    this.tracePath = tracePath;
  }

  /**
   * Load complete trace data including current run.
   */
  load(): TraceData | null {
    const spec = this.loadTraceSpec();
    if (!spec) return null;

    const run = this.loadLatestRun();
    const replies = run ? this.loadReplies(run) : [];

    return {
      spec,
      run,
      replies,
      tracePath: this.tracePath,
    };
  }

  /**
   * Load trace.json specification.
   */
  loadTraceSpec(): TraceSpec | null {
    const traceJsonPath = path.join(this.tracePath, 'trace.json');
    if (!fs.existsSync(traceJsonPath)) return null;

    try {
      const content = fs.readFileSync(traceJsonPath, 'utf-8');
      return JSON.parse(content) as TraceSpec;
    } catch {
      return null;
    }
  }

  /**
   * Load the latest run state.
   */
  loadLatestRun(): RunState | null {
    const runsDir = path.join(this.tracePath, 'runs');
    if (!fs.existsSync(runsDir)) return null;

    const runs = fs.readdirSync(runsDir)
      .filter(d => d.startsWith('run_'))
      .sort()
      .reverse();

    if (runs.length === 0) return null;

    return this.loadRun(runs[0]);
  }

  /**
   * Load a specific run by ID.
   */
  loadRun(runId: string): RunState | null {
    const statePath = path.join(this.tracePath, 'runs', runId, 'state.json');
    if (!fs.existsSync(statePath)) return null;

    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(content) as RunState;
    } catch {
      return null;
    }
  }

  /**
   * List all run IDs.
   */
  listRuns(): string[] {
    const runsDir = path.join(this.tracePath, 'runs');
    if (!fs.existsSync(runsDir)) return [];

    return fs.readdirSync(runsDir)
      .filter(d => d.startsWith('run_'))
      .sort()
      .reverse();
  }

  /**
   * Load replies for a run.
   */
  loadReplies(run: RunState): StructuredOutput[] {
    const runDir = path.join(this.tracePath, 'runs');
    // Find the run directory
    const runs = fs.readdirSync(runDir).filter(d => d.startsWith('run_'));
    if (runs.length === 0) return [];

    const latestRun = runs.sort().reverse()[0];
    const repliesDir = path.join(runDir, latestRun, 'replies');

    if (!fs.existsSync(repliesDir)) return [];

    const replies: StructuredOutput[] = [];
    const files = fs.readdirSync(repliesDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(repliesDir, file), 'utf-8');
        replies.push(JSON.parse(content) as StructuredOutput);
      } catch {
        // Skip invalid reply files
      }
    }

    return replies;
  }

  /**
   * Get steps with their context (upstream/downstream).
   */
  getStepsWithContext(): TraceStepWithContext[] {
    const spec = this.loadTraceSpec();
    if (!spec) return [];

    const run = this.loadLatestRun();
    const steps: TraceStepWithContext[] = [];

    // Build downstream map
    const downstreamMap = new Map<string, string[]>();
    for (const [slug, stepSpec] of Object.entries(spec.steps)) {
      for (const upstream of stepSpec.from_steps) {
        if (!downstreamMap.has(upstream)) {
          downstreamMap.set(upstream, []);
        }
        downstreamMap.get(upstream)!.push(slug);
      }
    }

    for (const [slug, stepSpec] of Object.entries(spec.steps)) {
      steps.push({
        spec: stepSpec,
        id: slug,
        status: run?.steps[slug]?.status,
        assets: run?.steps[slug]?.assets ?? stepSpec.assets,
        upstream: stepSpec.from_steps,
        downstream: downstreamMap.get(slug) ?? [],
      });
    }

    return steps;
  }

  /**
   * Get execution statistics.
   */
  getStats(): ExecutionStats | null {
    const spec = this.loadTraceSpec();
    const run = this.loadLatestRun();
    if (!spec) return null;

    const totalSteps = Object.keys(spec.steps).length;
    let completedSteps = 0;
    let failedSteps = 0;
    let blockedSteps = 0;

    if (run) {
      for (const stepState of Object.values(run.steps)) {
        switch (stepState.status.kind) {
          case 'done': completedSteps++; break;
          case 'error': failedSteps++; break;
          case 'blocked': blockedSteps++; break;
        }
      }
    }

    return {
      totalSteps,
      completedSteps,
      failedSteps,
      blockedSteps,
      completionRate: totalSteps > 0 ? completedSteps / totalSteps : 0,
    };
  }
}
