// ============================================================
// refactor command - Smart refactoring analysis
// ============================================================

import path from 'path';
import { SQLiteStore, RefactorEngine } from '@codeatlas/core';
import type { SmellType } from '@codeatlas/core';
import { openStore, resolveProjectPath } from '../lib/store.js';

export async function refactorCommand(options: { project?: string;
  detect?: boolean;
  type?: string;
  format?: string;
}) {
  const store = openStore(options);

  try {
    const engine = new RefactorEngine(store);

    const report = options.type
      ? engine.analyzeType(options.type as SmellType)
      : engine.analyze();

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(report.summary);

  } finally {
    store.close();
  }
}
