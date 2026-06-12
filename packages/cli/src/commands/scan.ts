// ============================================================
// scan command - Scan project and build code graph
// ============================================================

import path from 'path';
import { ProjectScanner, SQLiteStore, loadConfig, getAIConfig } from '@codeatlas/core';

export async function scanCommand(projectPath: string, options: { full?: boolean; ai?: boolean; exclude?: string[] }) {
  const resolvedPath = path.resolve(projectPath);

  console.log(`\n🗺️  CodeAtlas Scanner`);
  console.log(`📁 Project: ${resolvedPath}`);
  console.log(`🔄 Mode: ${options.full ? 'Full scan' : 'Incremental'}`);
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
  } catch (err) {
    console.error('❌ Scan failed:', err);
    process.exit(1);
  } finally {
    store.close();
  }
}
