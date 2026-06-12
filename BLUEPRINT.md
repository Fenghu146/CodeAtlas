# CodeAtlas — 把代码变成可交互的知识地图

> 十分钟看清一个陌生项目的架构，像看地图一样浏览代码。

## 一句话定位

CodeAtlas 是一个代码结构分析 + 可视化工具，用 tree-sitter 解析代码构建知识图谱，用 AI 理解语义，通过 MCP / CLI / Web / VSCode 四种方式交付给开发者。

---

## 核心使用场景

1. **学习开源项目**：从 GitHub clone 下来的代码，跑一遍就能看清模块关系、调用链路、架构分层
2. **接手遗留项目**：没文档没注释的老代码，自动生成结构图谱 + AI 解释
3. **改代码前评估**：分析修改影响范围，知道动一个函数会牵连哪些模块
4. **给团队/客户交付**：附一份可交互的图谱，后续维护的人能快速上手

---

## 技术栈选择

| 层次 | 技术 | 理由 |
|------|------|------|
| **核心引擎** | TypeScript + Node.js | tree-sitter WASM 绑定成熟；和 VSCode 插件、MCP Server 同生态，代码可直接复用 |
| **代码解析** | tree-sitter (web-tree-sitter) | 增量解析、多语言支持（JS/TS/Python/Go/Rust/Java...）、WASM 可在浏览器运行 |
| **图谱存储** | SQLite + FTS5 | 零依赖、嵌入式、FTS5 全文搜索毫秒级响应、单文件方便分发 |
| **AI 分析层** | LLM API (Claude / OpenAI) | 模块解释、层识别、语义理解；支持本地模型 |
| **MCP Server** | @modelcontextprotocol/sdk | 官方 TypeScript SDK，Claude Code / Cursor / QoderWork 直接对接 |
| **CLI** | Commander.js | 轻量，Node.js 生态标准选择 |
| **Web 可视化** | Cytoscape.js + 原生 HTML/TS | 专业图可视化库，交互式缩放/拖拽/高亮，支持自定义布局算法 |
| **VSCode 插件** | VSCode Extension API | TreeView + Webview + CodeLens + Hover Provider |
| **包管理** | pnpm workspace | Monorepo 管理，跨包依赖共享 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      交付层 (Adapters)                       │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │   MCP    │ │   CLI    │ │   Web    │ │ VSCode   │      │
│  │  Server  │ │  Tool    │ │   App    │ │Extension │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
│       │            │            │            │              │
├───────┴────────────┴────────────┴────────────┴──────────────┤
│                     核心引擎 (Core Engine)                    │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Parser    │  │ Graph Builder │  │   AI Analyzer     │  │
│  │             │  │              │  │                   │  │
│  │ tree-sitter │  │ 符号提取     │  │ 层级识别          │  │
│  │ 多语言 WASM │  │ 关系推断     │  │ 模块解释          │  │
│  │ 增量解析    │  │ 层分类       │  │ 语义搜索          │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │               │                    │              │
│  ┌──────┴───────────────┴────────────────────┴───────────┐  │
│  │                  Store (存储层)                        │  │
│  │                                                       │  │
│  │  SQLite: 符号表 / 关系表 / 文件表 / 元数据表           │  │
│  │  FTS5:   全文搜索索引                                 │  │
│  │  Vectors: 语义嵌入 (可选，用于语义搜索)                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
源代码 (.py/.ts/.go/...)
    │
    ▼
[Parser] ─── tree-sitter 解析 ───► AST
    │
    ▼
[Graph Builder] ─── 提取符号和关系 ───► 符号图
    │
    ├──► 识别层级 (interface / business / data / utility)
    │
    ▼
[Store] ─── 写入 SQLite ───► .codeatlas/db.sqlite
    │
    ▼ (可选)
[AI Analyzer] ─── LLM 分析 ───► 模块解释 + 语义嵌入
    │
    ▼
[Adapters] ─── MCP / CLI / Web / VSCode ───► 开发者
```

---

## 数据模型

### symbols（符号表）

```sql
CREATE TABLE symbols (
  id          TEXT PRIMARY KEY,          -- 唯一标识 (file_path:symbol_name:line)
  name        TEXT NOT NULL,             -- 符号名称
  kind        TEXT NOT NULL,             -- 类型: class|function|method|variable|interface|type|enum|module|constant
  file_path   TEXT NOT NULL,             -- 文件路径 (相对于项目根)
  start_line  INTEGER NOT NULL,          -- 起始行
  end_line    INTEGER NOT NULL,          -- 结束行
  start_col   INTEGER,                   -- 起始列
  end_col     INTEGER,                   -- 结束列
  source_code TEXT,                      -- 原始代码
  language    TEXT NOT NULL,             -- 编程语言
  layer       TEXT,                      -- 架构层: interface|business|data|utility
  doc_comment TEXT,                      -- 文档注释 (从代码中提取)
  ai_summary  TEXT,                      -- AI 生成的解释
  complexity  INTEGER,                   -- 圈复杂度
  exported    BOOLEAN DEFAULT FALSE,     -- 是否导出
  metadata    TEXT,                      -- JSON 扩展字段
  created_at  TEXT DEFAULT (datetime('now'))
);
```

### relationships（关系表）

```sql
CREATE TABLE relationships (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES symbols(id),
  target_id   TEXT NOT NULL REFERENCES symbols(id),
  kind        TEXT NOT NULL,             -- calls|imports|extends|implements|contains|uses_type|overrides|exports
  line        INTEGER,                   -- 关系出现的行号
  metadata    TEXT                       -- JSON 扩展字段
);

CREATE INDEX idx_rel_source ON relationships(source_id);
CREATE INDEX idx_rel_target ON relationships(target_id);
CREATE INDEX idx_rel_kind ON relationships(kind);
```

### files（文件表）

```sql
CREATE TABLE files (
  path        TEXT PRIMARY KEY,
  language    TEXT NOT NULL,
  size        INTEGER,
  line_count  INTEGER,
  hash        TEXT,                      -- 文件内容哈希 (用于增量更新检测)
  parsed_at   TEXT,
  metadata    TEXT
);
```

### FTS5 全文搜索索引

```sql
CREATE VIRTUAL TABLE symbols_fts USING fts5(
  name, doc_comment, source_code, ai_summary,
  content='symbols',
  content_rowid='rowid'
);
```

---

## 模块拆分 (Monorepo)

```
codeatlas/
├── packages/
│   ├── core/                    # 核心引擎
│   │   ├── src/
│   │   │   ├── parser/          # tree-sitter 封装
│   │   │   │   ├── index.ts            # 统一入口
│   │   │   │   ├── languages.ts        # 语言注册表 + WASM 加载
│   │   │   │   ├── ast-extractor.ts    # AST → 符号列表
│   │   │   │   └── language-packs/     # 各语言的 tree-sitter WASM
│   │   │   │       ├── tree-sitter-javascript.wasm
│   │   │   │       ├── tree-sitter-typescript.wasm
│   │   │   │       ├── tree-sitter-python.wasm
│   │   │   │       └── ...
│   │   │   ├── graph/           # 图构建
│   │   │   │   ├── builder.ts          # 符号 + 关系 → 图
│   │   │   │   ├── resolver.ts         # 跨文件引用解析
│   │   │   │   ├── layer-classifier.ts # 架构层级分类
│   │   │   │   └── metrics.ts          # 代码度量 (复杂度、耦合度)
│   │   │   ├── store/           # 存储
│   │   │   │   ├── sqlite-store.ts     # SQLite 读写
│   │   │   │   ├── schema.ts           # DDL + 迁移
│   │   │   │   └── queries.ts          # 常用查询封装
│   │   │   ├── analyzer/        # AI 分析
│   │   │   │   ├── llm-client.ts       # LLM 调用封装
│   │   │   │   ├── module-explainer.ts # 模块解释生成
│   │   │   │   ├── impact-analyzer.ts  # 影响分析
│   │   │   │   └── embeddings.ts       # 语义嵌入
│   │   │   ├── scanner/         # 项目扫描
│   │   │   │   ├── file-walker.ts      # 文件遍历 + .gitignore 解析
│   │   │   │   ├── incremental.ts      # 增量扫描
│   │   │   │   └── scanner.ts          # 扫描编排
│   │   │   └── index.ts         # 公共 API 导出
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── mcp-server/              # MCP Server
│   │   ├── src/
│   │   │   ├── server.ts        # MCP Server 入口
│   │   │   ├── tools/           # MCP Tools 定义
│   │   │   │   ├── scan.ts             # codeatlas_scan
│   │   │   │   ├── search.ts           # codeatlas_search
│   │   │   │   ├── node.ts             # codeatlas_node
│   │   │   │   ├── callers.ts          # codeatlas_callers
│   │   │   │   ├── callees.ts          # codeatlas_callees
│   │   │   │   ├── context.ts          # codeatlas_context
│   │   │   │   ├── impact.ts           # codeatlas_impact
│   │   │   │   ├── layers.ts           # codeatlas_layers
│   │   │   │   └── explain.ts          # codeatlas_explain
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                     # 命令行工具
│   │   ├── src/
│   │   │   ├── index.ts         # 入口
│   │   │   └── commands/
│   │   │       ├── scan.ts             # codeatlas scan <path>
│   │   │       ├── search.ts           # codeatlas search <query>
│   │   │       ├── graph.ts            # codeatlas graph [symbol]
│   │   │       ├── info.ts             # codeatlas info <symbol>
│   │   │       ├── impact.ts           # codeatlas impact <symbol>
│   │   │       ├── explain.ts          # codeatlas explain <module>
│   │   │       ├── serve.ts            # codeatlas serve (启动 Web UI)
│   │   │       └── export.ts           # codeatlas export (导出 JSON/HTML)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                     # Web 可视化应用
│   │   ├── index.html           # 单文件入口
│   │   ├── src/
│   │   │   ├── app.ts           # 应用主逻辑
│   │   │   ├── graph-view.ts    # Cytoscape.js 图渲染
│   │   │   ├── search-panel.ts  # 搜索面板
│   │   │   ├── detail-panel.ts  # 节点详情面板
│   │   │   ├── layer-filter.ts  # 层级筛选
│   │   │   ├── code-viewer.ts   # 代码展示 (带高亮)
│   │   │   └── styles.css
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── vscode/                  # VSCode 插件
│       ├── src/
│       │   ├── extension.ts     # 插件入口
│       │   ├── sidebar/         # 侧边栏 TreeView
│       │   ├── webview/         # 图谱 Webview
│       │   ├── providers/       # Hover / CodeLens / Completion
│       │   └── commands/        # 命令注册
│       ├── package.json         # VSCode 插件 manifest
│       └── tsconfig.json
│
├── docs/                        # 文档
│   ├── architecture.md
│   ├── mcp-tools.md
│   └── development.md
│
├── examples/                    # 示例项目
│   └── demo-project/
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

---

## 核心引擎设计详解

### 1. Parser（解析器）

用 web-tree-sitter 的 WASM 版本，好处是核心包可以在 Node.js 和浏览器中通用。

```typescript
// packages/core/src/parser/index.ts
import Parser from 'web-tree-sitter';

export interface ParseResult {
  symbols: Symbol[];
  language: string;
  filePath: string;
}

export class CodeParser {
  private parsers: Map<string, Parser> = new Map();
  
  async initLanguage(lang: string): Promise<void> {
    const parser = new Parser();
    const wasmPath = `./language-packs/tree-sitter-${lang}.wasm`;
    const langModule = await Parser.Language.load(wasmPath);
    parser.setLanguage(langModule);
    this.parsers.set(lang, parser);
  }

  parse(sourceCode: string, filePath: string): ParseResult {
    const lang = detectLanguage(filePath);
    const parser = this.parsers.get(lang);
    const tree = parser.parse(sourceCode);
    return extractSymbols(tree.rootNode, filePath, lang, sourceCode);
  }
}
```

**语言检测策略**：先按文件扩展名，再按 shebang，最后按内容特征。

**符号提取规则**（AST → Symbol）：

| AST 节点类型 | 提取为 |
|---|---|
| `function_declaration` / `function_definition` | function |
| `class_declaration` / `class_definition` | class |
| `method_definition` | method |
| `interface_declaration` | interface |
| `type_alias_declaration` | type |
| `enum_declaration` | enum |
| `variable_declaration` (顶层/导出) | variable |
| `import_statement` / `import_from` | → 生成 import 关系 |
| `call_expression` | → 生成 call 关系 |
| `extends` / `implements` 子句 | → 生成继承关系 |

### 2. Graph Builder（图构建器）

```typescript
// packages/core/src/graph/builder.ts

export class GraphBuilder {
  build(parseResults: ParseResult[]): CodeGraph {
    const graph = new CodeGraph();
    
    // Phase 1: 注册所有符号
    for (const result of parseResults) {
      for (const symbol of result.symbols) {
        graph.addSymbol(symbol);
      }
    }
    
    // Phase 2: 解析跨文件引用
    this.resolveImports(graph);
    
    // Phase 3: 构建调用关系
    this.resolveCallReferences(graph);
    
    // Phase 4: 层级分类
    this.classifyLayers(graph);
    
    return graph;
  }
}
```

**跨文件引用解析**策略：

1. 从 import 语句提取目标路径
2. 解析相对路径 → 绝对路径
3. 处理别名 (tsconfig paths, webpack alias)
4. 匹配到已扫描的文件
5. 精确匹配导出的符号名

### 3. Layer Classifier（层级分类器）

自动识别代码所属的架构层，用规则引擎 + AI 辅助：

```typescript
// packages/core/src/graph/layer-classifier.ts

export type Layer = 'interface' | 'business' | 'data' | 'utility';

const LAYER_RULES: Record<Layer, LayerRule[]> = {
  interface: [
    // 文件路径特征
    { kind: 'path', patterns: ['**/routes/**', '**/controllers/**', '**/views/**', '**/pages/**', '**/components/**', '**/*.controller.*', '**/*.handler.*'] },
    // 代码特征
    { kind: 'decorator', patterns: ['@Controller', '@Get', '@Post', '@Put', '@Delete', '@Route'] },
    { kind: 'import', patterns: ['express', 'fastify', 'koa', 'next/router', 'react-router'] },
    { kind: 'naming', patterns: ['Controller', 'Handler', 'Router', 'Middleware', 'View', 'Page', 'Component'] },
  ],
  business: [
    { kind: 'path', patterns: ['**/services/**', '**/domain/**', '**/models/**', '**/entities/**', '**/usecases/**'] },
    { kind: 'naming', patterns: ['Service', 'Manager', 'Processor', 'Handler', 'UseCase', 'Validator'] },
    { kind: 'import', patterns: ['domain', 'entities', 'models'] },
  ],
  data: [
    { kind: 'path', patterns: ['**/repositories/**', '**/dal/**', '**/database/**', '**/migrations/**', '**/models/**'] },
    { kind: 'import', patterns: ['prisma', 'typeorm', 'sequelize', 'mongoose', 'knex', 'drizzle', 'sqlalchemy'] },
    { kind: 'naming', patterns: ['Repository', 'DAO', 'Mapper', 'Schema', 'Migration'] },
    { kind: 'code', patterns: ['SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ', 'db.', 'query('] },
  ],
  utility: [
    { kind: 'path', patterns: ['**/utils/**', '**/helpers/**', '**/lib/**', '**/common/**', '**/shared/**'] },
    { kind: 'naming', patterns: ['util', 'helper', 'format', 'parse', 'validate', 'transform', 'logger', 'config'] },
    { kind: 'complexity', condition: (s) => s.complexity < 5 },
  ],
};
```

**分类优先级**：interface > data > business > utility。匹配到多条规则时取置信度最高的。匹配不上的标记为 `business`（默认层）。

### 4. AI Analyzer（AI 分析器）

```typescript
// packages/core/src/analyzer/module-explainer.ts

export class ModuleExplainer {
  constructor(private llmClient: LLMClient) {}

  async explainModule(symbols: Symbol[], relationships: Relationship[]): Promise<string> {
    const context = this.buildContext(symbols, relationships);
    
    const prompt = `你是一个资深代码分析师。请分析以下代码模块，用中文回答：

1. 这个模块的核心职责是什么？（一句话）
2. 它对外暴露了哪些关键接口/函数？
3. 它依赖了哪些其他模块？
4. 这个模块的设计模式是什么？

模块代码：
${context}

请用简洁的语言回答，避免技术行话堆砌。`;

    return this.llmClient.complete(prompt);
  }

  async semanticSearch(query: string, symbols: Symbol[]): Promise<Symbol[]> {
    // 方案 A: 用 embedding 做向量相似度搜索
    // 方案 B: 用 LLM 理解 query 后转化为结构化查询
    // Phase 1 先用方案 B，后续加 embedding
  }
}
```

### 5. Scanner（项目扫描器）

```typescript
// packages/core/src/scanner/scanner.ts

export class ProjectScanner {
  constructor(
    private parser: CodeParser,
    private graphBuilder: GraphBuilder,
    private store: SQLiteStore,
  ) {}

  async scan(projectPath: string, options: ScanOptions = {}): Promise<ScanResult> {
    // 1. 发现文件 (尊重 .gitignore)
    const files = await this.discoverFiles(projectPath);
    
    // 2. 过滤支持的类型
    const supportedFiles = files.filter(f => this.isSupported(f));
    
    // 3. 增量检测 (跳过未修改的文件)
    const changedFiles = await this.detectChanges(supportedFiles);
    
    // 4. 初始化需要的语言解析器
    const languages = new Set(changedFiles.map(f => detectLanguage(f)));
    for (const lang of languages) {
      await this.parser.initLanguage(lang);
    }
    
    // 5. 解析所有文件
    const results = [];
    for (const file of changedFiles) {
      const source = await readFile(file, 'utf-8');
      results.push(this.parser.parse(source, file));
    }
    
    // 6. 构建图谱
    const graph = this.graphBuilder.build(results);
    
    // 7. 持久化
    await this.store.save(graph);
    
    return { filesScanned: changedFiles.length, symbolsFound: graph.symbols.length, ... };
  }
}
```

**增量更新策略**：
- 每个文件存内容哈希 (SHA-256)
- 扫描时对比哈希，只重新解析变化的文件
- 删除文件时清理对应的符号和关系
- 关系图在文件变化时局部重建

---

## MCP Tools 设计

这是让 Claude Code / Cursor / QoderWork 等 AI 工具能直接查询代码图谱的关键。

| Tool 名称 | 用途 | 参数 | 返回 |
|---|---|---|---|
| `codeatlas_scan` | 扫描项目，构建/更新图谱 | `{ path: string, incremental?: boolean }` | 扫描统计信息 |
| `codeatlas_search` | 按名称/关键词搜索符号 | `{ query: string, kind?: string, layer?: string }` | 匹配的符号列表 |
| `codeatlas_semantic_search` | 自然语言搜索代码 | `{ query: string }` | 语义相关的符号列表 |
| `codeatlas_node` | 获取单个符号的详细信息 | `{ id: string }` | 符号详情 + 源码 + AI 解释 |
| `codeatlas_callers` | 谁调用了这个符号 | `{ id: string, depth?: number }` | 调用者列表 |
| `codeatlas_callees` | 这个符号调用了谁 | `{ id: string, depth?: number }` | 被调用者列表 |
| `codeatlas_context` | 获取某个任务/区域的上下文 | `{ task: string }` | 相关符号 + 关系 + 架构说明 |
| `codeatlas_impact` | 分析修改影响范围 | `{ id: string, change?: string }` | 受影响的符号和文件列表 |
| `codeatlas_layers` | 查看项目架构分层 | `{ path?: string }` | 层级分类统计和列表 |
| `codeatlas_explain` | AI 解释一个模块/文件 | `{ path: string }` | 模块解释文本 |
| `codeatlas_graph` | 获取图谱数据 (给可视化用) | `{ rootId?: string, depth?: number, layers?: string[] }` | 节点 + 边的 JSON |
| `codeatlas_export_foam` | 导出为 Foam 兼容 Markdown | `{ outputDir?: string, includeSource?: boolean }` | 导出统计 + 使用指南 |

---

## CLI 命令设计

```bash
# 扫描项目
codeatlas scan [path]                   # 扫描当前目录或指定目录
codeatlas scan --full                   # 强制全量扫描 (忽略增量)

# 搜索
codeatlas search "用户登录"              # 语义搜索
codeatlas search "auth" --kind function # 按名称 + 类型过滤
codeatlas search --layer interface      # 按层级筛选

# 查看信息
codeatlas info UserService              # 查看符号详情
codeatlas callers UserService.login     # 谁调用了 login
codeatlas callees UserService.login     # login 调用了谁

# 分析
codeatlas impact UserService            # 影响分析
codeatlas layers                        # 查看架构分层
codeatlas explain src/services/         # AI 解释模块

# 可视化
codeatlas serve                         # 启动 Web UI (默认 localhost:8080)
codeatlas serve --port 3000             # 指定端口
codeatlas export --format html          # 导出为独立 HTML 文件
codeatlas export --format json          # 导出图谱 JSON

# Foam 集成
codeatlas foam                          # 导出为 Foam 兼容 Markdown
codeatlas foam --open                   # 导出并自动打开 VSCode
codeatlas foam --output ./docs/graph    # 导出到自定义目录

# 状态
codeatlas status                        # 查看索引状态
codeatlas stats                         # 项目统计 (文件数、符号数、关系数)
```

---

## Web 可视化设计

### 页面布局

```
┌─────────────────────────────────────────────────────────┐
│  CodeAtlas                           [搜索...] [⚙ 设置] │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  项目概览     │          交互式图谱区域                    │
│              │                                          │
│  📁 128 文件  │    节点大小 = 被引用次数                   │
│  🔷 1.2k 符号 │    节点颜色 = 架构层级                     │
│  🔗 3.4k 关系 │    连线 = 调用/引用关系                    │
│              │                                          │
│  ── 层级筛选  │    [缩放] [全屏] [居中] [导出]            │
│  ☑ 接口层    │                                          │
│  ☑ 业务层    ├──────────────────────────────────────────┤
│  ☑ 数据层    │  节点详情                                  │
│  ☑ 工具层    │                                          │
│              │  📄 UserService                           │
│  ── 文件树   │  类型: class | 层: business                │
│  ▼ src/      │  复杂度: 12 | 引用: 23 处                 │
│    ▼ services│                                          │
│      User... │  AI 解释:                                 │
│      Auth... │  "用户服务类，负责用户的增删改查和          │
│    ▼ models/ │   权限校验。核心方法 login() 接收..."       │
│              │                                          │
│              │  [查看源码] [调用链] [影响分析]              │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
```

### 可视化特性

- **节点颜色映射**：接口层=蓝色，业务层=绿色，数据层=橙色，工具层=灰色
- **节点大小**：按被引用次数 (pagerank) 缩放
- **布局算法**：Force-directed (力导向) 默认；支持层次布局 (Hierarchical)
- **交互**：
  - 点击节点 → 右侧显示详情 + AI 解释
  - 双击节点 → 展开直接关联
  - 拖拽 → 自由移动
  - 滚轮 → 缩放
  - 右键 → 上下文菜单 (查看源码 / 影响分析 / 复制路径)
  - 搜索 → 高亮匹配节点并聚焦
- **代码查看**：点击"查看源码"展开内嵌代码高亮面板 (用 highlight.js 或 Shiki)

---

## VSCode 插件设计

### 功能规划

| 功能 | 实现方式 | 说明 |
|---|---|---|
| 代码结构树 | TreeView Provider (侧边栏) | 按层级 → 文件 → 符号 组织 |
| 图谱可视化 | Webview Panel | 嵌入 Cytoscape.js (复用 web 包) |
| 符号悬停信息 | Hover Provider | 显示符号类型、层级、AI 解释、引用数 |
| 代码引用标注 | CodeLens Provider | 在函数/类上方显示 "↑3 callers · ↓5 callees · business layer" |
| 语义搜索 | 命令面板 + QuickPick | `Ctrl+Shift+P` → "CodeAtlas: Search" |
| 影响分析 | 命令 + 侧边栏展示 | 右键菜单 → "Analyze Impact" |
| 自动扫描 | FileSystemWatcher | 文件保存时自动增量更新图谱 |

### VSCode 命令

```
codeatlas.scan          - 扫描当前工作区
codeatlas.search        - 语义搜索
codeatlas.showGraph     - 打开图谱视图
codeatlas.analyzeImpact - 分析选中符号的影响
codeatlas.explainFile   - AI 解释当前文件
codeatlas.showLayers    - 查看架构分层
```

---

## Foam 集成（替代/增强 VSCode 插件可视化）

### 核心思路

Foam 是 VSCode 上的知识管理插件，原生支持：
- **图谱可视化**：Markdown 文件变节点，`[[wikilinks]]` 变边，支持自定义颜色和分组
- **反向链接面板**：自动发现谁引用了当前文件
- **标签系统**：YAML frontmatter 中的 tags 可用于筛选和分组
- **标签浏览器**：在侧边栏按标签层级浏览

**关键洞察**：如果 CodeAtlas 把代码图谱导出为 Foam 能消化的 Markdown 文件，就能直接借用 Foam 的全部可视化能力，无需自己开发 VSCode 插件的图谱面板。

### 输出格式

```
.codeatlas/foam/
├── _index.md              # 仪表盘：项目统计 + 按层级分类的文件索引
├── files/                 # 每个源代码文件 → 一个 .md 笔记
│   ├── src-index-ts.md
│   ├── src-services-user-service-ts.md
│   └── ...
├── modules/               # 每个目录/模块 → 一个 .md 笔记
│   ├── src.md
│   ├── src-services.md
│   └── ...
└── .vscode/
    └── settings.json      # Foam 图谱配置（自动设好颜色分组）
```

### 文件笔记示例

```markdown
---
tags: [layer/business, lang/typescript, codeatlas/file]
file_path: "src/services/user-service.ts"
layer: "business"
language: "typescript"
---

# user-service.ts

> `src/services/user-service.ts` · 8 symbols · Layer: **business** · Language: typescript

## Symbols

### 🔷 UserService `export`

- **Kind**: class
- **Lines**: 15–120
- **Complexity**: 12

**Depends on:**
- [[src-repositories-user-repository-ts]] — imports → `UserRepository`
- [[src-utils-validator-ts]] — calls → `validate()`

**Used by:**
- [[src-controllers-user-controller-ts]] — calls ← `UserController.getUser`

<details>
<summary>View source (106 lines)</summary>

```typescript
export class UserService { ... }
```

</details>
```

### Foam 图谱配置（自动生成）

导出时自动写入 `.vscode/settings.json`：

```json
{
  "foam.graph.views": {
    "Code Architecture": {
      "colorBy": "tag",
      "groups": [
        { "query": "tag:layer/interface", "color": "#3b82f6", "label": "Interface Layer" },
        { "query": "tag:layer/business", "color": "#22c55e", "label": "Business Layer" },
        { "query": "tag:layer/data",     "color": "#f97316", "label": "Data Layer" },
        { "query": "tag:layer/utility",  "color": "#94a3b8", "label": "Utility Layer" },
        { "query": "tag:codeatlas/module", "color": "#a78bfa", "label": "Modules" }
      ]
    },
    "By Language": {
      "colorBy": "tag",
      "groups": [
        { "query": "tag:lang/typescript", "color": "#3178c6", "label": "TypeScript" },
        { "query": "tag:lang/python",     "color": "#3776ab", "label": "Python" },
        { "query": "tag:lang/go",         "color": "#00add8", "label": "Go" }
      ]
    }
  }
}
```

### 用户体验

```bash
# 1. 扫描项目
codeatlas scan

# 2. 导出为 Foam 格式
codeatlas foam

# 3. 在 VSCode 中打开（自动）
codeatlas foam --open
# → VSCode 打开 .codeatlas/foam/ 文件夹
# → Cmd+Shift+P → "Foam: Show Graph"
# → 看到按架构层着色的交互式图谱！
```

在 Foam 图谱中：
- 🔵 **蓝色节点** = 接口层 (controllers, routes, views)
- 🟢 **绿色节点** = 业务层 (services, domain logic)
- 🟠 **橙色节点** = 数据层 (repositories, models, DB)
- ⚪ **灰色节点** = 工具层 (helpers, utils, config)
- 🟣 **紫色节点** = 模块 (目录级)
- 🟡 **黄色节点** = 仪表盘 (index)

节点之间的连线就是 `[[wikilinks]]`，点击可以跳转到对应的文件笔记查看源码和关系详情。

### Foam 集成 vs 自建 VSCode 插件

| 方面 | Foam 集成 | 自建 VSCode 插件 |
|---|---|---|
| 开发工作量 | 极小（只需生成 Markdown） | 大（需要实现 TreeView、Webview、Hover、CodeLens 等） |
| 图谱可视化 | Foam 原生支持，开箱即用 | 需要嵌入 Cytoscape.js 或自己实现 |
| 反向链接 | Foam 自动发现 | 需要自己实现 |
| 标签/筛选 | Foam 原生 Tag Explorer | 需要自己实现 |
| 与代码编辑器的集成深度 | 中等（跳转到生成文件，不能直接跳转到源码） | 深（Hover、CodeLens、直接跳转源码位置） |
| 可定制性 | 受限于 Foam 的能力 | 完全自由 |

**推荐策略**：Phase 1-3 用 Foam 集成快速获得可视化能力，Phase 5 再考虑自建插件做深度集成（Hover、CodeLens 等 Foam 做不到的功能）。

---

## 功能路线图 (Roadmap)

### 🎯 核心功能 (Core Features)

| 功能 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| AST 解析 | P0 | ✅ | Tree-sitter 多语言支持 |
| 图谱构建 | P0 | ✅ | 符号提取 + 关系推断 |
| SQLite 存储 | P0 | ✅ | FTS5 全文搜索 |
| CLI 工具 | P0 | ✅ | 11 个命令 |
| MCP Server | P0 | ✅ | 8 个 AI 工具 |
| Web 可视化 | P0 | ✅ | Cytoscape.js 交互式图谱 |
| VSCode 扩展 | P0 | ✅ | TreeView + Webview + Hover + CodeLens |
| Foam 导出 | P1 | ✅ | Markdown + 图谱可视化 |

---

### 🤖 AI 增强 (Phase 4)

| 功能 | 描述 | 价值 |
|------|------|------|
| **LLM 摘要生成** | 调用 Claude/OpenAI 为每个模块生成智能解释 | 理解代码意图，不只是结构 |
| **语义搜索** | 自然语言查询 → 结构化搜索 | "找到处理用户认证的代码" |
| **AI 影响分析** | LLM 辅助分析变更影响 | 更精准的风险评估 |
| **自动文档生成** | 基于代码生成 API 文档 | 减少文档维护负担 |
| **代码异味检测** | AI 识别潜在问题 | 主动发现技术债务 |
| **架构建议** | 基于图谱给出重构建议 | 指导代码优化方向 |

```typescript
// 示例：AI 增强的模块解释
interface AIExplainer {
  // 生成模块摘要
  explainModule(symbols: Symbol[], context: string): Promise<string>;
  
  // 语义搜索
  semanticSearch(query: string): Promise<SearchResult[]>;
  
  // 架构分析
  analyzeArchitecture(graph: CodeGraph): Promise<ArchitectureReport>;
  
  // 代码异味检测
  detectCodeSmells(graph: CodeGraph): Promise<CodeSmell[]>;
}
```

---

### 🔄 实时同步 (Phase 4.5)

| 功能 | 描述 | 实现方式 |
|------|------|----------|
| **文件监听** | 保存时自动增量更新 | FileSystemWatcher |
| **增量扫描** | 只解析变化的文件 | 哈希对比 + 部分图重建 |
| **WebSocket 推送** | 图谱变化实时推送到 Web/VSCode | ws + 事件广播 |
| **冲突处理** | 多人同时编辑的合并策略 | Git-like 三方合并 |
| **历史版本** | 图谱变化的时间线 | SQLite 时序存储 |

```typescript
// 实时同步架构
class RealtimeSync {
  private watcher: FileSystemWatcher;
  private wsServer: WebSocketServer;
  private diffEngine: GraphDiffer;
  
  // 文件保存时触发
  async onFileChange(filePath: string): Promise<void> {
    // 1. 增量扫描变化的文件
    const delta = await this.incrementalScan(filePath);
    
    // 2. 计算图谱差异
    const diff = this.diffEngine.compute(delta);
    
    // 3. 更新 SQLite
    await this.store.applyDiff(diff);
    
    // 4. 广播给所有客户端
    this.wsServer.broadcast({ type: 'graph-update', diff });
  }
}
```

---

### 👥 团队协作 (Phase 5)

| 功能 | 描述 | 价值 |
|------|------|------|
| **图谱共享** | 团队成员共享同一份图谱 | 统一的代码理解视角 |
| **标注系统** | 在图谱节点上添加评论/标签 | 知识沉淀 + 讨论 |
| **架构评审** | PR 时自动展示架构变化 | Code Review 增强 |
| **知识库** | 图谱 + 注释形成团队知识库 | 新人快速上手 |
| **权限控制** | 按角色控制读写权限 | 企业级安全 |

```
协作架构：
┌─────────────────────────────────────────────────────────┐
│                    CodeAtlas Cloud                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 图谱存储  │  │ 用户管理  │  │ 权限控制  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       └──────────────┼──────────────┘                    │
│                      ▼                                   │
│              ┌──────────────┐                            │
│              │  Sync Server │                            │
│              └──────┬───────┘                            │
│                     │                                    │
├─────────────────────┼────────────────────────────────────┤
│                     ▼                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  CLI     │  │   Web    │  │ VSCode   │              │
│  │          │  │          │  │ Extension│              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

---

### 🚀 CI/CD 集成 (Phase 5.5)

| 功能 | 描述 | 实现 |
|------|------|------|
| **架构门禁** | PR 时检查架构违规 | GitHub Action / GitLab CI |
| **依赖分析** | 检测循环依赖、层级违规 | 图谱遍历 + 规则引擎 |
| **复杂度监控** | 追踪代码复杂度变化 | 时序对比 + 告警 |
| **变更报告** | 自动生成 PR 的架构影响报告 | diff + 图谱分析 |
| **质量评分** | 架构健康度打分 | 多维度指标聚合 |

```yaml
# .github/workflows/codeatlas.yml
name: CodeAtlas Architecture Check

on: [pull_request]

jobs:
  architecture-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install CodeAtlas
        run: npm install -g codeatlas
      
      - name: Scan PR changes
        run: |
          codeatlas scan
          codeatlas impact --changed-files=${{ github.event.pull_request.changed_files }}
      
      - name: Check architecture rules
        run: |
          # 检查层级违规
          codeatlas check --rule=no-circular-deps
          codeatlas check --rule=layer-interface-cannot-import-data
          
          # 检查复杂度
          codeatlas check --max-complexity=20
          
          # 生成报告
          codeatlas report --format=markdown >> $GITHUB_STEP_SUMMARY
```

---

### 📊 更多可视化 (Phase 6)

| 可视化类型 | 描述 | 适用场景 |
|-----------|------|----------|
| **时序图** | 函数调用的时序关系 | 理解执行流程 |
| **依赖热力图** | 文件/模块的依赖密度 | 识别高耦合区域 |
| **架构桑基图** | 数据在层级间的流动 | 理解数据流 |
| **变更时间线** | 图谱随时间的演化 | 项目演进分析 |
| **贡献者图谱** | 代码所有权可视化 | 团队协作分析 |

```typescript
// 可视化扩展接口
interface VisualizationPlugin {
  name: string;
  render(graph: CodeGraph, options: any): Visualization;
}

// 示例：依赖热力图
class DependencyHeatmap implements VisualizationPlugin {
  name = 'dependency-heatmap';
  
  render(graph: CodeGraph): HeatmapData {
    // 计算每个文件的依赖密度
    const density = graph.files.map(file => ({
      file: file.path,
      inbound: graph.getDependencies(file).length,
      outbound: graph.getDependents(file).length,
      score: this.calculateHeatScore(file, graph),
    }));
    
    return { type: 'heatmap', data: density };
  }
}
```

---

### 🔌 扩展生态 (Phase 7)

| 功能 | 描述 |
|------|------|
| **插件系统** | 支持自定义分析器、可视化、导出器 |
| **语言扩展** | 社区贡献的 Tree-sitter grammar 集成 |
| **IDE 插件** | JetBrains / Vim / Emacs 支持 |
| **API 开放** | RESTful API 供第三方集成 |
| **Webhook** | 图谱变化事件通知 |

---

## 开发路线图

### Phase 1: 核心引擎 MVP（预计 1-2 周）

目标：能扫描一个 JS/TS 项目，提取符号和关系，存入 SQLite，CLI 可查。

- [ ] 初始化 monorepo (pnpm workspace + TypeScript 配置)
- [ ] 实现 tree-sitter 解析器封装 (JS + TS)
- [ ] 实现 AST → Symbol 提取器
- [ ] 实现基础图构建器 (文件内关系)
- [ ] 实现 SQLite 存储层 + FTS5
- [ ] 实现 CLI 基础命令 (scan / search / info)
- [ ] 用一个真实项目测试

### Phase 2: MCP + 跨文件分析 + Foam 集成（预计 1-2 周）

目标：MCP Server 可用，Claude Code 能直接查询图谱；Foam 导出可在 VSCode 中可视化。

- [ ] 实现跨文件 import 解析
- [ ] 实现调用链分析 (callers / callees)
- [ ] 实现层级分类器
- [ ] 实现 MCP Server (10 个 tools，含 foam 导出)
- [ ] 实现 FoamExporter（Markdown + Foam settings 生成）
- [ ] 在 VSCode + Foam 中测试图谱可视化
- [ ] 在 Claude Code 中测试 MCP 集成
- [ ] 添加 Python 语言支持

### Phase 3: Web 可视化（预计 1-2 周）

目标：`codeatlas serve` 启动交互式图谱网页。

- [ ] 搭建 Vite + 原生 TS 项目
- [ ] 集成 Cytoscape.js 图渲染
- [ ] 实现搜索面板 + 详情面板
- [ ] 实现层级筛选 + 颜色映射
- [ ] 实现代码查看面板 (语法高亮)
- [ ] 响应式布局优化

### Phase 4: AI 增强（预计 1 周）

目标：接入 LLM，实现语义搜索和自动解释。

- [ ] 实现 LLM Client 封装 (支持 Claude / OpenAI / 本地模型)
- [ ] 实现模块解释器 (explain)
- [ ] 实现语义搜索 (query → 结构化查询)
- [ ] 实现 AI 辅助影响分析
- [ ] 批量生成模块说明文档

### Phase 5: VSCode 深度集成（可选，预计 1-2 周）

目标：在 VSCode 内提供 Foam 做不到的深度集成功能。Foam 已覆盖基础可视化，此阶段专注增强。

- [ ] Hover Provider（悬停显示符号层级、AI 解释、引用数）
- [ ] CodeLens Provider（函数上方显示 "↑3 callers · ↓5 callees · business layer"）
- [ ] 右键菜单：Analyze Impact → 侧边栏展示影响范围
- [ ] FileSystemWatcher 自动增量扫描
- [ ] 可选：TreeView 侧边栏结构树（比 Foam Tag Explorer 更贴合代码场景）

### Phase 6: 多语言 + 打磨（持续）

- [ ] Go / Rust / Java 语言支持
- [ ] 增量扫描优化
- [ ] 大型项目性能优化 (>10 万行)
- [ ] 导出功能 (HTML / JSON / PNG)
- [ ] 配置系统 (.codeatlas.yaml)

---

## 关键设计决策

### 为什么选 SQLite 而不是图数据库？

- **零部署**：不需要装 Neo4j / Redis，一个文件搞定
- **够用**：代码图谱规模通常在几千到几万节点，SQLite 完全 hold 住
- **便携**：`.codeatlas/db.sqlite` 跟着项目走，git add 即可分享
- **FTS5**：内置全文搜索，不需要 ElasticSearch
- **性能**：10 万条记录的 JOIN 查询 <10ms

### 为什么用 tree-sitter 而不是正则/LSP？

- **准确**：真正的 AST 解析，不是字符串匹配
- **增量**：文件改了只重新解析变化的部分
- **多语言**：同一套 API 解析几十种语言
- **WASM**：可以在浏览器里跑 (Web 版复用)
- **容错**：语法错误的文件也能部分解析

### 为什么 TypeScript 而不是 Python 做核心？

- tree-sitter WASM 在 Node.js 生态最成熟
- VSCode 插件必须用 TypeScript
- MCP 官方 SDK 有 TypeScript 版
- 核心逻辑写一次，四个适配器都能用
- AI 分析层可以单独用 Python（作为 sidecar 进程）

---

## 配置文件格式 (.codeatlas.yaml)

```yaml
# 项目根目录下的配置文件
name: my-project
version: "1.0"

# 扫描配置
scan:
  include:
    - src/**
    - lib/**
  exclude:
    - node_modules/**
    - dist/**
    - "**/*.test.*"
    - "**/*.spec.*"
  languages:
    - javascript
    - typescript
    - python

# 层级分类自定义
layers:
  interface:
    paths:
      - "src/api/**"
      - "src/pages/**"
  business:
    paths:
      - "src/services/**"
      - "src/domain/**"
  data:
    paths:
      - "src/db/**"
      - "src/repositories/**"

# AI 配置
ai:
  provider: claude          # claude | openai | local
  model: claude-sonnet-4-20250514
  autoExplain: true         # 扫描后自动生成模块解释
  batchSize: 10             # 每批分析的模块数

# MCP Server 配置
mcp:
  autoScan: true            # 启动时自动增量扫描
  watchChanges: true        # 监听文件变化
```

---

## 和现有工具的关系

### vs CodeGraph MCP (你已有的)

CodeGraph 是个很好的参考和起点。CodeAtlas 的区别在于：
- **可视化**：CodeGraph 没有 Web UI，CodeAtlas 有交互式图谱
- **AI 层**：CodeGraph 是纯结构查询，CodeAtlas 加了语义理解和自动解释
- **多形态**：CodeGraph 只是 MCP，CodeAtlas 四端覆盖
- **建议**：可以先参考 CodeGraph 的 tree-sitter 集成方式，快速启动

### vs Sourcetrail (已停止维护)

Sourcetrail 是个很好的参考产品，但它：
- 只支持 C/C++/Java/Python
- 没有 AI 能力
- 不是 MCP/插件形态
- 代码库已经过时

### vs Bloop / Sourcegraph

这些是云端代码搜索工具，CodeAtlas 的区别：
- **本地优先**：不上传代码，隐私安全
- **离线可用**：核心功能不需要网络
- **AI 原生**：不是搜索框，是 AI 驱动的理解

---

## 快速开始（预期体验）

```bash
# 安装
npm install -g codeatlas

# 克隆一个想学习的开源项目
git clone https://github.com/expressjs/express.git
cd express

# 扫描 (首次约 1-3 分钟)
codeatlas scan

# 打开可视化
codeatlas serve
# → 浏览器打开 http://localhost:8080

# 或者在 Claude Code 中直接使用 (需配置 MCP)
# Claude Code 会自动调用 codeatlas_* 工具来理解代码
```

```bash
# 在 VSCode + Foam 中（推荐方式）
# 1. 确保 VSCode 已安装 Foam 插件
# 2. 扫描项目
codeatlas scan
# 3. 导出为 Foam 格式并打开
codeatlas foam --open
# 4. VSCode 打开 .codeatlas/foam/ 文件夹
# 5. Cmd+Shift+P → "Foam: Show Graph"
# 6. 看到按架构层着色的交互式图谱！
# 7. 点击节点查看源码和关系，查看反向链接面板
```

```bash
# 在 Claude Code 中（AI 辅助方式）
# 配置 MCP Server 后，Claude Code 自动获得 codeatlas_* 工具
# 直接问："帮我分析这个项目的架构"
# Claude 会自动调用 scan + layers + context 工具来回答
```
