// ============================================================
// scan command - Scan project and build code graph
// ============================================================

import path from 'path';
import { ProjectScanner, SQLiteStore, loadConfig, getAIConfig, SmellDetector } from '@codeatlas/core';

export async function scanCommand(projectPath: string, options: { full?: boolean; ai?: boolean; report?: boolean; exclude?: string[]; profile?: string }) {
  const resolvedPath = path.resolve(projectPath);

  console.log(`\n🗺️  CodeAtlas Scanner`);
  console.log(`📁 Project: ${resolvedPath}`);
  console.log(`🔄 Mode: ${options.full ? 'Full scan' : 'Incremental'}`);
  if (options.profile) console.log(`🎯 Profile: ${options.profile}`);
  if (options.exclude && options.exclude.length > 0) {
    console.log(`🚫 Excluding: ${options.exclude.join(', ')}`);
  }

  // Check AI config
  let enableAI = options.ai ?? false;
  if (enableAI) {
    try {
      const config = loadConfig(resolvedPath);
      const aiConfig = getAIConfig(config);
      if (aiConfig.provider) {
        console.log(`🤖 AI: ${aiConfig.provider} (${aiConfig.model})`);
      } else {
        console.log(`⚠️  AI: No provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.`);
        enableAI = false;
      }
    } catch (err) {
      console.log(`⚠️  AI: Config load failed. Continuing without AI.`);
      enableAI = false;
    }
  }
  console.log('');

  const store = await SQLiteStore.create({
    dbPath: path.join(resolvedPath, '.codeatlas', 'db.sqlite'),
  });

  const scanner = new ProjectScanner(store);

  try {
    const result = await scanner.scan({
      projectPath: resolvedPath,
      full: options.full,
      enableAI,
      exclude: options.exclude,
      onProgress: (current: number, total: number, file: string) => {
        const pct = Math.round((current / total) * 100);
        process.stdout.write(`\r  Parsing [${current}/${total}] (${pct}%) ${file.padEnd(60)}`);
      },
    });

    console.log(`\n\n✅ Scan complete in ${result.duration}ms`);
    console.log(`   📄 Files scanned: ${result.filesScanned}`);
    console.log(`   ⏭️  Files skipped: ${result.filesSkipped}`);
    console.log(`   🔷 Symbols found: ${result.symbolsFound}`);
    console.log(`   🔗 Relationships: ${result.relationshipsFound}`);
    console.log(`   🌐 Languages: ${result.languages.join(', ')}`);
    console.log(`   💾 Database: ${path.join(resolvedPath, '.codeatlas', 'db.sqlite')}\n`);

    // Auto-generate report
    if (options.report) {
      await generateReport(store, resolvedPath);
    }
  } catch (err) {
    console.error('❌ Scan failed:', err);
    process.exit(1);
  } finally {
    store.close();
  }
}

/**
 * Generate a code health report after scan: hotspots + refactor suggestions.
 */
async function generateReport(store: SQLiteStore, projectPath: string) {
  console.log('═'.repeat(50));
  console.log('📋 Code Health Report');
  console.log('═'.repeat(50));

  // ── Hotspots ──
  console.log('\n🔥 Hotspots');
  console.log('─'.repeat(40));

  const allSymbols = store.searchSymbols('', { limit: 10000 });
  const symbolIds = allSymbols.map(s => s.id);
  const callerCounts = store.getCallerCounts(symbolIds);
  const calleeCounts = store.getCalleeCounts(symbolIds);

  const hotspots: Array<{ name: string; kind: string; file: string; line: number; reason: string; score: number }> = [];

  for (const symbol of allSymbols) {
    let score = 0;
    const reasons: string[] = [];

    const callerCount = callerCounts.get(symbol.id) ?? 0;
    if (callerCount > 5) { score += callerCount; reasons.push(`${callerCount} callers`); }

    const calleeCount = calleeCounts.get(symbol.id) ?? 0;
    if (calleeCount > 5) { score += calleeCount; reasons.push(`${calleeCount} callees`); }

    if (symbol.sourceCode) {
      const lines = symbol.sourceCode.split('\n').length;
      if (lines > 50) { score += Math.floor(lines / 10); reasons.push(`${lines} lines`); }
    }

    if (score > 0) {
      hotspots.push({ name: symbol.name, kind: symbol.kind, file: symbol.filePath, line: symbol.startLine, reason: reasons.join(', '), score });
    }
  }

  hotspots.sort((a, b) => b.score - a.score);

  if (hotspots.length === 0) {
    console.log('  ✅ No hotspots found. Codebase looks healthy!');
  } else {
    for (const h of hotspots.slice(0, 10)) {
      console.log(`  🔶 ${h.name} (${h.kind}) @ ${h.file}:${h.line}`);
      console.log(`     ${h.reason} [score: ${h.score}]`);
    }
  }

  // ── Code Smells (Refactor) ──
  console.log('\n🔍 Code Smells');
  console.log('─'.repeat(40));

  const smellDetector = new SmellDetector(store);
  const smells = smellDetector.detect();

  if (smells.length === 0) {
    console.log('  ✅ No code smells detected.');
  } else {
    for (const smell of smells.slice(0, 10)) {
      const icon = smell.severity === 'error' ? '🔴' : smell.severity === 'warning' ? '🟡' : '🔵';
      console.log(`  ${icon} [${smell.type}] ${smell.description}`);
      console.log(`     💡 ${smell.suggestion}`);
    }
    if (smells.length > 10) {
      console.log(`  ... and ${smells.length - 10} more smells`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Report: ${hotspots.length} hotspots, ${smells.length} code smells`);
  console.log();
}
