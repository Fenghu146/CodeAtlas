#!/usr/bin/env node
// ============================================================
// CodeAtlas CLI - Main entry point
// ============================================================
// Usage:
//   codeatlas scan [path]           Scan and build graph
//   codeatlas search <query>        Search symbols
//   codeatlas info <symbol>         Show symbol details
//   codeatlas callers <symbol>      Who calls this?
//   codeatlas callees <symbol>      What does this call?
//   codeatlas impact <symbol>       Analyze change impact
//   codeatlas layers                Show architecture layers
//   codeatlas serve                 Start web visualization
//   codeatlas export                Export graph data
//   codeatlas status                Show index status
//   codeatlas foam                  Export as Foam-compatible markdown
//   codeatlas deps                  Dependency health analysis
//   codeatlas review                AI code review
//   codeatlas guard                 Architecture gate checks
//   codeatlas doc                   Generate documentation skeletons

import { Command } from 'commander';
import path from 'path';

const program = new Command();

program
  .name('codeatlas')
  .description('Turn any codebase into an interactive knowledge graph')
  .version('0.1.0');

// ========================
// scan command
// ========================
program
  .command('scan [path]')
  .description('Scan project and build code graph')
  .option('-f, --full', 'Force full rescan')
  .option('--ai', 'Enable AI analysis (requires LLM config)')
  .option('-e, --exclude <dirs>', 'Comma-separated directories to exclude (e.g., "lib,vendor,.pio")')
  .action(async (scanPath, options) => {
    // Dynamic import to keep startup fast
    const { scanCommand } = await import('./commands/scan.js');
    const exclude = options.exclude ? options.exclude.split(',').map((s: string) => s.trim()) : undefined;
    await scanCommand(scanPath || process.cwd(), { ...options, exclude });
  });

// ========================
// search command
// ========================
program
  .command('search <query>')
  .description('Search for symbols by name or keyword')
  .option('-k, --kind <kind>', 'Filter by symbol kind')
  .option('-l, --layer <layer>', 'Filter by architectural layer')
  .option('-n, --limit <number>', 'Max results', '20')
  .action(async (query, options) => {
    const { searchCommand } = await import('./commands/search.js');
    await searchCommand(query, options);
  });

// ========================
// info command
// ========================
program
  .command('info <symbol>')
  .description('Show detailed info about a symbol')
  .action(async (symbolId) => {
    const { infoCommand } = await import('./commands/info.js');
    await infoCommand(symbolId);
  });

// ========================
// callers command
// ========================
program
  .command('callers <symbol>')
  .description('Find all callers of a symbol')
  .action(async (symbolId) => {
    const { callersCommand } = await import('./commands/callers.js');
    await callersCommand(symbolId);
  });

// ========================
// callees command
// ========================
program
  .command('callees <symbol>')
  .description('Find all callees of a symbol')
  .action(async (symbolId) => {
    const { calleesCommand } = await import('./commands/callees.js');
    await calleesCommand(symbolId);
  });

// ========================
// impact command
// ========================
program
  .command('impact <symbol>')
  .description('Analyze the impact of changing a symbol')
  .option('-d, --depth <number>', 'Max traversal depth', '3')
  .action(async (symbolId, options) => {
    const { impactCommand } = await import('./commands/impact.js');
    await impactCommand(symbolId, options);
  });

// ========================
// layers command
// ========================
program
  .command('layers')
  .description('Show architectural layer classification')
  .action(async () => {
    const { layersCommand } = await import('./commands/layers.js');
    await layersCommand();
  });

// ========================
// serve command
// ========================
program
  .command('serve')
  .description('Start web visualization server')
  .option('-p, --port <number>', 'Port number', '8080')
  .option('-w, --watch', 'Enable file watching for live updates')
  .action(async (options) => {
    const { serveCommand } = await import('./commands/serve.js');
    await serveCommand(options);
  });

// ========================
// status command
// ========================
program
  .command('status')
  .description('Show code graph index status')
  .action(async () => {
    const { statusCommand } = await import('./commands/status.js');
    await statusCommand();
  });

// ========================
// export command
// ========================
program
  .command('export')
  .description('Export graph data')
  .option('-f, --format <format>', 'Export format (json|html)', 'json')
  .option('-o, --output <path>', 'Output file path')
  .action(async (options) => {
    const { exportCommand } = await import('./commands/export.js');
    await exportCommand(options);
  });

// ========================
// foam command
// ========================
program
  .command('foam')
  .description('Export code graph as Foam-compatible markdown for VSCode graph visualization')
  .option('-o, --output <path>', 'Output directory (default: .codeatlas/foam)')
  .option('--open', 'Open the Foam folder in VSCode after export')
  .option('--no-source', 'Exclude source code from generated notes')
  .action(async (options) => {
    const { foamCommand } = await import('./commands/foam.js');
    await foamCommand(options);
  });

// ========================
// deps command
// ========================
program
  .command('deps')
  .description('Analyze dependency health: circular deps, unused/unlisted packages')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('--circular', 'Only show circular dependencies')
  .action(async (options) => {
    const { depsCommand } = await import('./commands/deps.js');
    await depsCommand(options);
  });

// ========================
// review command
// ========================
program
  .command('review')
  .description('AI-powered code review (smart mode: ~90% token savings via graph context)')
  .option('--focus <focus>', 'Comma-separated focus areas (security,perf,correctness,readability)', 'correctness,security,perf,readability')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('-d, --depth <number>', 'Max impact depth', '2')
  .option('--smart', 'Use graph-aware context (default: true)')
  .option('--no-smart', 'Use traditional full-source mode')
  .option('--budget <tokens>', 'Token budget for smart mode', '4000')
  .action(async (options) => {
    const { reviewCommand } = await import('./commands/review.js');
    await reviewCommand(options);
  });

// ========================
// guard command
// ========================
program
  .command('guard')
  .description('Architecture gate: enforce rules (circular deps, layer violations, complexity)')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('--install', 'Install as git pre-commit hook')
  .option('--max-depth <number>', 'Max allowed impact depth', '3')
  .option('--no-circular', 'Fail on circular dependencies')
  .action(async (options) => {
    const { guardCommand } = await import('./commands/guard.js');
    await guardCommand(options);
  });

// ========================
// doc command
// ========================
program
  .command('doc')
  .description('Generate documentation skeletons with Mermaid diagrams')
  .option('-o, --output <path>', 'Output directory (default: .codeatlas/docs)')
  .option('--no-source', 'Exclude source code from docs')
  .option('--no-diagrams', 'Exclude Mermaid diagrams')
  .option('-g, --granularity <level>', 'Documentation granularity (file|module)', 'file')
  .action(async (options) => {
    const { docCommand } = await import('./commands/doc.js');
    await docCommand(options);
  });

// ========================
// path command
// ========================
program
  .command('path <source> <target>')
  .description('Find shortest path between two symbols')
  .option('-d, --depth <number>', 'Max path length', '6')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (source, target, options) => {
    const { pathCommand } = await import('./commands/path.js');
    await pathCommand(source, target, options);
  });

// ========================
// agent command
// ========================
program
  .command('agent <description>')
  .description('AI Agent: plan + generate + verify with iterative refinement')
  .option('-t, --target <symbol>', 'Target symbol to focus on')
  .option('--no-verify', 'Skip verification step')
  .option('--budget <tokens>', 'Total token budget', '8000')
  .option('--max-iterations <n>', 'Max refinement iterations', '3')
  .option('--dry-run', 'Plan only, don\'t generate code')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (description, options) => {
    const { agentCommand } = await import('./commands/agent.js');
    await agentCommand(description, options);
  });

// ========================
// trace command (Flowtrace integration)
// ========================
program
  .command('trace <subcommand> [path]')
  .description('Flowtrace integration: load, steps, step, flow, stats, runs')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('--step <step_id>', 'Step ID for step subcommand')
  .action(async (subcommand, tracePath, options) => {
    const { traceCommand } = await import('./commands/trace.js');
    await traceCommand(subcommand, tracePath, options);
  });

// ========================
// embedded command (STM32/ESP32/Linux)
// ========================
program
  .command('embedded <subcommand>')
  .description('Embedded systems analysis: build, tasks, interrupts, hardware')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('-p, --project <path>', 'Project path (default: cwd)')
  .action(async (subcommand, options) => {
    const { embeddedCommand } = await import('./commands/embedded.js');
    await embeddedCommand(subcommand, options);
  });

// ========================
// semantic command (vector search)
// ========================
program
  .command('semantic <subcommand> [query]')
  .description('Semantic search with embeddings: index, search, stats')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('-n, --top <number>', 'Number of results', '10')
  .option('--provider <provider>', 'Embedding provider (local|openai|ollama)', 'local')
  .action(async (subcommand, query, options) => {
    const { semanticCommand } = await import('./commands/semantic.js');
    await semanticCommand(subcommand, query || '', options);
  });

// ========================
// refactor command
// ========================
program
  .command('refactor')
  .description('Detect code smells and generate refactoring suggestions')
  .option('--type <type>', 'Detect specific smell type (god-class|feature-envy|shotgun-surgery|dead-code|high-coupling)')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const { refactorCommand } = await import('./commands/refactor.js');
    await refactorCommand(options);
  });

// ========================
// graph-export command
// ========================
program
  .command('graph-export')
  .description('Export graph data for analysis (JSON, CSV, Mermaid, Matrix, Stats)')
  .option('-f, --format <format>', 'Export format (json|csv|mermaid|matrix|stats)', 'json')
  .option('-o, --output <path>', 'Output file path')
  .option('-l, --layer <layer>', 'Filter by layer')
  .option('-k, --kind <kind>', 'Filter by symbol kind')
  .option('--limit <n>', 'Max nodes to export', '100')
  .option('--stats', 'Show graph statistics only')
  .action(async (options) => {
    const { graphExportCommand } = await import('./commands/graph-export.js');
    await graphExportCommand(options);
  });

// ========================
// diff command
// ========================
program
  .command('diff')
  .description('Compare graph states: show added/removed/moved symbols')
  .option('-b, --baseline <path>', 'Baseline file to compare against')
  .option('-s, --save <path>', 'Save current state as baseline')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const { diffCommand } = await import('./commands/diff.js');
    await diffCommand(options);
  });

// ========================
// flow command
// ========================
program
  .command('flow <symbol>')
  .description('Trace call chain from an entry point')
  .option('-d, --depth <number>', 'Max depth', '5')
  .option('-f, --format <format>', 'Output format (text|mermaid)', 'text')
  .action(async (symbol, options) => {
    const { flowCommand } = await import('./commands/flow.js');
    await flowCommand(symbol, options);
  });

// ========================
// ask command
// ========================
program
  .command('ask <question>')
  .description('Ask natural language question about the code')
  .action(async (question) => {
    const { askCommand } = await import('./commands/ask.js');
    await askCommand(question);
  });

// ========================
// coverage command
// ========================
program
  .command('coverage [symbol]')
  .description('Show test coverage mapping')
  .action(async (symbol) => {
    const { coverageCommand } = await import('./commands/coverage.js');
    await coverageCommand({ symbol });
  });

// ========================
// team command group
// ========================
const team = program
  .command('team')
  .description('Team collaboration features');

team
  .command('export')
  .description('Export team data (annotations, metadata)')
  .option('-o, --output <path>', 'Output file path')
  .action(async (options) => {
    const { teamExportCommand } = await import('./commands/team.js');
    await teamExportCommand(options);
  });

team
  .command('import <file>')
  .description('Import team data from file')
  .action(async (file) => {
    const { teamImportCommand } = await import('./commands/team.js');
    await teamImportCommand(file);
  });

team
  .command('status')
  .description('Show team collaboration status')
  .action(async () => {
    const { teamStatusCommand } = await import('./commands/team.js');
    await teamStatusCommand();
  });

program.parse();
