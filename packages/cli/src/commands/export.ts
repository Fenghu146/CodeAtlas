// ============================================================
// export command - Export graph data
// ============================================================

import path from 'path';
import fs from 'fs';
import { SQLiteStore } from '@codeatlas/core';

export async function exportCommand(options: { format?: string; output?: string }) {
  const format = options.format || 'json';
  const projectPath = process.cwd();
  const dbPath = path.join(projectPath, '.codeatlas', 'db.sqlite');

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.log('\n⚠️  No code graph found for this project.');
    console.log('\n  To create one, run:');
    console.log('    codeatlas scan\n');
    return;
  }

  const store = new SQLiteStore({ dbPath });

  try {
    const stats = store.getStats();

    if (stats.symbols === 0) {
      console.log('\n⚠️  Graph is empty. Run "codeatlas scan" first.\n');
      return;
    }

    console.log(`\n📤 Exporting Code Graph (${format.toUpperCase()})`);
    console.log('═'.repeat(50));

    let exportData: any;
    let outputFile: string;

    if (format === 'json') {
      exportData = exportToJson(store);
      outputFile = options.output || path.join(projectPath, 'codeatlas-export.json');
    } else if (format === 'html') {
      exportData = exportToHtml(store, projectPath);
      outputFile = options.output || path.join(projectPath, 'codeatlas-export.html');
    } else {
      console.log(`\n❌ Unsupported format: ${format}`);
      console.log('  Supported formats: json, html\n');
      return;
    }

    // Write file
    fs.writeFileSync(outputFile, exportData, 'utf-8');

    console.log(`\n✅ Export complete!`);
    console.log(`   📄 Output: ${outputFile}`);
    console.log(`   📊 Stats: ${stats.symbols} symbols, ${stats.relationships} relationships, ${stats.files} files\n`);

  } finally {
    store.close();
  }
}

function exportToJson(store: SQLiteStore): string {
  const stats = store.getStats();

  // Get all symbols (use empty string which matches all via LIKE %%)
  const symbols = store.searchSymbols('', { limit: 10000 });

  // Build nodes
  const nodes = symbols.map(s => ({
    id: s.id,
    label: s.name,
    kind: s.kind,
    layer: s.layer,
    file: s.filePath,
    line: s.startLine,
    exported: s.exported,
  }));

  // Build edges (simplified - get all relationships)
  const edges: any[] = [];
  for (const symbol of symbols) {
    const outgoing = store.getRelationshipsFrom(symbol.id);
    for (const rel of outgoing) {
      edges.push({
        id: rel.id,
        source: rel.sourceId,
        target: rel.targetId,
        kind: rel.kind,
      });
    }
  }

  const data = {
    exportedAt: new Date().toISOString(),
    stats,
    nodes,
    edges,
  };

  return JSON.stringify(data, null, 2);
}

function exportToHtml(store: SQLiteStore, projectPath: string): string {
  const stats = store.getStats();
  const symbols = store.searchSymbols('', { limit: 10000 });

  // Group by layer
  const byLayer = new Map<string, typeof symbols>();
  for (const s of symbols) {
    if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
    byLayer.get(s.layer)!.push(s);
  }

  const layerConfig: Record<string, { color: string; name: string }> = {
    interface: { color: '#3b82f6', name: 'Interface' },
    business: { color: '#22c55e', name: 'Business' },
    data: { color: '#f97316', name: 'Data' },
    utility: { color: '#9ca3af', name: 'Utility' },
    unknown: { color: '#6b7280', name: 'Unknown' },
  };

  let layersHtml = '';
  for (const [layer, layerSymbols] of byLayer) {
    const config = layerConfig[layer] || layerConfig.unknown;
    layersHtml += `
    <div class="layer">
      <h3 style="color: ${config.color}">${config.name} (${layerSymbols.length})</h3>
      <ul>
        ${layerSymbols.map(s => `
          <li>
            <strong>${s.name}</strong>
            <span class="kind">${s.kind}</span>
            <span class="file">${s.filePath}:${s.startLine}</span>
          </li>
        `).join('')}
      </ul>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeAtlas Export - ${path.basename(projectPath)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f8fafc; }
    h1 { color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0; }
    .stat { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat h4 { margin: 0; color: #64748b; font-size: 14px; }
    .stat p { margin: 10px 0 0; font-size: 24px; font-weight: bold; color: #1e293b; }
    .layer { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .layer h3 { margin-top: 0; }
    .layer ul { list-style: none; padding: 0; }
    .layer li { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .kind { display: inline-block; background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 10px; }
    .file { color: #64748b; font-size: 12px; margin-left: 10px; }
    footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <h1>🗺️ CodeAtlas Export</h1>
  <p>Project: <strong>${projectPath}</strong></p>

  <div class="stats">
    <div class="stat">
      <h4>Files</h4>
      <p>${stats.files}</p>
    </div>
    <div class="stat">
      <h4>Symbols</h4>
      <p>${stats.symbols}</p>
    </div>
    <div class="stat">
      <h4>Relationships</h4>
      <p>${stats.relationships}</p>
    </div>
  </div>

  <h2>Architecture Layers</h2>
  ${layersHtml}

  <footer>
    Generated by CodeAtlas on ${new Date().toLocaleString()}
  </footer>
</body>
</html>`;
}
