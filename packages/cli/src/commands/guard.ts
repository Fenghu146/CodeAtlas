// ============================================================
// guard command - CI/CD architecture gate
// ============================================================

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { SQLiteStore, GuardAnalyzer, loadConfig } from '@codeatlas/core';
import type { GuardConfig } from '@codeatlas/core';

export async function guardCommand(options: {
  format?: string;
  install?: boolean;
  maxDepth?: string;
  noCircular?: boolean;
}) {
  // Handle --install (generate git hook)
  if (options.install) {
    installHook();
    return;
  }

  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    // Load guard config from .codeatlas.yaml if available
    const projectConfig = loadConfig(process.cwd());
    const guardConfig: GuardConfig = {
      ...(projectConfig as any).guard,
      maxImpactDepth: parseInt(options.maxDepth || '3'),
      forbidCircular: options.noCircular !== false,
    };

    const analyzer = new GuardAnalyzer(store, guardConfig);

    // Run full check
    const result = analyzer.check();

    // Also check impact for changed files
    const changedFiles = getChangedFiles();
    if (changedFiles.length > 0) {
      const impactViolations = analyzer.checkImpact(changedFiles);
      result.violations.push(...impactViolations);
      result.passed = result.violations.filter(v => v.severity === 'error').length === 0;
      result.summary = buildFullSummary(result.passed, result.violations, changedFiles.length);
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.passed ? 0 : 1);
      return;
    }

    console.log(result.summary);
    process.exit(result.passed ? 0 : 1);

  } finally {
    store.close();
  }
}

function getChangedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null || git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    return output.split('\n').map(f => f.trim()).filter(f => f.length > 0);
  } catch {
    return [];
  }
}

function buildFullSummary(passed: boolean, violations: any[], changedCount: number): string {
  const parts: string[] = [];

  if (passed) {
    parts.push('✅ All architecture checks passed!');
  } else {
    parts.push('❌ Architecture checks FAILED');
  }

  parts.push('═'.repeat(40));
  parts.push(`Changed files: ${changedCount}`);

  const errors = violations.filter((v: any) => v.severity === 'error');
  const warnings = violations.filter((v: any) => v.severity === 'warning');

  if (errors.length > 0) {
    parts.push(`\n🚫 Errors (${errors.length}):`);
    for (const v of errors) {
      parts.push(`  [${v.rule}] ${v.message}`);
    }
  }

  if (warnings.length > 0) {
    parts.push(`\n⚠️  Warnings (${warnings.length}):`);
    for (const v of warnings) {
      parts.push(`  [${v.rule}] ${v.message}`);
    }
  }

  return parts.join('\n');
}

function installHook() {
  const hookDir = path.join(process.cwd(), '.git', 'hooks');
  const hookPath = path.join(hookDir, 'pre-commit');

  if (!fs.existsSync(hookDir)) {
    console.log('❌ Not a git repository (no .git/hooks directory)');
    return;
  }

  const hookContent = `#!/bin/sh
# CodeAtlas architecture gate - auto-generated
# Run: codeatlas guard --install to regenerate

echo "🔍 Running CodeAtlas architecture checks..."
codeatlas guard --format text
exit $?
`;

  fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
  console.log('✅ Pre-commit hook installed at .git/hooks/pre-commit');
  console.log('   It will run "codeatlas guard" before each commit.');
}
