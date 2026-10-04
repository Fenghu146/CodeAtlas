# Changelog

All notable changes to CodeAtlas are documented here. The project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic
versioning.

## [Unreleased]

### Fixed
- **Containment edges cover every member kind** (properties, nested types,
  namespace-level functions, trait/interface methods) and resolve by
  name + parentName so same-named members of sibling types never cross-link
- **Rust/C++ generic arguments never leak into parent names** (`Wrapper<T>` is
  `Wrapper`), so methods attach to their generic type again
- **Python `@property` accessors classify as `property`** (getter/setter/deleter
  collapse to the property), not as methods
- **Decorators**: stacked decorators each emit a `decorates` edge;
  attribute decorators (`@radius.setter`) no longer resolve to `unknown`
- **C++ namespace members report their namespace as parent** (`svc -> UserService`
  containment)

### Changed
- Language fixture suite extended to 24 cases with containment and
  negative-classification assertions (284 tests total)
- **Import relationships now link imported symbol names** (`import { X } from` / `from m import X` → `X`), enabling cross-file `impact` tracing (previously named imports produced no resolvable edges)
- README: tool/command/test counts corrected to the current state (30 CLI commands, 28 MCP tools, 279 tests)

## [0.1.0] — 2026-10-03

First public release. CodeAtlas turns a source tree into a queryable symbol
graph — a CLI for humans, an MCP server for coding agents, a VS Code
extension, and a web view — over one shared core.

### Core

- **Language extraction** for TypeScript/JavaScript, Python, Java, Rust,
  C, and C++ via tree-sitter grammars. Scope-aware binding extraction:
  module/class scope introduces names, function-local bindings are skipped,
  `self.attr` / `this.x` / `@ivar` initialize properties.
- **Symbol graph** with calls, references, imports, inheritance, and
  `contains` edges; per-symbol complexity, doc comments, and parent
  membership persisted across incremental scans.
- **Incremental scan** with a correct library-level delta report and stale
  cleanup for files removed on disk.
- **Parser worker pool**: long-lived, recyclable child-process workers isolate
  web-tree-sitter's WASM memory (cgroup-aware concurrency budget) so large
  trees parse without exhausting the host.
- **Semantic search** over a local hash embedding index (no API key needed),
  with optional remote embedding providers; vector and AI rerank modes.

### CLI

30 commands across scan/search/info/callers/callees/impact/layers/embedded/
agent/review/diff/doc/export/trace/team. `--project` is honored everywhere;
missing indexes fail loudly instead of silently reporting empty results.

### MCP server

28 tools with MCP `annotations` (read-only / mutating / open-world hints) so
agents can gate safely. Tools are grouped by action family (`semantic_search`,
`calls`, `annotate`, `trace`, `agent_execute`, `embedded`, `graph_export`).
Qualified symbol names (`Class.method`) resolve unambiguously.

### VS Code extension

Bundled extension (esbuild, CJS) shipping the core parser worker and all WASM
grammars in a single `.vsix`; runtime assets resolve through `assetDir()` so
the bundle finds its grammars and worker regardless of module shape.

### Web

Static graph viewer with a typed API client; `npm run typecheck` covers the
package.

### Testing

274 tests across core, MCP (stdio session against the real server), CLI (e2e
through the real binary), and web, plus five-language extraction fixtures and
an "a symbol name is never a type" regression guard.

[0.1.0]: https://github.com/Fenghu146/CodeAtlas/releases/tag/v0.1.0