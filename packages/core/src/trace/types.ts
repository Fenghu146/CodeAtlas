// ============================================================
// Flowtrace Data Types
// ============================================================
// Type definitions for Flowtrace's trace.json and state.json formats

/** Flowtrace Step Specification (from trace.json) */
export interface TraceStepSpec {
  /** Display name (2-5 words) */
  name: string;
  /** Short description (<=12 words) */
  does: string;
  /** Upstream step slugs (DAG edges) */
  from_steps: string[];
  /** Files this step produces */
  assets: string[];
  /** Optional UI label for assets */
  asset_title?: string;
  /** Whether this step is deprecated */
  deprecated?: boolean;
}

/** Flowtrace Deliverable (from trace.json) */
export interface TraceDeliverable {
  /** What the user receives */
  description: string;
  /** Run-relative output paths */
  assets: string[];
}

/** Flowtrace Environment (from trace.json) */
export interface TraceEnvironment {
  /** Python package requirements */
  python?: string[];
  /** R package requirements */
  r?: string[];
}

/** Flowtrace Trace (from trace.json) */
export interface TraceSpec {
  /** Unique identifier (slug format) */
  id: string;
  /** Display name */
  title: string;
  /** Description (1-2 sentences) */
  description: string;
  /** Semver version */
  version: string;
  /** Step definitions (DAG nodes) */
  steps: Record<string, TraceStepSpec>;
  /** Final deliverable */
  deliverable: TraceDeliverable;
  /** Runtime environment */
  environment?: TraceEnvironment;
}

/** Step Status (from state.json) */
export type StepStatus =
  | { kind: 'idle' }
  | { kind: 'running'; message?: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'done'; message?: string }
  | { kind: 'error'; message: string };

/** Step State (from state.json) */
export interface StepState {
  /** Current status */
  status: StepStatus;
  /** Output files */
  assets: string[];
}

/** Deliverable State (from state.json) */
export interface DeliverableState {
  status: StepStatus;
  assets: string[];
}

/** Run State (from state.json) */
export interface RunState {
  /** Human-readable label */
  name: string;
  /** Start time (RFC3339) */
  started_at: string;
  /** Whether run is paused */
  paused?: boolean;
  /** Whether run was aborted */
  aborted?: boolean;
  /** Per-step states */
  steps: Record<string, StepState>;
  /** Final deliverable state */
  deliverable: DeliverableState;
}

/** Evidence type in replies */
export type EvidenceType = 'figure' | 'document' | 'table' | 'comparison' | 'check' | 'citation' | 'appendix';

/** Evidence block in replies */
export interface Evidence {
  type: EvidenceType;
  path?: string;
  caption?: string;
  title?: string;
  content?: string;
  label?: string;
  passed?: boolean;
  expected?: string;
  actual?: string;
  columns?: string[];
  rows?: string[][];
  id?: string;
  authors?: string;
  year?: number;
  url?: string;
}

/** Reply status */
export type ReplyStatus = 'partial' | 'complete' | 'blocked' | 'error';

/** Structured Output (from replies/*.json) */
export interface StructuredOutput {
  /** One-line summary */
  headline: string;
  /** Reply status */
  status: ReplyStatus;
  /** Step this reply belongs to */
  checkpoint?: {
    step_id: string;
    step_name?: string;
  };
  /** Supporting points */
  support?: string[];
  /** Structured findings */
  findings?: Array<{ title: string; detail: string }>;
  /** Next-action suggestions */
  suggestions?: string[];
  /** Typed evidence blocks */
  evidence?: Evidence[];
  /** Caveat/disclaimer */
  note?: string;
  /** Conclusion */
  takeaway?: string;
}

/** Complete trace data with execution state */
export interface TraceData {
  /** The trace specification */
  spec: TraceSpec;
  /** Current run state (if any) */
  run: RunState | null;
  /** All replies for current run */
  replies: StructuredOutput[];
  /** Path to trace directory */
  tracePath: string;
}

/** Step with execution context */
export interface TraceStepWithContext {
  /** Step specification */
  spec: TraceStepSpec;
  /** Step slug/ID */
  id: string;
  /** Current execution status */
  status?: StepStatus;
  /** Output files */
  assets: string[];
  /** Upstream steps */
  upstream: string[];
  /** Downstream steps */
  downstream: string[];
}

/** Execution statistics */
export interface ExecutionStats {
  /** Total steps */
  totalSteps: number;
  /** Completed steps */
  completedSteps: number;
  /** Failed steps */
  failedSteps: number;
  /** Blocked steps */
  blockedSteps: number;
  /** Completion rate */
  completionRate: number;
  /** Execution time (if available) */
  duration?: number;
}
