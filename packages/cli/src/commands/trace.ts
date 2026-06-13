// ============================================================
// trace command - Flowtrace integration
// ============================================================

import path from 'path';
import { TraceReader } from '@codeatlas/core';

export async function traceCommand(
  subcommand: string,
  tracePath: string,
  options: { format?: string; step?: string },
) {
  const resolvedPath = path.resolve(tracePath || process.cwd());
  const reader = new TraceReader(resolvedPath);

  switch (subcommand) {
    case 'load':
      await loadTrace(reader, options);
      break;
    case 'steps':
      await listSteps(reader, options);
      break;
    case 'step':
      await showStep(reader, options.step!, options);
      break;
    case 'flow':
      await showFlow(reader, options);
      break;
    case 'stats':
      await showStats(reader, options);
      break;
    case 'runs':
      await listRuns(reader, options);
      break;
    case 'analyze':
      await analyzeTrace(resolvedPath, options);
      break;
    default:
      console.log(`Unknown subcommand: ${subcommand}`);
      console.log('Available: load, steps, step, flow, stats, runs, analyze');
  }
}

async function loadTrace(reader: TraceReader, options: { format?: string }) {
  const data = reader.load();
  if (!data) {
    console.log('❌ No trace found at this path');
    console.log('  Make sure trace.json exists in the directory');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(data.spec, null, 2));
    return;
  }

  console.log(`\n📋 Trace: ${data.spec.title}`);
  console.log('═'.repeat(40));
  console.log(`ID: ${data.spec.id}`);
  console.log(`Version: ${data.spec.version}`);
  console.log(`Description: ${data.spec.description}`);
  console.log(`Steps: ${Object.keys(data.spec.steps).length}`);
  console.log(`Deliverable: ${data.spec.deliverable.description}`);

  if (data.run) {
    console.log(`\n🔄 Current Run: ${data.run.name}`);
    console.log(`Started: ${data.run.started_at}`);
  }

  if (data.replies.length > 0) {
    console.log(`\n💬 Replies: ${data.replies.length}`);
  }
}

async function listSteps(reader: TraceReader, options: { format?: string }) {
  const steps = reader.getStepsWithContext();
  if (steps.length === 0) {
    console.log('❌ No steps found');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(steps, null, 2));
    return;
  }

  console.log(`\n📊 Steps (${steps.length}):\n`);
  for (const step of steps) {
    const statusIcon = getStatusIcon(step.status?.kind);
    const upstream = step.upstream.length > 0 ? ` ← [${step.upstream.join(', ')}]` : '';
    console.log(`${statusIcon} ${step.id}: ${step.spec.name}`);
    console.log(`   ${step.spec.does}${upstream}`);
  }
}

async function showStep(reader: TraceReader, stepId: string, options: { format?: string }) {
  const steps = reader.getStepsWithContext();
  const step = steps.find(s => s.id === stepId);

  if (!step) {
    console.log(`❌ Step "${stepId}" not found`);
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(step, null, 2));
    return;
  }

  console.log(`\n📌 Step: ${step.spec.name}`);
  console.log('═'.repeat(40));
  console.log(`ID: ${step.id}`);
  console.log(`Description: ${step.spec.does}`);
  console.log(`Status: ${step.status?.kind ?? 'unknown'}`);
  console.log(`Assets: ${step.assets.join(', ') || 'none'}`);

  if (step.upstream.length > 0) {
    console.log(`\n⬆️  Upstream (${step.upstream.length}):`);
    for (const u of step.upstream) {
      console.log(`  - ${u}`);
    }
  }

  if (step.downstream.length > 0) {
    console.log(`\n⬇️  Downstream (${step.downstream.length}):`);
    for (const d of step.downstream) {
      console.log(`  - ${d}`);
    }
  }
}

async function showFlow(reader: TraceReader, options: { format?: string }) {
  const steps = reader.getStepsWithContext();
  if (steps.length === 0) {
    console.log('❌ No steps found');
    return;
  }

  if (options.format === 'json') {
    // Export as mermaid
    console.log('graph LR');
    for (const step of steps) {
      const label = step.spec.name.replace(/[^a-zA-Z0-9 ]/g, '');
      console.log(`    ${step.id}["${label}"]`);
    }
    console.log('');
    for (const step of steps) {
      for (const upstream of step.upstream) {
        console.log(`    ${upstream} --> ${step.id}`);
      }
    }
    return;
  }

  console.log(`\n🔄 Execution Flow (${steps.length} steps):\n`);

  // Group by level (topological sort)
  const levels = topologicalSort(steps);
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    console.log(`Level ${i + 1}:`);
    for (const step of level) {
      const statusIcon = getStatusIcon(step.status?.kind);
      console.log(`  ${statusIcon} ${step.id} (${step.spec.name})`);
    }
    console.log('');
  }
}

async function showStats(reader: TraceReader, options: { format?: string }) {
  const stats = reader.getStats();
  if (!stats) {
    console.log('❌ No trace found');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`\n📊 Execution Statistics`);
  console.log('═'.repeat(40));
  console.log(`Total Steps: ${stats.totalSteps}`);
  console.log(`Completed: ${stats.completedSteps}`);
  console.log(`Failed: ${stats.failedSteps}`);
  console.log(`Blocked: ${stats.blockedSteps}`);
  console.log(`Completion Rate: ${(stats.completionRate * 100).toFixed(1)}%`);
}

async function listRuns(reader: TraceReader, options: { format?: string }) {
  const runs = reader.listRuns();
  if (runs.length === 0) {
    console.log('❌ No runs found');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  console.log(`\n🔄 Runs (${runs.length}):\n`);
  for (const runId of runs) {
    const run = reader.loadRun(runId);
    const status = run?.paused ? '⏸️ Paused' : run?.aborted ? '🚫 Aborted' : '▶️ Active';
    console.log(`  ${runId} - ${run?.name ?? 'Unknown'} (${status})`);
  }
}

async function analyzeTrace(tracePath: string, options: { format?: string }) {
  const { SQLiteStore, TraceAnalyzer } = await import('@codeatlas/core');

  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const analyzer = new TraceAnalyzer(store, tracePath);
    const result = analyzer.analyze();

    if (!result) {
      console.log('❌ Could not analyze trace');
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.summary);
  } finally {
    store.close();
  }
}

// ========================
// Helpers
// ========================

function getStatusIcon(kind?: string): string {
  switch (kind) {
    case 'idle': return '⚪';
    case 'running': return '🔄';
    case 'blocked': return '🚫';
    case 'done': return '✅';
    case 'error': return '❌';
    default: return '❓';
  }
}

function topologicalSort(steps: any[]): any[][] {
  const levels: any[][] = [];
  const visited = new Set<string>();
  const levelMap = new Map<string, number>();

  // Calculate levels
  for (const step of steps) {
    const maxUpstreamLevel = step.upstream.reduce((max: number, u: string) => {
      return Math.max(max, (levelMap.get(u) ?? -1) + 1);
    }, 0);
    levelMap.set(step.id, maxUpstreamLevel);
  }

  // Group by level
  const maxLevel = Math.max(...Array.from(levelMap.values()), 0);
  for (let i = 0; i <= maxLevel; i++) {
    const level = steps.filter(s => levelMap.get(s.id) === i);
    if (level.length > 0) {
      levels.push(level);
    }
  }

  return levels;
}
