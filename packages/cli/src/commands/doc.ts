// ============================================================
// doc command - Generate documentation skeletons
// ============================================================

import path from 'path';
import { SQLiteStore, DocExporter } from '@codeatlas/core';
import { openStore, resolveProjectPath } from '../lib/store.js';

export async function docCommand(options: { project?: string;
  output?: string;
  source?: boolean;
  diagrams?: boolean;
  granularity?: string;
}) {
  const store = openStore(options);

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
