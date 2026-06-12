// ============================================================
// Agent Runtime - Graph-driven AI coding agent (v2)
// ============================================================
// The "operating system" for AI coding agents.
// Key improvements over v1:
// - Task decomposition into subtasks
// - Tool orchestration (agent calls other analyzers)
// - Iterative refinement loop (generate → verify → fix)
// - Smart context budget allocation
// - Execution memory (tracks what worked)

import { SQLiteStore } from '../store/sqlite-store.js';
import { ContextBuilder } from './context-builder.js';
import { ImpactAnalyzer } from './impact-analyzer.js';
import { GuardAnalyzer } from './guard-analyzer.js';
import { ReviewAnalyzer } from './review-analyzer.js';
import { DepAnalyzer } from './dep-analyzer.js';
import { PathFinder } from './path-finder.js';
import { SmellDetector } from './smell-detector.js';
import { createLLMClient, CachedLLMClient } from './llm-client.js';
import type { Symbol } from '../graph/types.js';
import type { LLMClient } from './llm-client.js';
import type { GuardResult } from './guard-analyzer.js';
import type { ReviewResult } from './review-analyzer.js';

// ========================
// Types
// ========================

export interface AgentTask {
  description: string;
  targetSymbol?: string;
  autoVerify?: boolean;
  maxIterations?: number;      // Max refinement iterations (default: 3)
  tokenBudget?: number;        // Total token budget (default: 8000)
  dryRun?: boolean;            // Plan only, don't generate code
  tools?: string[];            // Which tools to use (default: all)
  llmProvider?: 'claude' | 'openai' | 'local';
  llmModel?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
}

export interface SubTask {
  id: string;
  description: string;
  type: 'analyze' | 'generate' | 'verify' | 'fix';
  targetSymbol?: string;
  dependencies: string[];      // IDs of subtasks this depends on
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: any;
}

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  result: any;
  tokensUsed: number;
}

export interface AgentPlan {
  subtasks: SubTask[];
  affectedFiles: string[];
  impactRisk: 'low' | 'medium' | 'high' | 'critical';
  relevantSymbols: Array<{ name: string; file: string; role: string }>;
  estimatedTokens: number;
  summary: string;
}

export interface AgentResult {
  plan: AgentPlan;
  toolCalls: ToolCall[];
  generatedCode?: string;
  iterations: number;
  verification?: {
    guard: { passed: boolean; violations: string[] };
    review: { passed: boolean; findings: string[] };
    passed: boolean;
  };
  memory: AgentMemory;
  summary: string;
}

export interface AgentMemory {
  /** What was tried and what worked */
  attempts: Array<{
    iteration: number;
    action: string;
    success: boolean;
    feedback: string;
  }>;
  /** Lessons learned */
  lessons: string[];
}

// ========================
// Tool Registry
// ========================

/**
 * Registry of tools the agent can call.
 * Each tool wraps an existing analyzer.
 */
class ToolRegistry {
  private tools: Map<string, (args: any) => Promise<any>> = new Map();

  constructor(
    private store: SQLiteStore,
    private llmClient: LLMClient | null,
  ) {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // Impact analysis
    this.register('impact', async (args: { symbolId: string; depth?: number }) => {
      const analyzer = new ImpactAnalyzer(this.store);
      return analyzer.analyze(args.symbolId, args.depth ?? 3);
    });

    // Guard check
    this.register('guard', async () => {
      const analyzer = new GuardAnalyzer(this.store);
      return analyzer.check();
    });

    // Dependency health
    this.register('deps', async () => {
      const analyzer = new DepAnalyzer(this.store, process.cwd());
      return analyzer.analyze();
    });

    // Path finding
    this.register('path', async (args: { source: string; target: string }) => {
      const finder = new PathFinder(this.store);
      return finder.find(args.source, args.target);
    });

    // Smell detection
    this.register('smells', async (args?: { type?: string }) => {
      const detector = new SmellDetector(this.store);
      return args?.type ? detector.detectType(args.type as any) : detector.detect();
    });

    // Symbol lookup
    this.register('lookup', async (args: { name: string }) => {
      const results = this.store.searchSymbols(args.name, { limit: 10 });
      return results.map(s => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        file: s.filePath,
        line: s.startLine,
        layer: s.layer,
        complexity: s.complexity,
      }));
    });

    // Callers/callees
    this.register('callers', async (args: { symbolId: string }) => {
      return this.store.getCallers(args.symbolId).map(s => ({
        name: s.name, kind: s.kind, file: s.filePath, line: s.startLine,
      }));
    });

    this.register('callees', async (args: { symbolId: string }) => {
      return this.store.getCallees(args.symbolId).map(s => ({
        name: s.name, kind: s.kind, file: s.filePath, line: s.startLine,
      }));
    });

    // Review (if LLM available)
    if (this.llmClient) {
      this.register('review', async (args: { files: string[] }) => {
        const analyzer = new ReviewAnalyzer(this.store, { smart: true });
        return analyzer.review(args.files);
      });
    }
  }

  register(name: string, handler: (args: any) => Promise<any>): void {
    this.tools.set(name, handler);
  }

  async call(name: string, args: Record<string, any>): Promise<any> {
    const handler = this.tools.get(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return handler(args);
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

// ========================
// Agent Runtime
// ========================

/**
 * Graph-driven AI coding agent (v2).
 *
 * Enhanced workflow:
 * 1. Decompose task → break into subtasks
 * 2. Query graph → find relevant symbols, dependencies, impact
 * 3. Build context → minimal token usage via ContextBuilder
 * 4. Generate plan → ordered subtasks with dependencies
 * 5. Execute subtasks → each subtask uses appropriate tools
 * 6. Iterate → if verification fails, fix and retry
 * 7. Memory → track what worked for future improvement
 */
export class AgentRuntime {
  private store: SQLiteStore;
  private contextBuilder: ContextBuilder;
  private impactAnalyzer: ImpactAnalyzer;
  private tools: ToolRegistry;
  private llmClient: LLMClient | null;

  constructor(store: SQLiteStore, options?: {
    llmProvider?: 'claude' | 'openai' | 'local';
    llmModel?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
  }) {
    this.store = store;
    this.contextBuilder = new ContextBuilder(store);
    this.impactAnalyzer = new ImpactAnalyzer(store);

    if (options?.llmProvider) {
      const client = createLLMClient({
        provider: options.llmProvider,
        model: options.llmModel,
        apiKey: options.llmApiKey,
        baseUrl: options.llmBaseUrl,
      });
      this.llmClient = client ? new CachedLLMClient(client) : null;
    } else {
      this.llmClient = null;
    }

    this.tools = new ToolRegistry(store, this.llmClient);
  }

  /**
   * Execute a coding task with iterative refinement.
   */
  async execute(task: AgentTask): Promise<AgentResult> {
    const allToolCalls: ToolCall[] = [];
    const memory: AgentMemory = { attempts: [], lessons: [] };
    let generatedCode: string | undefined;
    let verification: AgentResult['verification'];
    let iteration = 0;
    const maxIterations = task.maxIterations ?? 3;

    // Step 1: Decompose and plan
    const plan = await this.decomposeAndPlan(task);

    if (task.dryRun) {
      return {
        plan,
        toolCalls: allToolCalls,
        iterations: 0,
        memory,
        summary: plan.summary,
      };
    }

    // Step 2: Execute with iterative refinement
    while (iteration < maxIterations) {
      iteration++;

      // Generate code
      if (this.llmClient) {
        const codeResult = await this.executeSubtask({
          id: `generate-${iteration}`,
          description: 'Generate code',
          type: 'generate',
          dependencies: [],
          status: 'pending',
        }, task, plan);
        generatedCode = codeResult.code;
        allToolCalls.push(...codeResult.toolCalls);
      }

      // Verify
      if (task.autoVerify !== false) {
        const verifyResult = await this.executeSubtask({
          id: `verify-${iteration}`,
          description: 'Verify code',
          type: 'verify',
          dependencies: [],
          status: 'pending',
        }, task, plan);
        verification = verifyResult.verification;
        allToolCalls.push(...verifyResult.toolCalls);

        memory.attempts.push({
          iteration,
          action: 'generate+verify',
          success: verification?.passed ?? false,
          feedback: verification?.passed
            ? 'All checks passed'
            : `Issues: ${[...(verification?.guard.violations ?? []), ...(verification?.review.findings ?? [])].join('; ')}`,
        });

        if (verification?.passed) {
          memory.lessons.push(`Iteration ${iteration}: Success`);
          break;
        }

        memory.lessons.push(`Iteration ${iteration}: Failed - ${verification?.guard.violations.length ?? 0} guard violations, ${verification?.review.findings.length ?? 0} review findings`);
      } else {
        break; // No verification, done after generation
      }
    }

    const summary = this.buildSummary(plan, generatedCode, verification, allToolCalls, memory, iteration);

    return {
      plan,
      toolCalls: allToolCalls,
      generatedCode,
      iterations: iteration,
      verification,
      memory,
      summary,
    };
  }

  /**
   * Just generate a plan without executing.
   */
  async plan(task: AgentTask): Promise<AgentPlan> {
    return this.decomposeAndPlan(task);
  }

  // ========================
  // Task Decomposition
  // ========================

  private async decomposeAndPlan(task: AgentTask): Promise<AgentPlan> {
    const relevantSymbols = await this.analyzeTask(task);
    const subtasks = this.decomposeTask(task, relevantSymbols);
    const affectedFiles = this.computeAffectedFiles(relevantSymbols);
    const impactRisk = this.assessRisk(affectedFiles.length);
    const estimatedTokens = this.estimateTokens(relevantSymbols);

    const relevantSymbolsInfo = relevantSymbols.map(rs => ({
      name: rs.symbol.name,
      file: rs.symbol.filePath,
      role: rs.role,
    }));

    const summary = this.buildPlanSummary(subtasks, affectedFiles.length, impactRisk, relevantSymbols.length, this.tools.listTools());

    return {
      subtasks,
      affectedFiles,
      impactRisk,
      relevantSymbols: relevantSymbolsInfo,
      estimatedTokens,
      summary,
    };
  }

  private decomposeTask(task: AgentTask, symbols: RelevantSymbol[]): SubTask[] {
    const subtasks: SubTask[] = [];
    let id = 0;

    // Phase 1: Analyze
    subtasks.push({
      id: `analyze-${id++}`,
      description: `Analyze task: ${task.description}`,
      type: 'analyze',
      targetSymbol: task.targetSymbol,
      dependencies: [],
      status: 'pending',
    });

    // Phase 2: Impact check for each relevant symbol
    for (const rs of symbols.slice(0, 3)) {
      subtasks.push({
        id: `impact-${id++}`,
        description: `Check impact of ${rs.symbol.name}`,
        type: 'analyze',
        targetSymbol: rs.symbol.id,
        dependencies: [`analyze-0`],
        status: 'pending',
      });
    }

    // Phase 3: Dependency check
    subtasks.push({
      id: `deps-${id++}`,
      description: 'Check dependency health',
      type: 'analyze',
      dependencies: [],
      status: 'pending',
    });

    // Phase 4: Generate
    subtasks.push({
      id: `generate-${id++}`,
      description: 'Generate code',
      type: 'generate',
      dependencies: subtasks.filter(s => s.type === 'analyze').map(s => s.id),
      status: 'pending',
    });

    // Phase 5: Verify
    subtasks.push({
      id: `verify-${id++}`,
      description: 'Verify with guard + review',
      type: 'verify',
      dependencies: [`generate-${id - 1}`],
      status: 'pending',
    });

    return subtasks;
  }

  // ========================
  // Task Analysis
  // ========================

  private async analyzeTask(task: AgentTask): Promise<RelevantSymbol[]> {
    const results: RelevantSymbol[] = [];
    const seen = new Set<string>();

    // Target symbol
    if (task.targetSymbol) {
      const symbol = this.resolveSymbol(task.targetSymbol);
      if (symbol) {
        results.push({ symbol, role: 'target', relevance: 10 });
        seen.add(symbol.id);
        this.expandNeighbors(symbol, results, seen);
      }
    }

    // Keyword search
    const keywords = task.description.split(/\s+/).filter(w => w.length > 2);
    for (const keyword of keywords) {
      const matches = this.store.searchSymbols(keyword, { limit: 5 });
      for (const m of matches) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          results.push({ symbol: m, role: 'keyword-match', relevance: 5 });
        }
      }
    }

    // LLM-assisted selection
    if (this.llmClient && results.length < 3) {
      const allSymbols = this.store.searchSymbols('', { limit: 200 });
      const prompt = `Task: "${task.description}"

Which symbols are most relevant? Return top 5 names, one per line:
${allSymbols.map(s => `- ${s.name} (${s.kind}) @ ${s.filePath}`).join('\n')}`;

      try {
        const response = await this.llmClient.complete(prompt);
        const names = response.split('\n').map(l => l.trim().replace(/^- /, '')).filter(Boolean);
        for (const name of names) {
          const sym = allSymbols.find(s => s.name === name);
          if (sym && !seen.has(sym.id)) {
            seen.add(sym.id);
            results.push({ symbol: sym, role: 'llm-selected', relevance: 6 });
          }
        }
      } catch { /* continue */ }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, 20);
  }

  private expandNeighbors(symbol: Symbol, results: RelevantSymbol[], seen: Set<string>): void {
    const callers = this.store.getCallers(symbol.id);
    const callees = this.store.getCallees(symbol.id);

    for (const c of callers) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        results.push({ symbol: c, role: 'caller', relevance: 8 });
      }
    }
    for (const c of callees) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        results.push({ symbol: c, role: 'callee', relevance: 7 });
      }
    }
  }

  // ========================
  // Subtask Execution
  // ========================

  private async executeSubtask(
    subtask: SubTask,
    task: AgentTask,
    plan: AgentPlan,
  ): Promise<{ code?: string; verification?: AgentResult['verification']; toolCalls: ToolCall[] }> {
    const toolCalls: ToolCall[] = [];

    switch (subtask.type) {
      case 'generate': {
        const code = await this.generateCode(plan, task, toolCalls);
        return { code, toolCalls };
      }

      case 'verify': {
        const verification = await this.verify(plan, task, toolCalls);
        return { verification, toolCalls };
      }

      default:
        return { toolCalls };
    }
  }

  // ========================
  // Code Generation
  // ========================

  private async generateCode(
    plan: AgentPlan,
    task: AgentTask,
    toolCalls: ToolCall[],
  ): Promise<string> {
    if (!this.llmClient) return '';

    // Build context from relevant symbols
    const symbols: Symbol[] = [];
    for (const rs of plan.relevantSymbols.slice(0, 10)) {
      const sym = this.store.getSymbolsByFile(rs.file).find(s => s.name === rs.name);
      if (sym) symbols.push(sym);
    }

    const context = this.contextBuilder.buildReviewContext(symbols, {
      maxTokens: Math.floor((task.tokenBudget ?? 8000) * 0.6), // 60% for context
      includeSource: 'full',
      includeCallers: true,
      includeCallees: true,
      includeStaticFindings: false,
    });

    // Gather insights from tool calls
    const insights = toolCalls
      .filter(tc => tc.result?.summary || tc.result?.passed !== undefined)
      .map(tc => {
        if (tc.tool === 'impact') return `Impact: ${tc.result.risk} risk, ${tc.result.direct?.length ?? 0} direct effects`;
        if (tc.tool === 'guard') return `Guard: ${tc.result.passed ? 'passed' : `${tc.result.violations?.length ?? 0} violations`}`;
        if (tc.tool === 'deps') return `Deps: score ${tc.result.score}/100, ${tc.result.circular?.length ?? 0} circular`;
        return '';
      })
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are an expert developer. Generate code that:
1. Follows the project's existing patterns and conventions
2. Fits the architectural layer structure
3. Maintains backward compatibility
4. Includes proper error handling
5. Is well-documented

Respond with ONLY the generated code, no explanations.`;

    const userPrompt = `## Task
${task.description}

## Plan
${plan.subtasks.filter(s => s.type === 'generate' || s.type === 'analyze').map(s => `- ${s.description}`).join('\n')}

## Insights from Analysis
${insights || 'No prior analysis available'}

## Relevant Code Context
${context.codeContext}

Generate the code changes needed to complete this task.`;

    try {
      const startTokens = context.tokenEstimate;
      let response: string;
      if (this.llmClient.completeWithSystem) {
        response = await this.llmClient.completeWithSystem(systemPrompt, userPrompt);
      } else {
        response = await this.llmClient.complete(`${systemPrompt}\n\n${userPrompt}`);
      }
      toolCalls.push({ tool: 'generate', args: {}, result: { tokens: startTokens }, tokensUsed: startTokens });
      return response;
    } catch (err) {
      return `// Code generation failed: ${err}`;
    }
  }

  // ========================
  // Verification
  // ========================

  private async verify(
    plan: AgentPlan,
    task: AgentTask,
    toolCalls: ToolCall[],
  ): Promise<AgentResult['verification']> {
    const violations: string[] = [];
    const findings: string[] = [];

    // Tool call: guard
    try {
      const guardResult = await this.tools.call('guard', {});
      toolCalls.push({ tool: 'guard', args: {}, result: guardResult, tokensUsed: 0 });
      if (!guardResult.passed) {
        for (const v of (guardResult.violations ?? []).filter((v: any) => v.severity === 'error')) {
          violations.push(v.message);
        }
      }
    } catch { /* continue */ }

    // Tool call: review
    if (this.llmClient) {
      try {
        const reviewResult = await this.tools.call('review', { files: plan.affectedFiles });
        toolCalls.push({ tool: 'review', args: { files: plan.affectedFiles }, result: reviewResult, tokensUsed: 0 });
        for (const f of (reviewResult.findings ?? []).filter((f: any) => f.severity === 'error')) {
          findings.push(`${f.symbolName}: ${f.description}`);
        }
      } catch { /* continue */ }
    }

    const passed = violations.length === 0 && findings.length === 0;

    return {
      guard: { passed: violations.length === 0, violations },
      review: { passed: findings.length === 0, findings },
      passed,
    };
  }

  // ========================
  // Helpers
  // ========================

  private resolveSymbol(nameOrId: string): Symbol | undefined {
    let sym = this.store.getSymbol(nameOrId);
    if (sym) return sym;
    const results = this.store.searchSymbols(nameOrId, { limit: 5 });
    if (results.length === 1) return results[0];
    if (results.length > 1) {
      const exact = results.find(s => s.name === nameOrId);
      return exact || results[0];
    }
    return undefined;
  }

  private computeAffectedFiles(symbols: RelevantSymbol[]): string[] {
    const files = new Set<string>();
    for (const rs of symbols) {
      files.add(rs.symbol.filePath);
      const impact = this.impactAnalyzer.analyze(rs.symbol.id, 2);
      if (impact) {
        for (const f of impact.affectedFiles) files.add(f);
      }
    }
    return Array.from(files);
  }

  private assessRisk(fileCount: number): AgentPlan['impactRisk'] {
    if (fileCount <= 2) return 'low';
    if (fileCount <= 5) return 'medium';
    if (fileCount <= 10) return 'high';
    return 'critical';
  }

  private estimateTokens(symbols: RelevantSymbol[]): number {
    return symbols.reduce((sum, s) => {
      return sum + (s.symbol.sourceCode?.split('\n').length ?? 10) * 3;
    }, 0);
  }

  private buildPlanSummary(
    subtasks: SubTask[],
    fileCount: number,
    risk: string,
    symbolCount: number,
    tools: string[],
  ): string {
    const parts: string[] = [];
    parts.push(`📋 Execution Plan`);
    parts.push(`═══════════════════════════════════════`);
    parts.push(`Symbols: ${symbolCount} | Files: ${fileCount} | Risk: ${risk}`);
    parts.push(`Subtasks: ${subtasks.length} | Tools: ${tools.length}`);
    parts.push('');
    parts.push(`Available tools: ${tools.join(', ')}`);
    parts.push('');

    for (let i = 0; i < subtasks.length; i++) {
      const st = subtasks[i];
      const icon = st.type === 'analyze' ? '🔍' : st.type === 'generate' ? '💻' : st.type === 'verify' ? '✅' : '🔧';
      parts.push(`${i + 1}. ${icon} [${st.type}] ${st.description}`);
    }

    return parts.join('\n');
  }

  private buildSummary(
    plan: AgentPlan,
    generatedCode?: string,
    verification?: AgentResult['verification'],
    toolCalls?: ToolCall[],
    memory?: AgentMemory,
    iterations?: number,
  ): string {
    const parts: string[] = [];

    parts.push(plan.summary);
    parts.push('');
    parts.push(`🔄 Iterations: ${iterations ?? 0}`);

    // Tool usage summary
    if (toolCalls && toolCalls.length > 0) {
      parts.push('');
      parts.push(`🛠️  Tools used: ${[...new Set(toolCalls.map(tc => tc.tool))].join(', ')}`);
    }

    if (generatedCode) {
      parts.push('');
      parts.push(`💻 Generated Code (${generatedCode.split('\n').length} lines):`);
      parts.push('```');
      parts.push(generatedCode.slice(0, 3000));
      if (generatedCode.length > 3000) parts.push('// ... truncated');
      parts.push('```');
    }

    if (verification) {
      parts.push('');
      parts.push(`✅ Verification:`);
      parts.push(`  Guard: ${verification.guard.passed ? 'PASSED' : 'FAILED'}`);
      parts.push(`  Review: ${verification.review.passed ? 'PASSED' : 'FAILED'}`);
      parts.push(`  Overall: ${verification.passed ? '✅ ALL PASSED' : '❌ ISSUES FOUND'}`);

      if (!verification.guard.passed) {
        for (const v of verification.guard.violations) parts.push(`    ⚠️ ${v}`);
      }
      if (!verification.review.passed) {
        for (const f of verification.review.findings) parts.push(`    ⚠️ ${f}`);
      }
    }

    if (memory && memory.attempts.length > 0) {
      parts.push('');
      parts.push(`📝 Memory:`);
      for (const a of memory.attempts) {
        parts.push(`  Iter ${a.iteration}: ${a.success ? '✅' : '❌'} ${a.feedback}`);
      }
    }

    return parts.join('\n');
  }
}

// ========================
// Internal Types
// ========================

interface RelevantSymbol {
  symbol: Symbol;
  role: 'target' | 'caller' | 'callee' | 'keyword-match' | 'llm-selected';
  relevance: number;
}
