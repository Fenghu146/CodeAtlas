// ============================================================
// team command - Team collaboration features
// ============================================================

import path from 'path';
import fs from 'fs';
import { SQLiteStore, exportTeamData, importTeamData, loadTeamData, saveTeamData, summarizeTeamData } from '@codeatlas/core';

export async function teamExportCommand(options: { output?: string }) {
  const projectPath = process.cwd();
  const dbPath = path.join(projectPath, '.codeatlas', 'db.sqlite');

  if (!fs.existsSync(dbPath)) {
    console.log('\n⚠️  No code graph found. Run "codeatlas scan" first.\n');
    return;
  }

  const store = new SQLiteStore({ dbPath });

  try {
    const outputPath = options.output || path.join(projectPath, '.codeatlas', 'team-data.json');

    console.log('\n📤 Exporting team data...');
    const data = exportTeamData(store, projectPath);
    saveTeamData(data, outputPath);

    console.log('\n📊 Summary:');
    console.log(summarizeTeamData(data));
  } finally {
    store.close();
  }
}

export async function teamImportCommand(inputFile: string) {
  const projectPath = process.cwd();
  const dbPath = path.join(projectPath, '.codeatlas', 'db.sqlite');

  if (!fs.existsSync(dbPath)) {
    console.log('\n⚠️  No code graph found. Run "codeatlas scan" first.\n');
    return;
  }

  const store = new SQLiteStore({ dbPath });

  try {
    console.log(`\n📥 Importing team data from ${inputFile}...`);

    if (!fs.existsSync(inputFile)) {
      console.log(`❌ File not found: ${inputFile}`);
      return;
    }

    const data = loadTeamData(inputFile);
    console.log(`   Project: ${data.project}`);
    console.log(`   Exported: ${data.exportedAt}`);
    console.log(`   Annotations: ${data.annotations.length}`);

    const result = importTeamData(store, data, { merge: true });

    console.log(`\n✅ Import complete!`);
    console.log(`   - Imported: ${result.imported}`);
    console.log(`   - Skipped: ${result.skipped}`);
  } finally {
    store.close();
  }
}

export async function teamStatusCommand() {
  const projectPath = process.cwd();
  const dbPath = path.join(projectPath, '.codeatlas', 'db.sqlite');

  if (!fs.existsSync(dbPath)) {
    console.log('\n⚠️  No code graph found. Run "codeatlas scan" first.\n');
    return;
  }

  const store = new SQLiteStore({ dbPath });

  try {
    const stats = store.getStats();
    const annotationCounts = store.getAnnotationCounts();

    let totalAnnotations = 0;
    annotationCounts.forEach(count => totalAnnotations += count);

    console.log('\n👥 Team Status');
    console.log('═'.repeat(50));
    console.log(`📁 Project: ${projectPath}`);
    console.log(`🔷 Symbols: ${stats.symbols}`);
    console.log(`🔗 Relationships: ${stats.relationships}`);
    console.log(`💬 Annotations: ${totalAnnotations}`);

    if (totalAnnotations > 0) {
      console.log('\n📝 Annotation Distribution:');

      // Get top 10 symbols with most annotations
      const sorted = Array.from(annotationCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [symbolId, count] of sorted) {
        const symbol = store.getSymbol(symbolId);
        if (symbol) {
          console.log(`   ${count}x ${symbol.name} (${symbol.kind}) @ ${symbol.filePath}:${symbol.startLine}`);
        }
      }
    }
    console.log();
  } finally {
    store.close();
  }
}
