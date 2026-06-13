// ============================================================
// path command - Find shortest path between two symbols
// ============================================================

import path from 'path';
import { SQLiteStore, PathFinder } from '@codeatlas/core';

export async function pathCommand(source: string, target: string, options: { depth?: string; format?: string }) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const finder = new PathFinder(store);
    const maxDepth = parseInt(options.depth || '6');
    const result = finder.find(source, target, maxDepth);

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.summary);

  } finally {
    store.close();
  }
}
