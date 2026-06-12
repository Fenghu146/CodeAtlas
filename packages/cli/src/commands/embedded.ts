// ============================================================
// embedded command - Embedded systems analysis
// ============================================================

import path from 'path';
import { SQLiteStore, EmbeddedAnalyzer, BuildAnalyzer } from '@codeatlas/core';

export async function embeddedCommand(
  subcommand: string,
  options: { format?: string; project?: string },
) {
  const projectPath = path.resolve(options.project || process.cwd());
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  try {
    switch (subcommand) {
      case 'analyze':
        await analyzeEmbedded(store, projectPath, options);
        break;
      case 'build':
        await showBuildConfig(projectPath, options);
        break;
      case 'tasks':
        await showTasks(store, projectPath, options);
        break;
      case 'interrupts':
        await showInterrupts(store, projectPath, options);
        break;
      case 'hardware':
        await showHardware(store, projectPath, options);
        break;
      case 'exclude':
        await showExcludePatterns(projectPath, options);
        break;
      default:
        console.log(`Unknown subcommand: ${subcommand}`);
        console.log('Available: analyze, build, tasks, interrupts, hardware, exclude');
    }
  } finally {
    store.close();
  }
}

async function analyzeEmbedded(store: SQLiteStore, projectPath: string, options: { format?: string }) {
  const analyzer = new EmbeddedAnalyzer(store, projectPath);
  const result = analyzer.analyze();

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.summary);
}

async function showBuildConfig(projectPath: string, options: { format?: string }) {
  const analyzer = new BuildAnalyzer(projectPath);
  const config = analyzer.analyze();

  if (options.format === 'json') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  console.log(`\n📦 Build Configuration`);
  console.log('═'.repeat(40));
  console.log(`Type: ${config.type}`);
  if (config.name) console.log(`Name: ${config.name}`);
  if (config.platform) console.log(`Platform: ${config.platform}`);
  if (config.board) console.log(`Board: ${config.board}`);
  if (config.framework) console.log(`Framework: ${config.framework}`);

  if (config.dependencies.length > 0) {
    console.log(`\n📚 Dependencies (${config.dependencies.length}):`);
    for (const dep of config.dependencies.slice(0, 10)) {
      console.log(`   - ${dep}`);
    }
    if (config.dependencies.length > 10) console.log(`   ... and ${config.dependencies.length - 10} more`);
  }

  if (config.flags.length > 0) {
    console.log(`\n🚩 Build Flags (${config.flags.length}):`);
    for (const flag of config.flags.slice(0, 5)) {
      console.log(`   ${flag}`);
    }
  }
}

async function showTasks(store: SQLiteStore, projectPath: string, options: { format?: string }) {
  const analyzer = new EmbeddedAnalyzer(store, projectPath);
  const result = analyzer.analyze();

  if (result.tasks.length === 0) {
    console.log('\n❌ No RTOS tasks detected');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(result.tasks, null, 2));
    return;
  }

  console.log(`\n🔄 RTOS Tasks (${result.tasks.length}):\n`);
  for (const task of result.tasks) {
    console.log(`  - ${task.name}`);
    console.log(`    Function: ${task.function}`);
    console.log(`    Location: ${task.file}:${task.line}`);
  }
}

async function showInterrupts(store: SQLiteStore, projectPath: string, options: { format?: string }) {
  const analyzer = new EmbeddedAnalyzer(store, projectPath);
  const result = analyzer.analyze();

  if (result.interrupts.length === 0) {
    console.log('\n❌ No interrupt handlers detected');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(result.interrupts, null, 2));
    return;
  }

  console.log(`\n⚡ Interrupt Handlers (${result.interrupts.length}):\n`);
  for (const h of result.interrupts) {
    const source = h.source ? ` (${h.source})` : '';
    console.log(`  - ${h.name}${source}`);
    console.log(`    Location: ${h.file}:${h.line}`);
  }
}

async function showHardware(store: SQLiteStore, projectPath: string, options: { format?: string }) {
  const analyzer = new EmbeddedAnalyzer(store, projectPath);
  const result = analyzer.analyze();

  if (result.hardwareAccess.length === 0) {
    console.log('\n❌ No hardware access detected');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(result.hardwareAccess, null, 2));
    return;
  }

  // Group by peripheral
  const byPeripheral = new Map<string, typeof result.hardwareAccess>();
  for (const access of result.hardwareAccess) {
    if (!byPeripheral.has(access.peripheral)) {
      byPeripheral.set(access.peripheral, []);
    }
    byPeripheral.get(access.peripheral)!.push(access);
  }

  console.log(`\n🔌 Hardware Peripherals (${byPeripheral.size}):\n`);
  for (const [peripheral, accesses] of byPeripheral) {
    console.log(`  ${peripheral} (${accesses.length} accesses)`);
    for (const a of accesses.slice(0, 3)) {
      console.log(`    - ${a.accessType} @ ${a.file}:${a.line}`);
    }
    if (accesses.length > 3) console.log(`    ... and ${accesses.length - 3} more`);
  }
}

async function showExcludePatterns(projectPath: string, options: { format?: string }) {
  const analyzer = new BuildAnalyzer(projectPath);
  const patterns = analyzer.getExcludePatterns();

  if (options.format === 'json') {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }

  console.log(`\n🚫 Recommended Exclusion Patterns (${patterns.length}):\n`);
  for (const pattern of patterns) {
    console.log(`  ${pattern}`);
  }
}
