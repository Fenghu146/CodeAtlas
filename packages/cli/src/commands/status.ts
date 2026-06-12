// ============================================================
// status command - Show code graph index status
// ============================================================

import path from 'path';
import fs from 'fs';
import { SQLiteStore } from '@codeatlas/core';

export async function statusCommand() {
  const projectPath = process.cwd();
  const dbDir = path.join(projectPath, '.codeatlas');
  const dbPath = path.join(dbDir, 'db.sqlite');

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.log('\n⚠️  No code graph found for this project.');
    console.log('\n  To create one, run:');
    console.log('    codeatlas scan\n');
    return;
  }

  const store = await SQLiteStore.create({ dbPath });

  try {
    const stats = store.getStats();

    console.log('\n📊 Code Atlas Status');
    console.log('═'.repeat(50));
    console.log(`📁 Project: ${projectPath}`);
    console.log(`💾 Database: ${dbPath}`);

    // Get database file size
    const dbStats = fs.statSync(dbPath);
    const dbSizeMB = (dbStats.size / (1024 * 1024)).toFixed(2);
    console.log(`📦 Database Size: ${dbSizeMB} MB`);

    // Get last modified time
    const dbMtime = dbStats.mtime.toISOString();
    console.log(`🕐 Last Updated: ${dbMtime}`);

    console.log('\n📈 Statistics:');
    console.log('─'.repeat(50));
    console.log(`   🔷 Total Symbols:     ${stats.symbols}`);
    console.log(`   🔗 Total Relationships: ${stats.relationships}`);
    console.log(`   📄 Total Files:       ${stats.files}`);

    if (stats.languages.length > 0) {
      console.log(`\n🌐 Languages:`);
      for (const lang of stats.languages) {
        console.log(`   • ${lang}`);
      }
    }

    // Show relationship types
    if (stats.relationships > 0) {
      console.log('\n🔗 Relationship Types:');
      const relTypes = ['calls', 'imports', 'extends', 'implements', 'contains', 'uses_type'];

      for (const type of relTypes) {
        const count = store.getRelationshipsByKind(type);
        if (count > 0) {
          console.log(`   • ${type}: ${count}`);
        }
      }
    }

    console.log('\n' + '═'.repeat(50));

  } finally {
    store.close();
  }
}

// Helper function to get relationship counts by kind
// This needs to be added to SQLiteStore or we query directly
