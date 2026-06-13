// ============================================================
// doc command - Generate documentation skeletons
// ============================================================

import path from 'path';
import { SQLiteStore, DocExporter } from '@codeatlas/core';

export async function docCommand(options: {
  output?: string;
  source?: boolean;
  diagrams?: boolean;
  granularity?: string;
}) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const exporter = new DocExporter(store);
    const result = await exporter.export(process.cwd(), {
      outputDir: options.output ? path.resolve(options.output) : undefined,
      includeSource: options.source !== false,
      includeDiagrams: options.diagrams !== false,
      granularity: (options.granularity as 'file' | 'module') || 'file',
    });

    console.log(result.summary);

  } finally {
    store.close();
  }
}
