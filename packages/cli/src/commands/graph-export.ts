// ============================================================
// graph-export command - Export graph data for analysis
// ============================================================

import path from 'path';
import fs from 'fs';
import { SQLiteStore, GraphExporter } from '@codeatlas/core';
import type { ExportFormat } from '@codeatlas/core';
import { openStore, resolveProjectPath } from '../lib/store.js';

export async function graphExportCommand(options: { project?: string;
  format?: string;
  output?: string;
  layer?: string;
  kind?: string;
  limit?: string;
  stats?: boolean;
}) {
  const store = openStore(options);

  try {
    const exporter = new GraphExporter(store);

    // Stats mode
    if (options.stats) {
      const stats = exporter.getStats({
        layer: options.layer,
        kind: options.kind,
        limit: options.limit ? parseInt(options.limit) : undefined,
      });
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    // Export mode
    const format = (options.format || 'json') as ExportFormat;
    const result = exporter.export({
      format,
      layer: options.layer,
      kind: options.kind,
      limit: options.limit ? parseInt(options.limit) : undefined,
    });

    // Output to file or stdout
    if (options.output) {
      fs.writeFileSync(options.output, result);
      console.log(`✅ Exported to ${options.output}`);
    } else {
      console.log(result);
    }

  } finally {
    store.close();
  }
}
