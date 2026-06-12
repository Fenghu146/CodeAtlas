// ============================================================
// embedded command - Embedded systems analysis
// ============================================================

import path from 'path';
import { SQLiteStore, EmbeddedAnalyzer, BuildAnalyzer } from '@codeatlas/core';
import { EmbeddedLinuxAnalyzer } from '@codeatlas/core';

export async function embeddedCommand(
  subcommand: string,
  options: { format?: string; project?: string; profile?: string },
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
      // New embedded Linux subcommands
      case 'linux':
        await showLinuxTotal(projectPath, options);
        break;
      case 'drivers':
        await showLinuxDrivers(projectPath, options);
        break;
      case 'devicetree':
        await showLinuxDeviceTree(projectPath, options);
        break;
      case 'kconfig':
        await showLinuxKconfig(projectPath, options);
        break;
      case 'interfaces':
        await showLinuxInterfaces(projectPath, options);
        break;
      default:
        console.log(`Unknown subcommand: ${subcommand}`);
        console.log('Available: analyze, build, tasks, interrupts, hardware, exclude, linux, drivers, devicetree, kconfig, interfaces');
    }
  } finally {
    store.close();
  }
}

async function analyzeEmbedded(store: SQLiteStore, projectPath: string, options: { format?: string; profile?: string }) {
  const profile = (options.profile || 'auto') as 'auto' | 'mcu' | 'linux';
  const analyzer = new EmbeddedAnalyzer(store, projectPath, { profile });
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

  // Linux build metadata
  if (config.linux) {
    console.log(`\n🐧 Linux Build Metadata:`);
    console.log(`   Family: ${config.linux.family}`);
    if (config.linux.targets?.length) console.log(`   Kbuild targets: ${config.linux.targets.length}`);
    if (config.linux.configs?.length) console.log(`   Kconfig options: ${config.linux.configs.length}`);
    if (config.linux.recipes?.length) console.log(`   Yocto recipes: ${config.linux.recipes.length}`);
    if (config.linux.packages?.length) console.log(`   Buildroot packages: ${config.linux.packages.length}`);
  }
}

async function showTasks(store: SQLiteStore, projectPath: string, options: { format?: string; profile?: string }) {
  const profile = (options.profile || 'auto') as 'auto' | 'mcu' | 'linux';
  const analyzer = new EmbeddedAnalyzer(store, projectPath, { profile });
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

async function showInterrupts(store: SQLiteStore, projectPath: string, options: { format?: string; profile?: string }) {
  const profile = (options.profile || 'auto') as 'auto' | 'mcu' | 'linux';
  const analyzer = new EmbeddedAnalyzer(store, projectPath, { profile });
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

async function showHardware(store: SQLiteStore, projectPath: string, options: { format?: string; profile?: string }) {
  const profile = (options.profile || 'auto') as 'auto' | 'mcu' | 'linux';
  const analyzer = new EmbeddedAnalyzer(store, projectPath, { profile });
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

// ============================================================
// New: Embedded Linux subcommands
// ============================================================

async function getLinuxResult(projectPath: string, options: { format?: string; profile?: string }): Promise<import('@codeatlas/core').EmbeddedLinuxAnalysis> {
  const analyzer = new EmbeddedLinuxAnalyzer(projectPath);
  return analyzer.analyze();
}

async function showLinuxTotal(projectPath: string, options: { format?: string; profile?: string }) {
  const result = await getLinuxResult(projectPath, options);
  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n${result.summary}`);
}

async function showLinuxDrivers(projectPath: string, options: { format?: string; profile?: string }) {
  const result = await getLinuxResult(projectPath, options);
  if (options.format === 'json') {
    console.log(JSON.stringify({ kernelModules: result.kernelModules, drivers: result.drivers }, null, 2));
    return;
  }
  console.log(`\n🐧 Embedded Linux Drivers\n${'═'.repeat(40)}`);
  console.log(`\nKernel Modules (${result.kernelModules.length}):`);
  for (const mod of result.kernelModules.slice(0, 20)) {
    console.log(`  - ${mod.name}`);
    if (mod.license) console.log(`    License: ${mod.license}`);
    if (mod.author) console.log(`    Author: ${mod.author}`);
    if (mod.init) console.log(`    Init: ${mod.init}`);
    if (mod.aliases.length) console.log(`    Aliases: ${mod.aliases.join(', ')}`);
    console.log(`    File: ${mod.file}:${mod.line}`);
  }
  console.log(`\nDrivers by bus (${result.drivers.length}):`);
  for (const driver of result.drivers) {
    console.log(`  - ${driver.name} [${driver.bus}] @ ${driver.file}:${driver.line}`);
    if (driver.probe) console.log(`    Probe: ${driver.probe}`);
    if (driver.remove) console.log(`    Remove: ${driver.remove}`);
    if (driver.compatibles.length) console.log(`    Compatible: ${driver.compatibles.join(', ')}`);
    if (driver.matchedDeviceTreeNodes.length) console.log(`    DTS nodes: ${driver.matchedDeviceTreeNodes.join(', ')}`);
  }
}

async function showLinuxDeviceTree(projectPath: string, options: { format?: string; profile?: string }) {
  const result = await getLinuxResult(projectPath, options);
  if (options.format === 'json') {
    console.log(JSON.stringify(result.deviceTree, null, 2));
    return;
  }
  console.log(`\n🐧 Device Tree\n${'═'.repeat(40)}`);
  console.log(`\nNodes (${result.deviceTree.nodes.length}):`);
  for (const node of result.deviceTree.nodes) {
    const label = node.label ? ` [${node.label}]` : '';
    const st = node.status ? ` status=${node.status}` : '';
    console.log(`  - ${node.name}${label}${st}`);
    if (node.compatible.length) console.log(`    Compatible: ${node.compatible.join(', ')}`);
    if (node.reg.length) console.log(`    Reg: ${node.reg.join(', ')}`);
    if (node.interrupts.length) console.log(`    Interrupts: ${node.interrupts.join(', ')}`);
    if (node.matchedDrivers.length) console.log(`    Matched drivers: ${node.matchedDrivers.join(', ')}`);
    console.log(`    File: ${node.file}:${node.line}`);
  }
  if (result.deviceTree.unmatchedCompatibles.length > 0) {
    console.log(`\n⚠️ Unmatched compatibles (${result.deviceTree.unmatchedCompatibles.length}):`);
    for (const c of result.deviceTree.unmatchedCompatibles.slice(0, 10)) {
      console.log(`  - ${c}`);
    }
  }
}

async function showLinuxKconfig(projectPath: string, options: { format?: string; profile?: string }) {
  const result = await getLinuxResult(projectPath, options);
  if (options.format === 'json') {
    console.log(JSON.stringify(result.kconfig, null, 2));
    return;
  }
  console.log(`\n🐧 Kconfig Options\n${'═'.repeat(40)}`);
  for (const opt of result.kconfig.options) {
    const enabled = opt.enabled ? ` [${opt.enabled}]` : '';
    console.log(`  - ${opt.name} (${opt.type ?? 'unknown'})${enabled}`);
    if (opt.prompt) console.log(`    Prompt: ${opt.prompt}`);
    if (opt.dependsOn.length) console.log(`    Depends on: ${opt.dependsOn.join(', ')}`);
    if (opt.selects.length) console.log(`    Selects: ${opt.selects.join(', ')}`);
    if (opt.defaults.length) console.log(`    Defaults: ${opt.defaults.join(', ')}`);
    console.log(`    File: ${opt.file}:${opt.line}`);
  }
}

async function showLinuxInterfaces(projectPath: string, options: { format?: string; profile?: string }) {
  const result = await getLinuxResult(projectPath, options);
  if (options.format === 'json') {
    console.log(JSON.stringify(result.interfaces, null, 2));
    return;
  }
  console.log(`\n🐧 Userspace Interfaces\n${'═'.repeat(40)}`);
  if (result.interfaces.length === 0) {
    console.log('\n❌ No userspace interfaces detected');
    return;
  }
  const byKind = new Map<string, typeof result.interfaces>();
  for (const iface of result.interfaces) {
    if (!byKind.has(iface.kind)) byKind.set(iface.kind, []);
    byKind.get(iface.kind)!.push(iface);
  }
  for (const [kind, items] of byKind) {
    console.log(`\n${kind} (${items.length}):`);
    for (const item of items.slice(0, 10)) {
      console.log(`  - ${item.name} @ ${item.file}:${item.line}`);
    }
  }
}
