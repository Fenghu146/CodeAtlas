#!/usr/bin/env node
// ============================================================
// CodeAtlas MCP Server
// ============================================================
// Exposes the code graph as MCP tools for AI coding assistants.
// Supports: Claude Code, Cursor, QoderWork, and any MCP client.
//
// Usage:
//   codeatlas-mcp --project /path/to/project
//
// Or configure in your MCP client config:
//   { "mcpServers": { "codeatlas": { "command": "codeatlas-mcp", "args": ["--project", "/path"] } } }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SQLiteStore, ProjectScanner, ImpactAnalyzer, FoamExporter, ModuleExplainer, FileWatcher, loadConfig, getAIConfig, DepAnalyzer, ReviewAnalyzer, GuardAnalyzer, ContextBuilder, PathFinder, AgentRuntime, RefactorEngine, GraphExporter, DiffAnalyzer, TraceReader, TraceAnalyzer, TraceAgent, EmbeddedAnalyzer, BuildAnalyzer, EmbeddedLinuxAnalyzer, VectorStore, HybridSearch, createEmbeddingGenerator, AgentOrchestrator, GraphCopilot } from '@codeatlas/core';
import path from 'path';
import fs from 'fs';

// Parse CLI arguments
const args = process.argv.slice(2);
let projectPath = process.cwd();
const projectIdx = args.indexOf('--project');
if (projectIdx !== -1 && args[projectIdx + 1]) {
  const rawPath = args[projectIdx + 1];
  // Handle relative paths: if not absolute, try to resolve from CWD
  // Also check if the path exists, and if not, search parent directories
  let resolved = path.resolve(rawPath);

  // If the resolved path doesn't exist, try to find it by searching parents
  if (!fs.existsSync(resolved)) {
    let searchPath = resolved;
    for (let i = 0; i < 5; i++) {
      const parent = path.dirname(searchPath);
      if (parent === searchPath) break;
      if (fs.existsSync(parent)) {
        resolved = parent;
        break;
      }
      searchPath = parent;
    }
  }

  projectPath = resolved;
}

// Check for watch mode
const watchMode = args.includes('--watch');

// Shared state for the active project (may be changed by codeatlas_set_project)
let lastScannedPath = projectPath;
let store: SQLiteStore;
let scanner: ProjectScanner;
let watcher: FileWatcher | null = null;
let sharedExplainer: ModuleExplainer | null = null;
let sharedCopilot: GraphCopilot | null = null;

/**
 * Initialize or switch to a project at the given path.
 * Can be called multiple times to switch between projects.
 */
async function initForProject(newPath: string): Promise<string> {
  const dbDir = path.join(path.resolve(newPath), '.codeatlas');
  fs.mkdirSync(dbDir, { recursive: true });

  // Close previous store and watcher
  if (store) {
    if (watcher) { await watcher.stop(); watcher = null; }
    store.close();
  }

  const dbPath = path.join(dbDir, 'db.sqlite');
  store = new SQLiteStore({ dbPath });
  scanner = new ProjectScanner(store);
  sharedCopilot = new GraphCopilot(store, newPath);
  projectPath = newPath;
  lastScannedPath = newPath;

  // Reinitialize shared LLM client for the new project
  const config = loadConfig(newPath);
  const aiConfig = getAIConfig(config);
  sharedExplainer = aiConfig.provider ? new ModuleExplainer({
    provider: aiConfig.provider,
    model: aiConfig.model,
    apiKey: aiConfig.apiKey,
    baseUrl: aiConfig.baseUrl,
  }, store) : null;

  // Start file watcher if --watch flag was given
  if (watchMode) {
    watcher = new FileWatcher(newPath, scanner);
    await watcher.start();
    watcher.on('update', (result: any) => {
      console.error(JSON.stringify({ type: 'graph_update', filesScanned: result.filesScanned, symbolsFound: result.symbolsFound, relationshipsFound: result.relationshipsFound, duration: result.duration }));
    });
    watcher.on('scanStart', (changes: any[]) => {
      console.error(JSON.stringify({ type: 'scan_start', filesChanged: changes.length }));
    });
    watcher.on('error', (err: Error) => {
      console.error(JSON.stringify({ type: 'watch_error', message: err.message }));
    });
  }

  // Return summary
  const stats = store.getStats();
  return `✅ Switched to project: ${newPath}\n   Symbols: ${stats.symbols} | Files: ${stats.files} | Relationships: ${stats.relationships}`;
}

/** Wrapper for initial startup */
async function initStore() {
  return initForProject(projectPath);
}

// Create MCP Server
const server = new McpServer({
  name: 'codeatlas',
  version: '0.1.0',
});

// ============================================================
// Helper: Get comprehensive context for a symbol
// ============================================================
function getSymbolContext(symbolName: string, maxTokens: number = 3000) {
  // Find symbol with fuzzy matching
  let symbol = store.getSymbol(symbolName);
  if (!symbol) {
    const forwardId = symbolName.replace(/\\/g, '/');
    symbol = store.getSymbol(forwardId);
  }
  if (!symbol) {
    const backslashId = symbolName.replace(/\//g, '\\');
    symbol = store.getSymbol(backslashId);
  }
  if (!symbol) {
    const results = store.searchSymbols(symbolName, { limit: 5 });
    if (results.length === 1) {
      symbol = results[0];
    } else if (results.length > 1) {
      symbol = results.find(s => s.name === symbolName) || results[0];
    }
  }

  if (!symbol) {
    return { content: [{ type: 'text' as const, text: `Symbol "${symbolName}" not found.` }] };
  }

  // Build comprehensive context
  const parts: string[] = [];
  parts.push(`## ${symbol.name} (${symbol.kind})`);
  parts.push(`File: ${symbol.filePath}:${symbol.startLine}-${symbol.endLine}`);
  parts.push(`Layer: ${symbol.layer} | Complexity: ${symbol.complexity ?? 'N/A'} | Exported: ${symbol.exported}`);

  if (symbol.aiSummary) {
    parts.push(`\n**Summary:** ${symbol.aiSummary}`);
  }
  if (symbol.docComment) {
    parts.push(`\n**Doc:** ${symbol.docComment.slice(0, 300)}`);
  }

  // Callers
  const callers = store.getCallers(symbol.id);
  if (callers.length > 0) {
    parts.push(`\n**Called by (${callers.length}):**`);
    for (const c of callers.slice(0, 10)) {
      parts.push(`- ${c.name} (${c.kind}) @ ${c.filePath}:${c.startLine}`);
    }
  }

  // Callees
  const callees = store.getCallees(symbol.id);
  if (callees.length > 0) {
    parts.push(`\n**Calls (${callees.length}):**`);
    for (const c of callees.slice(0, 10)) {
      parts.push(`- ${c.name} (${c.kind}) @ ${c.filePath}:${c.startLine}`);
    }
  }

  // Same-file symbols
  const fileSymbols = store.getSymbolsByFile(symbol.filePath);
  const otherSymbols = fileSymbols.filter(s => s.id !== symbol.id);
  if (otherSymbols.length > 0) {
    parts.push(`\n**Other symbols in same file (${otherSymbols.length}):**`);
    for (const s of otherSymbols.slice(0, 10)) {
      parts.push(`- ${s.name} (${s.kind}) @ line ${s.startLine}`);
    }
  }

  // Source code preview
  if (symbol.sourceCode) {
    const lines = symbol.sourceCode.split('\n').slice(0, 30);
    parts.push(`\n**Source Code (${lines.length} lines shown):**`);
    parts.push('```');
    parts.push(lines.join('\n'));
    if (symbol.sourceCode.split('\n').length > 30) {
      parts.push(`// ... ${symbol.sourceCode.split('\n').length - 30} more lines`);
    }
    parts.push('```');
  }

  return {
    content: [{
      type: 'text' as const,
      text: parts.join('\n'),
    }],
  };
}

// ============================================================
// Tool: scan - Scan project and build/update the code graph
// ============================================================
server.tool(
  'codeatlas_scan',
  'Scan a project directory to build or update the code knowledge graph. Run this first before using other tools. Automatically excludes common third-party directories (lib/, .pio/, node_modules/).',
  {
    path: z.string().optional().describe('Project path (defaults to current directory)'),
    full: z.boolean().optional().default(false).describe('Force full rescan (ignore incremental detection)'),
    exclude: z.array(z.string()).optional().describe('Additional directories to exclude (e.g., ["lib", "vendor"])'),
    profile: z.enum(['default', 'embedded-mcu', 'embedded-linux']).optional().describe('Scan profile: embedded-linux includes Kconfig, DTS, Yocto, systemd files.'),
  },
  { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  async ({ path: scanPath, full, exclude, profile }) => {
    const target = scanPath ? path.resolve(scanPath) : projectPath;
    try {
      const result = await scanner.scan({
        projectPath: target,
        full,
        exclude,
      });
      // Track last scanned path for other tools
      lastScannedPath = target;
      return {
        content: [{
          type: 'text' as const,
          text: `✅ Scan complete!\n- Files scanned: ${result.filesScanned}\n- Files skipped: ${result.filesSkipped}\n- Symbols found: ${result.symbolsFound}\n- Relationships: ${result.relationshipsFound}\n- Languages: ${result.languages.join(', ')}\n- Duration: ${result.duration}ms`,
        }],
      };
    } catch (err: any) {
      return {
        content: [{
          type: 'text' as const,
          text: `❌ Scan failed: ${err.message}\n\nTips:\n- Try excluding large directories: codeatlas_scan({ exclude: ["lib", "vendor"] })\n- Check if the project path is correct\n- Ensure the project has supported file types (.ts, .js, .py, .go, .rs, .java, .c, .cpp)`,
        }],
      };
    }
  },
);

// ============================================================
// Tool: search - Search for symbols by name or keyword
// ============================================================
server.tool(
  'codeatlas_search',
  'Search for code symbols (functions, classes, etc.) by name or keyword. Supports full-text search and fuzzy matching.',
  {
    query: z.string().describe('Search query (symbol name or keyword)'),
    kind: z.enum(['class', 'function', 'method', 'variable', 'interface', 'type', 'enum', 'module']).optional().describe('Filter by symbol kind'),
    layer: z.enum(['interface', 'business', 'data', 'utility']).optional().describe('Filter by architectural layer'),
    limit: z.number().optional().default(20).describe('Max results'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ query, kind, layer, limit }) => {
    // Try FTS search first
    let results = store.searchSymbols(query, { kind: kind as any, layer: layer as any, limit });

    // If no results, try fuzzy matching (partial name match)
    if (results.length === 0) {
      try {
        const allSymbols = store.searchSymbols('', { limit: 10000 });
        const queryLower = query.toLowerCase();
        results = allSymbols.filter(s => {
          const nameMatch = s.name.toLowerCase().includes(queryLower);
          const pathMatch = s.filePath.toLowerCase().includes(queryLower);
          const kindMatch = !kind || s.kind === kind;
          const layerMatch = !layer || s.layer === layer;
          return (nameMatch || pathMatch) && kindMatch && layerMatch;
        }).slice(0, limit);
      } catch {
        // Continue with empty results
      }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No symbols found matching "${query}".` }] };
    }
    // Compact format
    const formatted = results.map(s =>
      `${s.name} (${s.kind}) ${s.filePath}:${s.startLine}`
    ).join('\n');
    return { content: [{ type: 'text' as const, text: `${results.length} results:\n${formatted}` }] };
  },
);

// ============================================================
// Tool: node - Get detailed info about a symbol
// ============================================================
server.tool(
  'codeatlas_node',
  'Get detailed information about a specific symbol, including its source code, layer, and AI summary.',
  {
    id: z.string().describe('Symbol ID (format: filePath:name:line) or symbol name'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ id }) => {
    // Try multiple ID formats
    let symbol = store.getSymbol(id);
    if (!symbol) {
      const forwardId = id.replace(/\\/g, '/');
      symbol = store.getSymbol(forwardId);
    }
    if (!symbol) {
      const backslashId = id.replace(/\//g, '\\');
      symbol = store.getSymbol(backslashId);
    }
    if (!symbol) {
      // Try searching by name
      const results = store.searchSymbols(id, { limit: 5 });
      if (results.length === 1) {
        symbol = results[0];
      } else if (results.length > 1) {
        const formatted = results.map(s =>
          `- ${s.id}\n  ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`
        ).join('\n');
        return { content: [{ type: 'text' as const, text: `Multiple symbols found. Please use the full ID:\n${formatted}` }] };
      }
    }

    if (!symbol) {
      return { content: [{ type: 'text' as const, text: `Symbol "${id}" not found.` }] };
    }
    const info = [
      `Name: ${symbol.name}`,
      `Kind: ${symbol.kind}`,
      `Layer: ${symbol.layer}`,
      `File: ${symbol.filePath}:${symbol.startLine}-${symbol.endLine}`,
      `Exported: ${symbol.exported}`,
      `Complexity: ${symbol.complexity ?? 'N/A'}`,
      '',
      `Source code:`,
      '```',
      symbol.sourceCode ?? '(not available)',
      '```',
    ];
    if (symbol.docComment) info.push(`\nDoc comment: ${symbol.docComment}`);
    if (symbol.aiSummary) info.push(`\nAI Summary: ${symbol.aiSummary}`);
    
    return { content: [{ type: 'text' as const, text: info.join('\n') }] };
  },
);

// ============================================================
// Shared helper: resolve a symbol by ID or name
// ============================================================
type ResolvedSymbol = NonNullable<ReturnType<typeof store.getSymbol>>;
type ResolveOutcome =
  | { ok: true; symbol: ResolvedSymbol; symbolId: string }
  | { ok: false; message: string };

function resolveSymbol(id: string): ResolveOutcome {
  // Try multiple ID formats (handle path separator differences)
  let symbolId = id;
  let symbol = store.getSymbol(id);
  if (!symbol) {
    const forwardId = id.replace(/\\/g, '/');
    symbol = store.getSymbol(forwardId);
    if (symbol) symbolId = forwardId;
  }
  if (!symbol) {
    const backslashId = id.replace(/\//g, '\\');
    symbol = store.getSymbol(backslashId);
    if (symbol) symbolId = backslashId;
  }
  if (!symbol) {
    const results = store.searchSymbols(id, { limit: 5 });
    if (results.length === 1) {
      symbol = results[0];
      symbolId = results[0].id;
    } else if (results.length > 1) {
      const formatted = results.map(s =>
        `- ${s.id}\n  ${s.name} (${s.kind}) @ ${s.filePath}:${s.startLine}`
      ).join('\n');
      return { ok: false, message: `Multiple symbols found. Please use the full ID:\n${formatted}` };
    }
  }
  if (!symbol) {
    return { ok: false, message: `Symbol "${id}" not found.` };
  }
  return { ok: true, symbol, symbolId };
}

// ============================================================
// Tool: calls - Who calls this symbol and what does it call?
// ============================================================
server.tool(
  'codeatlas_calls',
  'Find callers ("who calls this symbol") and/or callees ("what this symbol calls"). Essential for safe refactoring.',
  {
    id: z.string().describe('Symbol ID or name'),
    direction: z.enum(['in', 'out', 'both']).optional().default('in')
      .describe('Call edge direction: "in" = callers (who calls this), "out" = callees (what this calls), "both" = both sides'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ id, direction }) => {
    const resolved = resolveSymbol(id);
    if (!resolved.ok) {
      return { content: [{ type: 'text' as const, text: resolved.message }] };
    }
    const { symbol, symbolId } = resolved;

    const sections: string[] = [];
    const addSection = (label: string, edges: ResolvedSymbol[]): void => {
      if (edges.length === 0) {
        sections.push(`No ${label.toLowerCase()} found for "${symbol.name}".`);
        return;
      }
      const formatted = edges.map(s => `${s.name} (${s.kind}) ${s.filePath}:${s.startLine}`).join('\n');
      sections.push(`${edges.length} ${label.toLowerCase()}:\n${formatted}`);
    };

    if (direction === 'in' || direction === 'both') addSection('Callers', store.getCallers(symbolId));
    if (direction === 'out' || direction === 'both') addSection('Callees', store.getCallees(symbolId));

    return { content: [{ type: 'text' as const, text: sections.join('\n\n') }] };
  },
);

// ============================================================
// Tool: context - Get focused context for a task or symbol
// ============================================================
server.tool(
  'codeatlas_context',
  'Get focused code context. Provide either a task description OR a symbol name for comprehensive context.',
  {
    task: z.string().optional().describe('Description of the task or area you want context for'),
    symbol: z.string().optional().describe('Symbol name or ID for comprehensive context'),
    maxTokens: z.number().optional().default(3000).describe('Max tokens for context'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ task, symbol, maxTokens }) => {
    // Symbol-based context mode
    if (symbol) {
      return getSymbolContext(symbol, maxTokens);
    }

    // Task-based context mode (original behavior)
    if (!task) {
      return { content: [{ type: 'text' as const, text: 'Please provide either a task description or a symbol name.' }] };
    }

    // Graph-aware context: search + expand to neighbors
    const keywords = task.split(/\s+/).filter(w => w.length > 2);
    const allResults = new Map();

    // Search by keywords
    for (const keyword of keywords) {
      try {
        const results = store.searchSymbols(keyword, { limit: 10 });
        for (const r of results) {
          if (!allResults.has(r.id)) {
            allResults.set(r.id, { symbol: r, relevance: 0 });
          }
          allResults.get(r.id)!.relevance++;
        }
      } catch {
        // FTS search failed, continue with other keywords
      }
    }

    // If no results from keywords, try partial matching on all symbols
    if (allResults.size === 0 && keywords.length > 0) {
      try {
        const allSymbols = store.searchSymbols('', { limit: 500 });
        for (const sym of allSymbols) {
          for (const keyword of keywords) {
            if (sym.name.toLowerCase().includes(keyword.toLowerCase()) ||
                sym.filePath.toLowerCase().includes(keyword.toLowerCase())) {
              if (!allResults.has(sym.id)) {
                allResults.set(sym.id, { symbol: sym, relevance: 0 });
              }
              allResults.get(sym.id)!.relevance++;
            }
          }
        }
      } catch {
        // Continue with empty results
      }
    }

    // Sort by relevance and take top candidates
    const sorted = [...allResults.values()]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10)
      .map(({ symbol }) => symbol);

    if (sorted.length === 0) {
      return { content: [{ type: 'text' as const, text: `No relevant symbols found for "${task}". Try different keywords.` }] };
    }

    // Use ContextBuilder to build graph-aware context
    const builder = new ContextBuilder(store);
    const context = builder.buildExplainContext(sorted, { maxTokens, includeSource: false });

    // Also include callers/callees expansion for top results
    const expandedSymbols = new Set(sorted.map(s => s.id));
    for (const sym of sorted.slice(0, 5)) {
      try {
        const callers = store.getCallers(sym.id);
        const callees = store.getCallees(sym.id);
        for (const c of [...callers, ...callees]) {
          if (!expandedSymbols.has(c.id)) {
            expandedSymbols.add(c.id);
            sorted.push(c);
          }
        }
      } catch {
        // Continue if callers/callees query fails
      }
    }

    const formatted = sorted.map(s =>
      `- **${s.name}** (${s.kind}, ${s.layer}) @ ${s.filePath}:${s.startLine}${s.aiSummary ? ` — ${s.aiSummary.slice(0, 80)}` : ''}`
    ).join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: `Context for "${task}" (${sorted.length} symbols, ~${context.tokenEstimate} tokens):\n\n${formatted}`,
      }],
    };
  },
);

// ============================================================
// Tool: impact - Analyze change impact
// ============================================================
server.tool(
  'codeatlas_impact',
  'Analyze the impact of changing a symbol. Supports symbol name, ID, or fuzzy match.',
  {
    id: z.string().describe('Symbol ID, name, or fuzzy match'),
    depth: z.number().optional().default(2).describe('Max traversal depth (default: 2)'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ id, depth }) => {
    // Try to find symbol with fuzzy matching
    let symbolId = id;
    let symbol = store.getSymbol(id);

    if (!symbol) {
      // Try with forward/back slashes
      const forwardId = id.replace(/\\/g, '/');
      symbol = store.getSymbol(forwardId);
      if (symbol) symbolId = forwardId;
    }
    if (!symbol) {
      const backslashId = id.replace(/\//g, '\\');
      symbol = store.getSymbol(backslashId);
      if (symbol) symbolId = backslashId;
    }

    if (!symbol) {
      // Fuzzy search by name
      const results = store.searchSymbols(id, { limit: 5 });
      if (results.length === 1) {
        symbol = results[0];
        symbolId = results[0].id;
      } else if (results.length > 1) {
        // Try exact name match
        const exact = results.find(s => s.name === id);
        if (exact) {
          symbol = exact;
          symbolId = exact.id;
        } else {
          // Use best match
          symbol = results[0];
          symbolId = results[0].id;
        }
      }
    }

    if (!symbol) {
      return { content: [{ type: 'text' as const, text: `Symbol "${id}" not found. Try using codeatlas_search first.` }] };
    }

    const analyzer = new ImpactAnalyzer(store);
    const result = analyzer.analyze(symbolId, depth, { limitPerDepth: 15 });
    if (!result) {
      return { content: [{ type: 'text' as const, text: `Could not analyze impact for "${symbol.name}".` }] };
    }
    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: layers - View project architecture layers
// ============================================================
server.tool(
  'codeatlas_layers',
  'View the architectural layer classification of the project.',
  {},
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async () => {
    const stats = store.getStats();
    const layers = ['interface', 'business', 'data', 'utility'] as const;
    const parts: string[] = [`Project: ${stats.symbols} symbols, ${stats.relationships} relationships, ${stats.files} files\n`];
    
    for (const layer of layers) {
      const symbols = store.getSymbolsByLayer(layer);
      parts.push(`\n## ${layer.toUpperCase()} (${symbols.length} symbols)`);
      // Group by file
      const byFile = new Map<string, typeof symbols>();
      for (const s of symbols) {
        if (!byFile.has(s.filePath)) byFile.set(s.filePath, []);
        byFile.get(s.filePath)!.push(s);
      }
      for (const [file, syms] of byFile) {
        parts.push(`  ${file}:`);
        for (const s of syms) {
          parts.push(`    - ${s.name} (${s.kind})`);
        }
      }
    }
    
    return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
  },
);

// ============================================================
// Tool: graph - Get graph data for visualization
// ============================================================
server.tool(
  'codeatlas_graph',
  'Get graph data (nodes and edges) suitable for visualization.',
  {
    layers: z.array(z.string()).optional().describe('Filter by layers'),
    limit: z.number().optional().default(200).describe('Max nodes to return'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ layers, limit }) => {
    // Get symbols, optionally filtered by layers
    let allSymbols: any[] = [];
    if (layers && layers.length > 0) {
      for (const layer of layers) {
        allSymbols.push(...store.getSymbolsByLayer(layer as any));
      }
    } else {
      allSymbols = store.searchSymbols('', { limit: 10000 });
    }

    if (allSymbols.length > limit) {
      allSymbols = allSymbols.slice(0, limit);
    }

    const symbolIds = new Set(allSymbols.map((s: any) => s.id));

    const nodes = allSymbols.map((s: any) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      layer: s.layer,
      filePath: s.filePath,
      startLine: s.startLine,
      exported: s.exported,
    }));

    const edges: any[] = [];
    for (const symbol of allSymbols) {
      const outgoing = store.getRelationshipsFrom(symbol.id);
      for (const rel of outgoing) {
        if (symbolIds.has(rel.targetId)) {
          edges.push({ sourceId: rel.sourceId, targetId: rel.targetId, kind: rel.kind });
        }
      }
    }

    const stats = store.getStats();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ nodes, edges, stats }, null, 2),
      }],
    };
  },
);

// ============================================================
// Tool: explain - AI explanation of a module or symbol
// ============================================================
server.tool(
  'codeatlas_explain',
  'Get an AI-generated explanation of a code module or symbol. Requires LLM configuration in .codeatlas.yaml.',
  {
    id: z.string().optional().describe('Symbol ID (format: filePath:name:startLine)'),
    path: z.string().optional().describe('File path to explain all symbols in'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ id, path: filePath }) => {
    // Use shared explainer (connection pool)
    if (!sharedExplainer) {
      return {
        content: [{
          type: 'text' as const,
          text: 'AI analysis not configured. Please set up LLM provider in .codeatlas.yaml or set ANTHROPIC_API_KEY/OPENAI_API_KEY environment variable.',
        }],
      };
    }

    // Explain single symbol
    if (id) {
      const symbol = store.getSymbol(id);
      if (!symbol) {
        return { content: [{ type: 'text' as const, text: `Symbol "${id}" not found.` }] };
      }

      const explanation = await sharedExplainer.explainSymbol(symbol);
      return {
        content: [{
          type: 'text' as const,
          text: `## ${symbol.name} (${symbol.kind})\n\n${explanation}`,
        }],
      };
    }

    // Explain file
    if (filePath) {
      const symbols = store.getSymbolsByFile(filePath);
      if (symbols.length === 0) {
        return { content: [{ type: 'text' as const, text: `No symbols found in "${filePath}".` }] };
      }

      // Get relationships for these symbols
      const relationships = [];
      for (const s of symbols) {
        relationships.push(...store.getRelationshipsFrom(s.id));
      }

      const explanation = await sharedExplainer.explainModule(symbols, relationships);
      return {
        content: [{
          type: 'text' as const,
          text: `## ${filePath}\n\n${explanation}`,
        }],
      };
    }

    return { content: [{ type: 'text' as const, text: 'Please provide either an ID or path.' }] };
  },
);

// ============================================================
// Tool: semantic_search - Search by meaning (embeddings or AI)
// ============================================================
server.tool(
  'codeatlas_semantic_search',
  'Search code by meaning, not just keywords. Uses vector embeddings when a semantic index exists (build with codeatlas_semantic_index), otherwise falls back to AI-based matching.',
  {
    query: z.string().describe('Natural language query'),
    top: z.number().optional().default(10).describe('Number of results'),
    mode: z.enum(['auto', 'vector', 'ai']).optional().default('auto')
      .describe('Search strategy: "vector" uses embeddings (requires codeatlas_semantic_index), "ai" uses AI matching, "auto" prefers vector and falls back to AI'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ query, top, mode }) => {
    if (mode === 'vector' || mode === 'auto') {
      const generator = createEmbeddingGenerator({ provider: 'local' });
      const vectorStore = new VectorStore(store, generator);
      const stats = vectorStore.getStats();
      if (stats.indexed > 0) {
        const hybridSearch = new HybridSearch(store, vectorStore);
        const results = await hybridSearch.search(query, { topK: top });

        if (results.length === 0) {
          return { content: [{ type: 'text' as const, text: `No results found for "${query}".` }] };
        }

        const formatted = results.map((r, i) => {
          const score = (r.combinedScore * 100).toFixed(1);
          return `${i + 1}. [${score}%] **${r.symbol.name}** (${r.symbol.kind}) @ ${r.symbol.filePath}:${r.symbol.startLine}\n   Reasons: ${r.reasons.join(', ')}`;
        }).join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: `🔍 Semantic Search: "${query}"\n\n${formatted}`,
          }],
        };
      }
      if (mode === 'vector') {
        return {
          content: [{
            type: 'text' as const,
            text: 'No embeddings indexed. Run codeatlas_semantic_index first to build the semantic index.',
          }],
        };
      }
    }

    // AI-based matching (primary for mode="ai", fallback for mode="auto")
    if (!sharedExplainer) {
      return {
        content: [{
          type: 'text' as const,
          text: 'AI not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or build embeddings with codeatlas_semantic_index and search with mode="vector".',
        }],
      };
    }

    const allSymbols = store.searchSymbols('', { limit: 10000 });
    const results = await sharedExplainer.semanticSearch(query, allSymbols);

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: `No symbols found matching "${query}".` }] };
    }

    const formatted = results.slice(0, top).map(s =>
      `- **${s.name}** (${s.kind}, ${s.layer}) @ ${s.filePath}:${s.startLine}`
    ).join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: `Found ${results.length} symbols matching "${query}":\n\n${formatted}`,
      }],
    };
  },
);

// ============================================================
// Tool: annotate - Add, list, or resolve symbol annotations
// ============================================================
server.tool(
  'codeatlas_annotate',
  'Manage annotations on symbols: action="add" attaches a comment/TODO/issue, action="list" shows a symbol\'s annotations, action="resolve" marks one resolved or unresolved.',
  {
    action: z.enum(['add', 'list', 'resolve'])
      .describe('"add" = new annotation, "list" = show a symbol\'s annotations, "resolve" = toggle resolved state'),
    symbolId: z.string().optional().describe('Symbol ID or name (required for add and list)'),
    content: z.string().optional().describe('Annotation text (required for add)'),
    userId: z.string().optional().default('anonymous').describe('User identifier (add)'),
    type: z.enum(['comment', 'todo', 'issue', 'question']).optional().default('comment')
      .describe('Annotation type (add)'),
    annotationId: z.string().optional().describe('Annotation ID (required for resolve)'),
    resolved: z.boolean().optional().default(true)
      .describe('Mark resolved (true) or unresolved (false) — resolve only'),
  },
  { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
  async ({ action, symbolId, content, userId, type, annotationId, resolved }) => {
    if (action === 'add') {
      if (!symbolId || !content) {
        return { content: [{ type: 'text' as const, text: 'action="add" needs symbolId and content.' }] };
      }
      const target = resolveSymbol(symbolId);
      if (!target.ok) {
        return { content: [{ type: 'text' as const, text: target.message }] };
      }
      const id = store.addAnnotation(target.symbolId, userId, content, type);
      return {
        content: [{
          type: 'text' as const,
          text: `✅ Annotation added!\n\nSymbol: ${target.symbol.name}\nType: ${type}\nUser: ${userId}\nContent: ${content}\n\nID: ${id}`,
        }],
      };
    }

    if (action === 'list') {
      if (!symbolId) {
        return { content: [{ type: 'text' as const, text: 'action="list" needs symbolId.' }] };
      }
      const target = resolveSymbol(symbolId);
      if (!target.ok) {
        return { content: [{ type: 'text' as const, text: target.message }] };
      }
      const annotations = store.getAnnotations(target.symbolId);
      if (annotations.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No annotations for "${target.symbol.name}" yet. Use codeatlas_annotate with action="add".`,
          }],
        };
      }
      const formatted = annotations.map(a =>
        `- **${a.type}** by ${a.user_id} (${a.created_at}):\n  ${a.content}${a.resolved ? ' ✅' : ''}`
      ).join('\n\n');
      return {
        content: [{ type: 'text' as const, text: `Annotations for ${target.symbol.name} (${annotations.length}):\n\n${formatted}` }],
      };
    }

    // action === 'resolve'
    if (!annotationId) {
      return { content: [{ type: 'text' as const, text: 'action="resolve" needs annotationId.' }] };
    }
    store.resolveAnnotation(annotationId, resolved);
    return {
      content: [{ type: 'text' as const, text: `✅ Annotation ${resolved ? 'resolved' : 'unresolved'}.` }],
    };
  },
);

// ============================================================
// Tool: summary - Get project overview
// ============================================================
server.tool(
  'codeatlas_summary',
  'Get a quick overview of the project: file count, symbol count, layer distribution, and key modules. Use this first to understand the codebase.',
  {},
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async () => {
    const stats = store.getStats();

    // Get layer distribution
    const layers = ['interface', 'business', 'data', 'utility'] as const;
    const layerCounts: Record<string, number> = {};
    for (const layer of layers) {
      const symbols = store.getSymbolsByLayer(layer);
      layerCounts[layer] = symbols.length;
    }

    // Get top modules (directories with most symbols)
    const allSymbols = store.searchSymbols('', { limit: 10000 });
    const moduleCounts = new Map<string, number>();
    for (const symbol of allSymbols) {
      const parts = symbol.filePath.split('/');
      const module = parts.length > 2 ? parts.slice(0, 3).join('/') : symbol.filePath;
      moduleCounts.set(module, (moduleCounts.get(module) || 0) + 1);
    }

    const topModules = Array.from(moduleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([mod, count]) => `  - ${mod}: ${count} symbols`)
      .join('\n');

    const summary = `📊 Project Summary
═══════════════════════════════════════
📁 Files: ${stats.files}
🔷 Symbols: ${stats.symbols}
🔗 Relationships: ${stats.relationships}
🌐 Languages: ${stats.languages.join(', ') || 'N/A'}

🏗️ Architecture Layers:
  - Interface: ${layerCounts.interface || 0} (UI/API)
  - Business: ${layerCounts.business || 0} (Logic)
  - Data: ${layerCounts.data || 0} (Storage)
  - Utility: ${layerCounts.utility || 0} (Helpers)

📦 Top Modules:
${topModules || '  No modules found'}`;

    return {
      content: [{
        type: 'text' as const,
        text: summary,
      }],
    };
  },
);

// ============================================================
// Tool: hotspots - Find complex/problematic code
// ============================================================
server.tool(
  'codeatlas_hotspots',
  'Find code hotspots: high complexity, many callers/callees, or large files. Uses batch queries for performance.',
  {
    limit: z.number().optional().default(10).describe('Max results'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ limit }) => {
    const allSymbols = store.searchSymbols('', { limit: 10000 });
    const symbolIds = allSymbols.map(s => s.id);

    // Batch query caller and callee counts (single SQL each)
    const callerCounts = store.getCallerCounts(symbolIds);
    const calleeCounts = store.getCalleeCounts(symbolIds);

    const hotspots: Array<{
      name: string;
      kind: string;
      file: string;
      line: number;
      reason: string;
      score: number;
    }> = [];

    for (const symbol of allSymbols) {
      let score = 0;
      const reasons: string[] = [];

      // Check callers (high coupling) — from batch query
      const callerCount = callerCounts.get(symbol.id) ?? 0;
      if (callerCount > 5) {
        score += callerCount;
        reasons.push(`${callerCount} callers`);
      }

      // Check callees (high dependency) — from batch query
      const calleeCount = calleeCounts.get(symbol.id) ?? 0;
      if (calleeCount > 5) {
        score += calleeCount;
        reasons.push(`${calleeCount} callees`);
      }

      // Check code length (large functions)
      if (symbol.sourceCode) {
        const lines = symbol.sourceCode.split('\n').length;
        if (lines > 50) {
          score += Math.floor(lines / 10);
          reasons.push(`${lines} lines`);
        }
      }

      // Check annotations (potential issues)
      const annotations = store.getAnnotations(symbol.id);
      const unresolved = annotations.filter((a: any) => !a.resolved);
      if (unresolved.length > 0) {
        score += unresolved.length * 3;
        reasons.push(`${unresolved.length} open issues`);
      }

      if (score > 0 && reasons.length > 0) {
        hotspots.push({
          name: symbol.name,
          kind: symbol.kind,
          file: symbol.filePath,
          line: symbol.startLine,
          reason: reasons.join(', '),
          score,
        });
      }
    }

    // Sort by score and take top N
    hotspots.sort((a, b) => b.score - a.score);
    const topHotspots = hotspots.slice(0, limit);

    if (topHotspots.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No hotspots found. The codebase looks healthy!',
        }],
      };
    }

    const formatted = topHotspots.map((h, i) =>
      `${i + 1}. **${h.name}** (${h.kind}) @ ${h.file}:${h.line}\n   Reason: ${h.reason}`
    ).join('\n\n');

    return {
      content: [{
        type: 'text' as const,
        text: `🔥 Code Hotspots (high complexity/coupling):\n\n${formatted}`,
      }],
    };
  },
);

// ============================================================
// Tool: changes - Show recently modified symbols
// ============================================================
server.tool(
  'codeatlas_changes',
  'Show recently modified files and their symbols, sorted by most recent.',
  {
    limit: z.number().optional().default(10).describe('Max files to show'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ limit }) => {
    // Get files sorted by parsed_at (most recent first)
    const recentFiles = store.getRecentFiles(limit);

    if (recentFiles.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No files found. Run codeatlas_scan first.',
        }],
      };
    }

    const parts: string[] = [];
    for (const file of recentFiles) {
      const symbols = store.getSymbolsByFile(file.path);
      const symbolNames = symbols.slice(0, 5).map(s => s.name);
      const timeStr = file.parsedAt ? ` (${file.parsedAt})` : '';
      parts.push(`📄 **${file.path}** [${file.language}]${timeStr}\n   ${symbols.length} symbols: ${symbolNames.join(', ')}${symbols.length > 5 ? '...' : ''}`);
    }

    return {
      content: [{
        type: 'text' as const,
        text: `📁 Recently Modified Files:\n\n${parts.join('\n\n')}`,
      }],
    };
  },
);

// ============================================================
// Tool: deps - Analyze dependency health
// ============================================================
server.tool(
  'codeatlas_deps',
  'Analyze dependency health: detect circular dependencies, unused packages, and unlisted dependencies.',
  {
    circular: z.boolean().optional().default(false).describe('Only show circular dependencies'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ circular }) => {
    const analyzer = new DepAnalyzer(store, projectPath);
    const result = analyzer.analyze();

    if (circular) {
      if (result.circular.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No circular dependencies found.' }] };
      }
      const formatted = result.circular.map(c => `  ${c.chain.join(' → ')}`).join('\n');
      return { content: [{ type: 'text' as const, text: `Circular Dependencies (${result.circular.length}):\n${formatted}` }] };
    }

    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: review - AI code review
// ============================================================
server.tool(
  'codeatlas_review',
  'Run AI-powered code review on changed files. Smart mode (default) uses graph context for ~90% token savings.',
  {
    files: z.array(z.string()).optional().describe('Specific files to review (defaults to git diff)'),
    focus: z.array(z.string()).optional().default(['correctness', 'security', 'perf', 'readability']).describe('Focus areas'),
    depth: z.number().optional().default(2).describe('Max impact depth'),
    smart: z.boolean().optional().default(true).describe('Use graph-aware context (saves ~90% tokens)'),
    budget: z.number().optional().default(4000).describe('Token budget for smart mode'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ files, focus, depth, smart, budget }) => {
    const config = loadConfig(projectPath);
    const aiConfig = getAIConfig(config);

    const analyzer = new ReviewAnalyzer(store, {
      focus,
      depth,
      smart,
      tokenBudget: budget,
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    // Use provided files or get from git
    let changedFiles = files || [];
    if (changedFiles.length === 0) {
      try {
        const { execSync } = await import('child_process');
        const output = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only', {
          encoding: 'utf-8',
          cwd: projectPath,
        });
        changedFiles = output.split('\n').map(f => f.trim()).filter(f => f.length > 0);
      } catch {
        return { content: [{ type: 'text' as const, text: 'No changed files found. Provide files explicitly or ensure git is available.' }] };
      }
    }

    if (changedFiles.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No uncommitted changes found.' }] };
    }

    const result = await analyzer.review(changedFiles, { focus, smart, tokenBudget: budget });
    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: guard - Architecture gate check
// ============================================================
server.tool(
  'codeatlas_guard',
  'Check architecture rules: circular dependencies, layer violations, complexity thresholds. Returns pass/fail.',
  {
    maxDepth: z.number().optional().default(3).describe('Max allowed impact depth'),
    forbidCircular: z.boolean().optional().default(true).describe('Fail on circular dependencies'),
    maxComplexity: z.number().optional().default(50).describe('Max complexity per symbol'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ maxDepth, forbidCircular, maxComplexity }) => {
    const analyzer = new GuardAnalyzer(store, {
      maxImpactDepth: maxDepth,
      forbidCircular,
      maxComplexity,
    });

    const result = analyzer.check();
    return {
      content: [{
        type: 'text' as const,
        text: `${result.passed ? '✅ PASSED' : '❌ FAILED'}\n\n${result.summary}`,
      }],
    };
  },
);

// ============================================================
// Tool: path - Find shortest path between two symbols
// ============================================================
server.tool(
  'codeatlas_path',
  'Find the shortest path between two symbols in the code graph. Shows how they are connected.',
  {
    source: z.string().describe('Source symbol ID or name'),
    target: z.string().describe('Target symbol ID or name'),
    maxDepth: z.number().optional().default(6).describe('Max path length'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ source, target, maxDepth }) => {
    const finder = new PathFinder(store);
    const result = finder.find(source, target, maxDepth);
    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: agent_execute - Plan or execute a coding task
// ============================================================
server.tool(
  'codeatlas_agent_execute',
  'Plan or execute a coding task using the code graph. mode="plan" analyzes the task and returns an execution plan (affected files, risk level, ordered steps); mode="execute" runs decompose → analyze → plan → generate → verify with iterative refinement.',
  {
    description: z.string().describe('Task description (e.g., "Add JWT authentication to UserService")'),
    target: z.string().optional().describe('Target symbol to focus on'),
    mode: z.enum(['plan', 'execute']).optional().default('execute')
      .describe('"plan" = execution plan only (read-only), "execute" = full pipeline with code generation'),
    verify: z.boolean().optional().default(true).describe('Run verification after generation (execute mode)'),
    budget: z.number().optional().default(8000).describe('Total token budget (execute mode)'),
    maxIterations: z.number().optional().default(3).describe('Max refinement iterations (execute mode)'),
  },
  { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  async ({ description, target, mode, verify, budget, maxIterations }) => {
    const config = loadConfig(projectPath);
    const aiConfig = getAIConfig(config);

    const runtime = new AgentRuntime(store, {
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    if (mode === 'plan') {
      const plan = await runtime.plan({
        description,
        targetSymbol: target,
      });
      return { content: [{ type: 'text' as const, text: plan.summary }] };
    }

    if (!aiConfig.provider) {
      return {
        content: [{
          type: 'text' as const,
          text: 'AI not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use mode="plan" for plan-only analysis.',
        }],
      };
    }

    const result = await runtime.execute({
      description,
      targetSymbol: target,
      autoVerify: verify,
      tokenBudget: budget,
      maxIterations,
      dryRun: false,
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: refactor - Detect code smells and suggest refactoring
// ============================================================
server.tool(
  'codeatlas_refactor',
  'Detect code smells (god-class, feature-envy, shotgun-surgery, dead-code, high-coupling) and generate refactoring suggestions.',
  {
    type: z.enum(['god-class', 'feature-envy', 'shotgun-surgery', 'dead-code', 'high-coupling']).optional().describe('Detect specific smell type (omit for all)'),
  },
  { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  async ({ type }) => {
    const engine = new RefactorEngine(store);
    const report = type ? engine.analyzeType(type) : engine.analyze();
    return { content: [{ type: 'text' as const, text: report.summary }] };
  },
);

// ============================================================
// Tool: graph_export - Export graph data (or a Foam vault)
// ============================================================
server.tool(
  'codeatlas_graph_export',
  'Export code graph data in various formats: JSON, CSV, Mermaid, Adjacency Matrix, Statistics, or a Foam (Obsidian) markdown vault. Useful for mathematical modeling and data analysis.',
  {
    format: z.enum(['json', 'csv', 'mermaid', 'matrix', 'stats', 'foam']).optional().default('json')
      .describe('Export format; "foam" writes a Markdown vault directory'),
    layer: z.string().optional().describe('Filter by layer (interface|business|data|utility)'),
    kind: z.string().optional().describe('Filter by symbol kind (class|function|method|etc)'),
    limit: z.number().optional().default(100).describe('Max nodes to export'),
    stats: z.boolean().optional().default(false).describe('Show graph statistics only'),
    output: z.string().optional().describe('Output directory for foam export (defaults to .codeatlas/foam)'),
    includeSource: z.boolean().optional().default(true).describe('Include source code in Foam notes (foam only)'),
  },
  { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  async ({ format, layer, kind, limit, stats, output, includeSource }) => {
    if (format === 'foam') {
      const foam = new FoamExporter(store);
      const result = await foam.export({
        projectPath,
        outputDir: output ? path.resolve(output) : undefined,
        includeSource,
        includeAISummary: true,
      });
      return {
        content: [{
          type: 'text' as const,
          text: `📁 Foam export complete:\n- Files generated: ${result.filesGenerated}\n- Output directory: ${result.outputDir}\n\nImport as an Obsidian/Foam vault to view the knowledge graph.`,
        }],
      };
    }

    const exporter = new GraphExporter(store);

    if (stats) {
      const statsResult = exporter.getStats({ layer, kind, limit });
      return { content: [{ type: 'text' as const, text: JSON.stringify(statsResult, null, 2) }] };
    }

    const result = exporter.export({ format, layer, kind, limit });
    return { content: [{ type: 'text' as const, text: result }] };
  },
);

// ============================================================
// Tool: diff - Compare graph states
// ============================================================
server.tool(
  'codeatlas_diff',
  'Compare graph states: show added/removed/moved symbols and edge changes. Use for verifying refactoring results.',
  {
    baseline: z.string().optional().describe('Baseline file path to compare against'),
    save: z.string().optional().describe('Save current state as baseline'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ baseline, save }) => {
    const analyzer = new DiffAnalyzer(store);

    if (save) {
      analyzer.saveBaseline(save);
      return { content: [{ type: 'text' as const, text: `✅ Baseline saved to ${save}` }] };
    }

    const result = analyzer.analyze(baseline);
    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: trace - Inspect Flowtrace execution traces
// ============================================================
server.tool(
  'codeatlas_trace',
  'Inspect a Flowtrace execution trace: action="load" shows trace metadata and steps, action="flow" shows the execution DAG (text or Mermaid), action="analyze" finds hot paths, failure patterns, and coverage gaps.',
  {
    action: z.enum(['load', 'flow', 'analyze'])
      .describe('"load" = trace metadata and steps, "flow" = execution DAG, "analyze" = hot paths / failures / coverage'),
    path: z.string().describe('Path to Flowtrace trace directory'),
    format: z.enum(['text', 'mermaid']).optional().default('text').describe('Output format for action="flow"'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ action, path: tracePath, format }) => {
    if (action === 'analyze') {
      const analyzer = new TraceAnalyzer(store, tracePath);
      const result = analyzer.analyze();
      if (!result) {
        return { content: [{ type: 'text' as const, text: 'Could not analyze trace. Make sure trace.json exists.' }] };
      }
      return { content: [{ type: 'text' as const, text: result.summary }] };
    }

    const reader = new TraceReader(tracePath);
    const data = reader.load();
    if (!data) {
      return { content: [{ type: 'text' as const, text: `No trace found at "${tracePath}". Make sure trace.json exists.` }] };
    }
    const steps = reader.getStepsWithContext();

    if (action === 'flow') {
      const stepsWithUpstream = steps.filter(s => s.upstream.length > 0);
      if (format === 'mermaid') {
        const mermaid = [
          '```mermaid',
          'flowchart TD',
          ...steps.map(s => `  ${s.id}["${s.spec.name}"]`),
          ...stepsWithUpstream.map(s => s.upstream.map(u => `  ${u} --> ${s.id}`).join('\n')),
          '```',
        ].join('\n');
        return { content: [{ type: 'text' as const, text: `📈 Execution Flow:\n\n${mermaid}` }] };
      }
      const parts: string[] = [`📈 Execution Flow (${steps.length} steps):\n`];
      for (const s of steps) {
        const upstream = s.upstream.length > 0 ? ` ← ${s.upstream.join(', ')}` : '';
        parts.push(`  ${s.id}: ${s.spec.name}${upstream}`);
      }
      return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
    }

    // action === 'load'
    const stats = reader.getStats();
    const parts: string[] = [];
    parts.push(`📋 Trace: ${data.spec.title}`);
    parts.push(`ID: ${data.spec.id} | Version: ${data.spec.version}`);
    parts.push(`Description: ${data.spec.description}`);
    parts.push('');
    parts.push(`Steps: ${steps.length}`);
    if (stats) {
      parts.push(`Completion: ${(stats.completionRate * 100).toFixed(0)}% (${stats.completedSteps}/${stats.totalSteps})`);
    }
    parts.push('');
    parts.push('Steps:');
    for (const step of steps.slice(0, 10)) {
      const status = step.status?.kind ?? 'unknown';
      parts.push(`  [${status}] ${step.id}: ${step.spec.name}`);
    }
    if (steps.length > 10) parts.push(`  ... and ${steps.length - 10} more`);
    return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
  },
);

// ============================================================
// Tool: trace_agent - Agent with execution awareness
// ============================================================
server.tool(
  'codeatlas_trace_agent',
  'Execute a coding task with execution awareness from Flowtrace. Uses existing agent capabilities — no additional LLM key needed.',
  {
    description: z.string().describe('Task description'),
    tracePath: z.string().optional().describe('Path to Flowtrace trace directory'),
    focusStep: z.string().optional().describe('Focus on specific execution step'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ description, tracePath, focusStep }) => {
    // Get trace analysis if tracePath provided
    let traceAnalysis: string = '';
    let recommendations: string[] = [];

    if (tracePath) {
      const analyzer = new TraceAnalyzer(store, tracePath);
      const result = analyzer.analyze();

      if (result) {
        traceAnalysis = result.summary;

        // Generate execution-aware recommendations
        if (result.hotPaths.length > 0) {
          recommendations.push(`🔥 Hot path: ${result.hotPaths[0].steps.join(' → ')}`);
        }
        if (result.failures.length > 0) {
          recommendations.push(`❌ Failures: ${result.failures.map(f => f.stepId).join(', ')}`);
        }
        if (result.executionDiff.coverage < 0.5) {
          recommendations.push(`📈 Low coverage (${(result.executionDiff.coverage * 100).toFixed(0)}%) — consider adding tests`);
        }
        if (focusStep) {
          const onHotPath = result.hotPaths.some(p => p.steps.includes(focusStep));
          if (onHotPath) {
            recommendations.push(`🎯 Focus step "${focusStep}" is on a hot path — high impact`);
          }
        }
      }
    }

    // Use base agent (dry-run mode) to get plan
    const baseAgent = new AgentRuntime(store);
    const plan = await baseAgent.plan({
      description,
      targetSymbol: focusStep,
      dryRun: true,
    });

    // Build response
    const parts: string[] = [];
    parts.push(plan.summary);

    if (traceAnalysis) {
      parts.push('\n📊 Execution Analysis:');
      parts.push(traceAnalysis);
    }

    if (recommendations.length > 0) {
      parts.push('\n🎯 Execution-Aware Recommendations:');
      for (const rec of recommendations) {
        parts.push(`  ${rec}`);
      }
    }

    return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
  },
);

// ============================================================
// Tool: embedded - Embedded project analysis and configuration
// ============================================================
server.tool(
  'codeatlas_embedded',
  'Embedded project support: action="analyze" detects RTOS tasks, interrupt handlers, and hardware access; action="build" shows build system configuration and libraries; action="exclude" lists recommended vendor library exclusion patterns.',
  {
    action: z.enum(['analyze', 'build', 'exclude'])
      .describe('"analyze" = RTOS/ISR/hardware analysis, "build" = build configuration, "exclude" = vendor library exclusion patterns'),
    path: z.string().optional().describe('Project path (defaults to last scan path)'),
  },
  { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
  async ({ action, path: scanPath }) => {
    const target = scanPath ? path.resolve(scanPath) : lastScannedPath;

    if (action === 'analyze') {
      const analyzer = new EmbeddedAnalyzer(store, target);
      const result = analyzer.analyze();
      return { content: [{ type: 'text' as const, text: result.summary }] };
    }

    const analyzer = new BuildAnalyzer(target);

    if (action === 'build') {
      const config = analyzer.analyze();
      const parts: string[] = [];
      parts.push(`📦 Build System: ${config.type}`);
      if (config.platform) parts.push(`Platform: ${config.platform}`);
      if (config.board) parts.push(`Board: ${config.board}`);
      if (config.framework) parts.push(`Framework: ${config.framework}`);
      if (config.dependencies.length > 0) {
        parts.push(`\nLibraries (${config.dependencies.length}):`);
        for (const dep of config.dependencies.slice(0, 10)) {
          parts.push(`  - ${dep}`);
        }
      }
      return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
    }

    // action === 'exclude'
    const patterns = analyzer.getExcludePatterns();
    return {
      content: [{
        type: 'text' as const,
        text: `Exclusion patterns for vendor/system libraries:\n\n${patterns.map(p => `  ${p}`).join('\n')}`,
      }],
    };
  },
);

// ============================================================
// Tool: semantic_index - Build embeddings for semantic search
// ============================================================
server.tool(
  'codeatlas_semantic_index',
  'Build vector embeddings for semantic search. Enables finding code by meaning, not just keywords.',
  {
    provider: z.enum(['local', 'openai', 'ollama']).optional().default('local').describe('Embedding provider'),
  },
  { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  async ({ provider }) => {
    const generator = createEmbeddingGenerator({ provider });
    const vectorStore = new VectorStore(store, generator);

    let indexed = 0;
    const total = store.searchSymbols('', { limit: 10000 }).length;

    await vectorStore.indexAll((current, total) => {
      indexed = current;
    });

    return {
      content: [{
        type: 'text' as const,
        text: `✅ Semantic index built!\n- Indexed: ${indexed} symbols\n- Provider: ${provider}\n- Dimension: ${generator.getDimension()}`,
      }],
    };
  },
);

// ============================================================
// Tool: orchestrate - Multi-agent task orchestration
// ============================================================
server.tool(
  'codeatlas_orchestrate',
  'Decompose a complex task into parallelizable subtasks and execute them with multiple agents.',
  {
    task: z.string().describe('Task description'),
    dryRun: z.boolean().optional().default(false).describe('Only show plan, don\'t execute'),
  },
  { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  async ({ task, dryRun }) => {
    const config = loadConfig(projectPath);
    const aiConfig = getAIConfig(config);

    const orchestrator = new AgentOrchestrator(store, {
      llmProvider: aiConfig.provider,
      llmModel: aiConfig.model,
      llmApiKey: aiConfig.apiKey,
      llmBaseUrl: aiConfig.baseUrl,
    });

    // Decompose task
    const dag = orchestrator.decompose(task);

    if (dryRun) {
      const parts: string[] = [];
      parts.push('📋 Task Decomposition:');
      parts.push(`Task: ${task}`);
      parts.push(`Subtasks: ${dag.subtasks.length}`);
      parts.push('');
      parts.push('Execution Plan:');
      for (let i = 0; i < dag.executionPlan.length; i++) {
        const level = dag.executionPlan[i];
        const parallel = level.length > 1 ? ' (parallel)' : '';
        parts.push(`  Level ${i + 1}: ${level.join(', ')}${parallel}`);
      }
      parts.push('');
      parts.push('Subtask Details:');
      for (const st of dag.subtasks) {
        parts.push(`  [${st.type}] ${st.description}`);
      }
      return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
    }

    // Execute
    const result = await orchestrator.execute(dag);
    return { content: [{ type: 'text' as const, text: result.summary }] };
  },
);

// ============================================================
// Tool: set_project — Switch to a different project
// ============================================================
server.tool(
  'codeatlas_set_project',
  'Switch the MCP server to a different project. All subsequent tools will use this project\'s code graph. Use this when working across multiple repositories without restarting the server.',
  {
    path: z.string().describe('Absolute path to the project directory'),
  },
  { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  async ({ path: newPath }) => {
    const resolved = path.resolve(newPath);
    if (!fs.existsSync(resolved)) {
      return { content: [{ type: 'text' as const, text: `❌ Path does not exist: ${resolved}` }] };
    }
    try {
      const summary = await initForProject(resolved);
      return { content: [{ type: 'text' as const, text: summary }] };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `❌ Failed to switch project: ${err.message}` }] };
    }
  },
);

// ============================================================
// Start the server
// ============================================================
async function main() {
  await initStore();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CodeAtlas MCP Server started (stdio transport)');
  console.error(`Project: ${projectPath}`);
  if (watcher) {
    console.error('File watcher: enabled');
  }
}

// Cleanup on exit
process.on('SIGINT', async () => {
  if (watcher) {
    await watcher.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (watcher) {
    await watcher.stop();
  }
  process.exit(0);
});

main().catch(err => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
