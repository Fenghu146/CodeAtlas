// ============================================================
// semantic command - Semantic search with embeddings
// ============================================================

import path from 'path';
import { SQLiteStore, VectorStore, HybridSearch, createEmbeddingGenerator } from '@codeatlas/core';

export async function semanticCommand(
  subcommand: string,
  query: string,
  options: { format?: string; top?: string; provider?: string },
) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const generator = createEmbeddingGenerator({
      provider: (options.provider as any) || 'local',
    });
    const vectorStore = new VectorStore(store, generator);

    switch (subcommand) {
      case 'index':
        await indexSymbols(vectorStore, options);
        break;
      case 'search':
        await searchSymbols(vectorStore, query, options);
        break;
      case 'stats':
        await showStats(vectorStore);
        break;
      default:
        console.log(`Unknown subcommand: ${subcommand}`);
        console.log('Available: index, search, stats');
    }
  } finally {
    store.close();
  }
}

async function indexSymbols(vectorStore: VectorStore, options: { format?: string }) {
  console.log('\n🔄 Indexing symbols for semantic search...\n');

  const indexed = await vectorStore.indexAll((current, total) => {
    const pct = Math.round((current / total) * 100);
    process.stdout.write(`\r  Progress: [${current}/${total}] (${pct}%)`);
  });

  console.log(`\n\n✅ Indexed ${indexed} symbols`);
}

async function searchSymbols(
  vectorStore: VectorStore,
  query: string,
  options: { format?: string; top?: string },
) {
  const topK = parseInt(options.top || '10');

  // Load embeddings from database
  vectorStore.loadEmbeddings();

  const stats = vectorStore.getStats();
  if (stats.indexed === 0) {
    console.log(`\n❌ No embeddings indexed. Run: semantic index`);
    return;
  }

  // Use hybrid search (keyword + vector + graph)
  const hybridSearch = new HybridSearch(
    // @ts-ignore - store has the methods we need
    vectorStore['store'],
    vectorStore,
  );

  const results = await hybridSearch.search(query, { topK });

  if (results.length === 0) {
    console.log(`\n❌ No results found for "${query}"`);
    console.log('  Try: semantic index (to build embeddings first)');
    return;
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\n🔍 Semantic Search: "${query}"\n`);
  console.log(`Found ${results.length} results:\n`);

  for (const r of results.slice(0, topK)) {
    const scoreStr = (r.combinedScore * 100).toFixed(1);
    const reasons = r.reasons.join(', ');
    console.log(`  [${scoreStr}%] ${r.symbol.name} (${r.symbol.kind})`);
    console.log(`        @ ${r.symbol.filePath}:${r.symbol.startLine}`);
    console.log(`        Score: kw=${r.keywordScore.toFixed(2)} vec=${r.vectorScore.toFixed(2)} graph=${r.graphScore.toFixed(2)}`);
    console.log(`        Reasons: ${reasons}`);
    console.log('');
  }
}

async function showStats(vectorStore: VectorStore) {
  const stats = vectorStore.getStats();
  console.log(`\n📊 Vector Store Stats`);
  console.log('═'.repeat(40));
  console.log(`Indexed: ${stats.indexed} symbols`);
  console.log(`Dimension: ${stats.dimension}`);
}
