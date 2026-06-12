// ============================================================
// @codeatlas/core - Core Engine
// ============================================================
// The heart of CodeAtlas: parsing, graph building, storage, and analysis.
// All adapters (MCP, CLI, Web, VSCode) consume this package.

export { CodeParser } from './parser/index.js';
export type { ParseResult, ParsedSymbol } from './parser/index.js';

export { GraphBuilder } from './graph/builder.js';
export { LayerClassifier } from './graph/layer-classifier.js';
export type { CodeGraph, Symbol, Relationship, Layer, SymbolKind, RelationshipKind } from './graph/types.js';

export { SQLiteStore } from './store/sqlite-store.js';
export type { StoreConfig } from './store/sqlite-store.js';

export { ModuleExplainer } from './analyzer/module-explainer.js';
export { ImpactAnalyzer } from './analyzer/impact-analyzer.js';
export { FlowAnalyzer } from './analyzer/flow-analyzer.js';
export { AskAnalyzer } from './analyzer/ask-analyzer.js';
export { CoverageAnalyzer } from './analyzer/coverage-analyzer.js';
export { DepAnalyzer } from './analyzer/dep-analyzer.js';
export type { DepHealthResult, CircularDep } from './analyzer/dep-analyzer.js';
export { ReviewAnalyzer } from './analyzer/review-analyzer.js';
export type { ReviewResult, ReviewFinding, ReviewOptions } from './analyzer/review-analyzer.js';
export { ContextBuilder } from './analyzer/context-builder.js';
export type { ReviewContext, ContextBuilderOptions, StaticFinding } from './analyzer/context-builder.js';
export { GuardAnalyzer } from './analyzer/guard-analyzer.js';
export type { GuardConfig, GuardResult, GuardViolation } from './analyzer/guard-analyzer.js';
export { PathFinder } from './analyzer/path-finder.js';
export type { PathResult } from './analyzer/path-finder.js';
export { AgentRuntime } from './analyzer/agent-runtime.js';
export type { AgentTask, AgentPlan, AgentResult, SubTask, ToolCall, AgentMemory } from './analyzer/agent-runtime.js';
export { SmellDetector } from './analyzer/smell-detector.js';
export type { CodeSmell, SmellType } from './analyzer/smell-detector.js';
export { RefactorEngine } from './analyzer/refactor-engine.js';
export type { RefactorSuggestion, RefactorStep, RefactorReport } from './analyzer/refactor-engine.js';
export { DiffAnalyzer } from './analyzer/diff-analyzer.js';
export type { DiffResult } from './analyzer/diff-analyzer.js';
export { createLLMClient, CachedLLMClient } from './analyzer/llm-client.js';
export type { LLMClient } from './analyzer/llm-client.js';

export { ProjectScanner } from './scanner/scanner.js';
export type { ScanOptions, ScanResult } from './scanner/scanner.js';

export { FileWatcher } from './scanner/file-watcher.js';
export type { WatcherOptions, FileChangeEvent } from './scanner/file-watcher.js';

export { FoamExporter } from './export/foam-exporter.js';
export type { FoamExportOptions } from './export/foam-exporter.js';
export { DocExporter } from './export/doc-exporter.js';
export type { DocExportOptions, DocExportResult } from './export/doc-exporter.js';
export { GraphExporter } from './export/graph-exporter.js';
export type { ExportFormat, GraphExportOptions, GraphStats } from './export/graph-exporter.js';
export { TraceReader } from './trace/trace-reader.js';
export type { TraceSpec, RunState, StructuredOutput, TraceData, TraceStepWithContext, ExecutionStats } from './trace/types.js';
export { TraceAnalyzer } from './analyzer/trace-analyzer.js';
export type { HotPath, FailurePattern, ExecutionDiff, TraceAnalysisResult } from './analyzer/trace-analyzer.js';
export { TraceAgent } from './analyzer/trace-agent.js';
export type { TraceAgentTask, TraceAgentResult } from './analyzer/trace-agent.js';
export { BuildAnalyzer } from './analyzer/build-analyzer.js';
export type { BuildConfig, LibraryInfo } from './analyzer/build-analyzer.js';
export { EmbeddedAnalyzer } from './analyzer/embedded-analyzer.js';
export type { RTOSTask, InterruptHandler, HardwareAccess, EmbeddedAnalysisResult } from './analyzer/embedded-analyzer.js';
export { HashEmbeddingGenerator, OpenAIEmbeddingGenerator, OllamaEmbeddingGenerator, createEmbeddingGenerator } from './search/embedding.js';
export type { EmbeddingGenerator } from './search/embedding.js';
export { VectorStore } from './search/vector-store.js';
export type { SearchResult as VectorSearchResult } from './search/vector-store.js';
export { HybridSearch } from './search/hybrid-search.js';
export type { HybridResult, HybridSearchOptions } from './search/hybrid-search.js';
export { AgentOrchestrator } from './agent/orchestrator.js';
export type { TaskDAG, OrchestrationResult } from './agent/orchestrator.js';

export { exportTeamData, importTeamData, loadTeamData, saveTeamData, summarizeTeamData } from './export/team-export.js';
export type { TeamData, AnnotationData, ExportOptions } from './export/team-export.js';

export { loadConfig, getAIConfig } from './config/config-loader.js';
export type { CodeAtlasConfig, AIConfig } from './config/config-loader.js';

export { SmartContextBuilder } from './analyzer/smart-context.js';
export { BatchAnalyzer } from './analyzer/batch-analyzer.js';
export { SmartCache } from './cache/smart-cache.js';
