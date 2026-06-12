// ============================================================
// review command - AI code review
// ============================================================

import path from 'path';
import { execSync } from 'child_process';
import { SQLiteStore, ReviewAnalyzer, loadConfig, getAIConfig } from '@codeatlas/core';

export async function reviewCommand(options: {
  focus?: string;
  format?: string;
  depth?: string;
  smart?: boolean;
  budget?: string;
}) {
  const store = await SQLiteStore.create({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    // Get changed files from git
    const changedFiles = getChangedFiles();

    if (changedFiles.length === 0) {
      console.log('\n✅ No uncommitted changes found\n');
      console.log('  Tips:');
      console.log('  - Make some changes first');
      console.log('  - Or use: git diff --name-only to see changes');
      return;
    }

    console.log(`\n📋 Found ${changedFiles.length} changed files:`);
    for (const f of changedFiles) {
      console.log(`  - ${f}`);
    }

    // Load AI config if available
    const config = loadConfig(process.cwd());
    const aiConfig = getAIConfig(config);

    const focus = options.focus
      ? options.focus.split(',').map(f => f.trim())
      : ['correctness', 'security', 'perf', 'readability'];

    const smart = options.smart !== false; // default: true

    if (smart) {
      console.log('🧠 Using smart mode (graph context, ~90% token savings)');
    }

    const analyzer = new ReviewAnalyzer(store, {
      focus,
      depth: parseInt(options.depth || '2'),
      smart,
      tokenBudget: options.budget ? parseInt(options.budget) : undefined,
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    const result = await analyzer.review(changedFiles, { focus, smart, tokenBudget: options.budget ? parseInt(options.budget) : undefined });

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.summary);

  } finally {
    store.close();
  }
}

/**
 * Get changed files from git (uncommitted changes).
 */
function getChangedFiles(): string[] {
  try {
    // Get staged + unstaged changed files
    const output = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null || git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    return output
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);
  } catch {
    return [];
  }
}
