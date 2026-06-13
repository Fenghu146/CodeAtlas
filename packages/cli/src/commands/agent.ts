// ============================================================
// agent command - AI Agent Runtime (v2)
// ============================================================

import path from 'path';
import { SQLiteStore, AgentRuntime, loadConfig, getAIConfig } from '@codeatlas/core';

export async function agentCommand(
  description: string,
  options: {
    target?: string;
    noVerify?: boolean;
    budget?: string;
    maxIterations?: string;
    dryRun?: boolean;
    format?: string;
  },
) {
  const store = new SQLiteStore({
    dbPath: path.join(process.cwd(), '.codeatlas', 'db.sqlite'),
  });

  try {
    const config = loadConfig(process.cwd());
    const aiConfig = getAIConfig(config);

    if (!aiConfig.provider && !options.dryRun) {
      console.log('\n❌ AI not configured');
      console.log('  Set ANTHROPIC_API_KEY or OPENAI_API_KEY');
      console.log('  Or use --dry-run for plan-only mode');
      return;
    }

    console.log(`\n🤖 Agent Runtime v2`);
    console.log('═'.repeat(50));
    console.log(`Task: ${description}`);
    if (options.dryRun) console.log(`Mode: DRY RUN (plan only)`);
    console.log(`Provider: ${aiConfig.provider || 'none (plan-only)'}`);
    console.log('');

    const runtime = new AgentRuntime(store, {
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    const result = await runtime.execute({
      description,
      targetSymbol: options.target,
      autoVerify: !options.noVerify,
      maxIterations: options.maxIterations ? parseInt(options.maxIterations) : undefined,
      tokenBudget: options.budget ? parseInt(options.budget) : undefined,
      dryRun: options.dryRun,
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.summary);
    }

  } finally {
    store.close();
  }
}
