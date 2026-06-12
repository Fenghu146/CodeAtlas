// ============================================================
// ask command - Natural language code Q&A via Graph Copilot
// ============================================================

import path from 'path';
import { SQLiteStore, GraphCopilot } from '@codeatlas/core';

export async function askCommand(
  question: string,
  options: { format?: string; mode?: 'quick' | 'deep'; session?: string } = {},
) {
  const store = await SQLiteStore.create({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const copilot = new GraphCopilot(store, process.cwd());
    const result = await copilot.ask(question, {
      mode: options.mode ?? 'quick',
      sessionId: options.session ?? 'default',
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\n❓ Question: ${question}\n`);
    console.log('📖 Answer:');
    console.log('─'.repeat(50));
    console.log(result.answer);
    console.log('─'.repeat(50));

    if (result.symbols.length > 0) {
      console.log(`\n📎 Referenced symbols (${result.symbols.length}):`);
      for (const symbol of result.symbols.slice(0, 5)) {
        console.log(`   - ${symbol.name} (${symbol.kind}) @ ${symbol.file}:${symbol.id}`);
      }
    }

    const confidence = Math.round(result.confidence * 100);
    console.log(`\n🎯 Intent: ${result.intent} | Confidence: ${confidence}% | ⏱️ ${result.duration}ms`);
    if (confidence < 50) {
      console.log('   (Low confidence - try rephrasing or be more specific)');
    }
    console.log();
  } finally {
    store.close();
  }
}
