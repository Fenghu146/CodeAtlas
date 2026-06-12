// ============================================================
// foam command - Export code graph as Foam-compatible markdown
// ============================================================
// Generates Foam-friendly markdown files that can be visualized
// using the Foam VSCode extension.
//
// Usage:
//   codeatlas foam                  # Export to .codeatlas/foam/
//   codeatlas foam --open           # Export and open in Foam
//   codeatlas foam --output ./docs  # Export to custom directory

import path from 'path';
import { SQLiteStore, FoamExporter } from '@codeatlas/core';

export async function foamCommand(options: {
  output?: string;
  open?: boolean;
  source?: boolean;
}) {
  const projectPath = process.cwd();
  const store = await SQLiteStore.create({
    dbPath: path.join(projectPath, '.codeatlas', 'db.sqlite'),
  });

  // Check if graph exists
  const stats = store.getStats();
  if (stats.symbols === 0) {
    console.log('\n❌ No code graph found. Run `codeatlas scan` first.\n');
    return;
  }

  const outputDir = options.output
    ? path.resolve(options.output)
    : path.join(projectPath, '.codeatlas', 'foam');

  console.log(`\n🧪 CodeAtlas → Foam Export`);
  console.log(`📁 Project: ${projectPath}`);
  console.log(`📤 Output: ${outputDir}\n`);

  const exporter = new FoamExporter(store);

  try {
    const result = await exporter.export({
      projectPath,
      outputDir,
      includeSource: options.source !== false,
      includeAISummary: true,
      onProgress: (current, total, label) => {
        process.stdout.write(`\r  Generating [${current}] ${label.padEnd(60)}`);
      },
    });

    console.log(`\n\n✅ Export complete!`);
    console.log(`   📄 Files generated: ${result.filesGenerated}`);
    console.log(`   📁 Output: ${result.outputDir}\n`);

    // Show usage instructions
    console.log('📖 How to view the graph in VSCode:\n');
    console.log('   Option 1 — Open Foam folder:');
    console.log(`     code ${result.outputDir}`);
    console.log('     Then: Cmd+Shift+P → "Foam: Show Graph"\n');
    console.log('   Option 2 — Add to existing workspace:');
    console.log('     Add this folder to your VSCode workspace,');
    console.log('     then open Foam graph view.\n');
    console.log('   The graph will show:');
    console.log('     🔵 Blue nodes = Interface layer (controllers, routes, views)');
    console.log('     🟢 Green nodes = Business layer (services, domain logic)');
    console.log('     🟠 Orange nodes = Data layer (repositories, models, DB)');
    console.log('     ⚪ Gray nodes = Utility layer (helpers, utils, config)');
    console.log('     🟡 Yellow = Index/dashboard');
    console.log('     🟣 Purple = Module (directory-level)\n');

    if (options.open) {
      // Try to open the Foam folder in VSCode
      const { exec } = await import('child_process');
      exec(`code "${result.outputDir}"`, (err) => {
        if (err) {
          console.log('   ⚠ Could not auto-open VSCode. Open the folder manually.');
        }
      });
    }
  } catch (err) {
    console.error('❌ Export failed:', err);
    process.exit(1);
  } finally {
    store.close();
  }
}
