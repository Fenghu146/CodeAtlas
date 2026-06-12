// ============================================================
// ask command - Natural language code Q&A
// ============================================================

import path from 'path';
import { SQLiteStore, AskAnalyzer, loadConfig, getAIConfig, ModuleExplainer } from '@codeatlas/core';

export async function askCommand(question: string) {
  const store = await SQLiteStore.create({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    console.log(`\n❓ Question: ${question}\n`);

    // Try to load AI config for better answers
    let explainer: ModuleExplainer | undefined;
    try {
      const config = loadConfig(process.cwd());
      const aiConfig = getAIConfig(config);
      if (aiConfig.provider) {
        explainer = new ModuleExplainer({
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
          baseUrl: aiConfig.baseUrl,
        });
      }
    } catch {
      // No AI config, use structured answers
    }

    const analyzer = new AskAnalyzer(store, explainer);
    const result = await analyzer.answer(question);

    // Display results
    console.log('📖 Answer:');
    console.log('─'.repeat(50));
    console.log(result.answer);
    console.log('─'.repeat(50));

    // Show relevant symbols
    if (result.symbols.length > 0) {
      console.log(`\n📎 Referenced symbols (${result.symbols.length}):`);
      for (const symbol of result.symbols.slice(0, 5)) {
        console.log(`   - ${symbol.name} (${symbol.kind}) @ ${symbol.filePath}:${symbol.startLine}`);
      }
    }

    // Show confidence
    const confidence = Math.round(result.confidence * 100);
    console.log(`\n🎯 Confidence: ${confidence}%`);

    if (confidence < 50) {
      console.log('   (Low confidence - try rephrasing or be more specific)');
    }
    console.log();
  } finally {
    store.close();
  }
}
