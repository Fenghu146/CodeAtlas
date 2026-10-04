<div align="center">

# 🗺️ CodeAtlas

**把代码变成可交互的知识地图 — 十分钟看清一个陌生项目的架构。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.13.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-279%20passing-brightgreen)](#-开发)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[简介](#-项目简介) · [特性](#-核心特性) · [架构](#-技术架构) · [快速开始](#-快速开始) · [CLI](#-cli-命令) · [MCP](#-mcp-工具) · [开发](#-开发)

</div>

---

## 📖 项目简介

CodeAtlas 是一个**代码结构分析与可视化工具**。它用 [Tree-sitter](https://tree-sitter.github.io/) 解析代码构建符号级知识图谱，用 AI 理解语义，并通过 **CLI / MCP Server / Web / VSCode** 四种方式交付给开发者。

它要回答的问题很朴素：

- 这个陌生项目由哪些模块组成，谁依赖谁？
- 我改这个函数，会牵连到哪些代码？
- 这段逻辑到底在做什么（而不只是它叫什么）？
- 项目的架构分层是否健康，有没有违规依赖和坏味道？

### 适用场景

| 场景 | 价值 |
|------|------|
| **学习开源项目** | clone 下来跑一遍，即可看清模块关系、调用链路与架构分层 |
| **接手遗留项目** | 没文档、没注释的老代码，自动生成结构图谱 + AI 解释 |
| **改动前评估** | 分析修改影响范围，知道动一个符号会牵连哪些模块 |
| **团队 / 客户交付** | 附一份可交互的图谱与文档骨架，后来者快速上手 |
| **CI 架构门禁** | 在 PR 中自动校验分层违规、循环依赖与复杂度 |

> CodeAtlas 是**本地优先**的：代码不上传，核心功能离线可用，`.codeatlas/db.sqlite` 随项目走。

---

## ✨ 核心特性

- 🔍 **多语言解析** — 基于 Tree-sitter WASM，支持 **12 种语言**（JS/TS/TSX/Python/Go/Rust/Java/Ruby/PHP/C#/C/C++），准确提取符号与关系
- 🕸️ **知识图谱** — 自动构建符号关系图，支持调用链、影响分析、最短路径、执行流追踪
- 🏗️ **架构分层** — 加权规则引擎自动识别 `interface / business / data / utility` 四层，支持 YAML 自定义规则
- ⚡ **增量扫描** — 基于 SHA-256 内容哈希检测变更，只重新解析变化的文件
- 🔎 **语义搜索** — 向量嵌入 + 混合检索（关键词 / 向量 / 图谱三路融合），按**含义**找代码
- 🤖 **AI 增强** — LLM 驱动的模块解释、代码审查、影响评估；smart context 可省约 **90% token**
- 🛡️ **质量与门禁** — 依赖健康、循环依赖、坏味道检测、重构建议、架构守护（`guard`）
- 🧠 **代码 Copilot** — 自然语言问答，16 类意图识别 + 多轮会话记忆，纯规则意图识别零 LLM 成本
- 🎯 **Agent 自主编码** — `plan → generate → verify` 迭代，以及多 Agent 任务编排
- 🔄 **执行感知** — 集成 Flowtrace 运行时数据，结合静态图谱分析热路径与失败模式
- 🔧 **嵌入式支持** — 面向 STM32 / ESP32 / 嵌入式 Linux，识别 RTOS 任务、中断、外设、Kbuild/设备树等
- 💻 **多端交付** — CLI（30 命令）/ MCP Server（28 工具）/ Web / VSCode 扩展
- 📤 **多格式导出** — JSON / CSV / Mermaid / 邻接矩阵 / Foam 知识库 / 文档骨架

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                       交付层 (Adapters)                      │
│                                                             │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│   │   MCP    │ │   CLI    │ │   Web    │ │ VSCode   │       │
│   │  Server  │ │  (30 命令)│ │ Cytoscape│ │Extension │       │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│        └────────────┴────────────┴────────────┘             │
├─────────────────────────────────────────────────────────────┤
│                   核心引擎 (@codeatlas/core)                  │
│                                                             │
│   ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│   │   Parser    │  │ Graph Builder│  │   Analyzers       │  │
│   │ tree-sitter │  │  符号 / 关系  │  │ 影响·依赖·评审     │  │
│   │  12 语言    │  │  分层分类     │  │ 守卫·坏味道·Agent  │  │
│   └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│          └────────────────┼───────────────────┘             │
│   ┌───────────────────────┴───────────────────────────────┐ │
│   │              Store — node:sqlite (内置，零依赖)         │ │
│   │  symbols · relationships · files · annotations …       │ │
│   └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
源代码 (.ts/.py/.go/.c/…)
   │
   ▼
[Parser]        Tree-sitter 解析 → AST → 符号 + 文件内关系
   │
   ▼
[Graph Builder] 注册符号 → 解析跨文件 import → 推断调用/继承 → 分层分类
   │
   ▼
[Store]         写入 .codeatlas/db.sqlite（支持批量 / 流式插入）
   │
   ├──▶ [Search]    嵌入 + 向量库 + 混合检索
   ├──▶ [Analyzers] 影响 / 依赖 / 评审 / 守卫 / 坏味道 / Agent
   └──▶ [Exporters] JSON / Mermaid / Foam / 文档 / 团队数据
   │
   ▼
[Adapters]      CLI · MCP · Web · VSCode
```

### 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 核心引擎 | TypeScript + Node.js (ESM) | 与 MCP / VSCode 同生态，核心逻辑一次编写四端复用 |
| 代码解析 | `web-tree-sitter` + WASM 语法包 | 增量、容错、可跨 Node/浏览器，预置 12 种语言 |
| 图谱存储 | **Node.js 内置 `node:sqlite`** | 零外部依赖、单文件、WAL 模式；无需编译原生模块 |
| 符号检索 | SQLite `LIKE` 查询 | 轻量、始终可用；语义检索由向量层补足 |
| 向量搜索 | 本地哈希嵌入 / OpenAI / Ollama | 默认本地 FNV-1a 特征哈希（256 维），零依赖可用 |
| AI 分析 | Claude / OpenAI / Ollama | 统一 `LLMClient` 接口，支持 system/user 分离与缓存 |
| MCP Server | `@modelcontextprotocol/sdk` | 官方 TypeScript SDK，stdio 传输，`codeatlas_*` 工具 |
| CLI | Commander.js | 轻量、动态 `import` 保证启动速度 |
| Web 可视化 | Cytoscape.js + Vite | 力导向/层次布局，层级着色、交互式详情面板 |
| VSCode 扩展 | VSCode Extension API | TreeView + Webview + Hover + CodeLens |
| 包管理 | pnpm workspaces | Monorepo，跨包 `workspace:*` 依赖共享 |
| 测试 | Vitest | 单元 + 集成 + 性能测试，共 279 个用例 |

---

## 📦 目录结构

```
CodeAtlas/
├── packages/
│   ├── core/                     # @codeatlas/core — 核心引擎
│   │   └── src/
│   │       ├── parser/           # Tree-sitter 封装 + 12 种语言 WASM 语法包
│   │       ├── graph/            # 图谱构建、分层分类、类型定义
│   │       ├── store/            # node:sqlite 持久层（symbols/relationships/files/…）
│   │       ├── scanner/          # 文件遍历、增量扫描、文件监听、C/C++ 宏扫描
│   │       ├── analyzer/         # 20+ 分析器（影响/依赖/评审/守卫/坏味道/Agent/嵌入式…）
│   │       ├── search/           # 嵌入生成、向量库、混合检索
│   │       ├── copilot/          # 自然语言问答（意图识别 + flows + 会话）
│   │       ├── agent/            # 多 Agent 任务编排（DAG）
│   │       ├── trace/            # Flowtrace 运行时数据读取
│   │       ├── export/           # Foam / 文档 / 图数据 / 团队数据导出
│   │       ├── config/           # .codeatlas.yaml 加载与合并
│   │       ├── cache/            # 基于哈希的智能缓存
│   │       ├── utils/            # 协议安全日志器等
│   │       └── index.ts          # 公共 API 出口
│   ├── cli/                      # @codeatlas/cli — codeatlas 命令行（30 个命令）
│   │   └── src/{index.ts,commands/*}
│   ├── mcp-server/               # @codeatlas/mcp-server — MCP Server（28 个工具）
│   │   └── src/server.ts
│   ├── web/                      # @codeatlas/web — Cytoscape.js 可视化
│   │   └── {index.html, src/app.ts, src/styles.css}
│   └── vscode/                   # @codeatlas/vscode — VSCode 扩展
│       └── src/{extension,tree-provider,webview-provider,hover-provider,codelens-provider}.ts
├── .codeatlas.yaml.example       # 配置示例
├── BLUEPRINT.md                  # 详细设计文档
├── CONTRIBUTING.md               # 贡献指南
├── tsconfig.base.json            # 共享 TS 配置
├── vitest.config.ts              # 测试配置
└── README.md
```

---

## 🚀 快速开始

### 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | **>= 22.13.0** | 核心使用内置 `node:sqlite`，该版本起无需 `--experimental-sqlite` 标志 |
| **pnpm** | >= 9 | `corepack enable` 或 `npm i -g pnpm` |

### 从源码构建

```bash
git clone https://github.com/Fenghu146/CodeAtlas.git
cd CodeAtlas
pnpm install     # 安装全部工作区依赖
pnpm build       # 构建所有包（core → cli / mcp-server / vscode / web）
```

构建完成后即可运行 CLI：

```bash
node packages/cli/dist/index.js --help

# （可选）注册为全局命令 codeatlas
cd packages/cli && pnpm link --global && cd ../..
codeatlas --help
```

### 三步上手

```bash
cd /path/to/your/project

# 1. 扫描项目，构建知识图谱（写入 .codeatlas/db.sqlite）
codeatlas scan

# 2. 启动 Web 可视化，浏览器打开 http://localhost:8080
codeatlas serve

# 3. 或直接在终端查询
codeatlas search "UserService"
codeatlas impact UserService
```

### 在 Claude Code / Cursor 中使用（MCP）

在 MCP 客户端配置文件中注册 Server（`claude_desktop_config.json` / `.cursor/mcp.json` 等）：

```json
{
  "mcpServers": {
    "codeatlas": {
      "command": "node",
      "args": [
        "/absolute/path/to/CodeAtlas/packages/mcp-server/dist/server.js",
        "--project",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

配置后，AI 助手即可自动调用 `codeatlas_*` 工具来理解你的代码：

```
你：帮我分析这个项目的架构
→ Claude 自动调用 codeatlas_scan → codeatlas_layers → codeatlas_context 后作答
```

### 在 VSCode 中使用

```bash
cd packages/vscode
pnpm build
# 在 VSCode 中按 F5 调试运行，或使用 vsce package 打包安装
```

扩展提供：代码结构树、架构分层视图、交互式图谱 Webview、符号悬停信息、CodeLens（↑callers / ↓callees / 层级徽章）。

---

## 🛠️ CLI 命令

> 完整参数见 `codeatlas <command> --help`。

### 扫描与查询

| 命令 | 说明 |
|------|------|
| `codeatlas scan [path]` | 扫描项目并构建图谱（`--full` 全量 / `--ai` 启用 AI 解释 / `--exclude` 排除目录 / `--report` 生成健康报告） |
| `codeatlas search <query>` | 按名称/关键词搜索符号，支持 `\|` 多词 OR 与 kind/layer/file 过滤 |
| `codeatlas info <symbol>` | 查看符号详情（源码、复杂度、AI 摘要、出入关系） |
| `codeatlas status` | 查看索引状态（文件/符号/关系数、数据库大小） |

### 关系与影响分析

| 命令 | 说明 |
|------|------|
| `codeatlas callers <symbol>` | 查找调用者 |
| `codeatlas callees <symbol>` | 查找被调用者 |
| `codeatlas impact <symbol>` | 影响分析（支持模糊匹配，`-d` 指定深度） |
| `codeatlas path <source> <target>` | 查找两个符号间的最短路径 |
| `codeatlas flow <symbol>` | 从入口追踪调用链（可输出 Mermaid） |
| `codeatlas deps` | 依赖健康分析（循环依赖 / 未使用 / 未声明包） |

### 架构与可视化

| 命令 | 说明 |
|------|------|
| `codeatlas layers` | 查看架构分层（`--by-file` 输出文件级聚合表） |
| `codeatlas hotspots` | 热点分析（高复杂度 / 高频调用符号） |
| `codeatlas serve` | 启动 Web 可视化服务器（`-p` 端口、`-w` 实时监听） |
| `codeatlas export` | 导出图谱为 JSON / 独立 HTML |
| `codeatlas graph-export` | 导出为 json / csv / mermaid / matrix / stats |
| `codeatlas foam` | 导出为 Foam 兼容 Markdown（`--open` 自动打开 VSCode 图谱） |
| `codeatlas doc` | 生成文档骨架（含 Mermaid 依赖图） |

### 质量与门禁

| 命令 | 说明 |
|------|------|
| `codeatlas review` | AI 代码审查（`--smart` 用图谱上下文省约 90% token） |
| `codeatlas guard` | 架构守护：循环依赖 / 分层违规 / 复杂度（`--install` 装为 pre-commit 钩子） |
| `codeatlas refactor` | 代码坏味道检测与重构建议 |
| `codeatlas diff` | 图谱状态对比（新增 / 删除 / 移动符号；`--save` 保存基线） |
| `codeatlas coverage` | 测试覆盖映射 |

### AI 与 Agent

| 命令 | 说明 |
|------|------|
| `codeatlas ask <question>` | 自然语言代码问答（`-m deep` 深度分析、`-s` 多轮会话） |
| `codeatlas agent <task>` | 自主编码：plan → generate → verify（`--dry-run` 仅生成计划） |
| `codeatlas semantic <sub>` | 语义搜索：`index` / `search` / `stats`（`--provider local\|openai\|ollama`） |

### 嵌入式与执行感知

| 命令 | 说明 |
|------|------|
| `codeatlas embedded <sub>` | 嵌入式分析：`build` / `tasks` / `interrupts` / `hardware` / `linux` / `drivers` / `devicetree` / `kconfig` / `interfaces` |
| `codeatlas trace <sub>` | Flowtrace 集成：`load` / `steps` / `step` / `flow` / `stats` / `runs` / `analyze` |

### 团队协作

| 命令 | 说明 |
|------|------|
| `codeatlas team export` | 导出团队数据（标注、元数据） |
| `codeatlas team import <file>` | 导入团队数据 |
| `codeatlas team status` | 查看团队协作状态 |

---

## 🤖 MCP 工具

注册 MCP Server 后，AI 工具可使用以下 **28 个** `codeatlas_*` 工具（高频/只读工具已标注 MCP annotations，客户端可安全自动放行）。

### 图谱查询

| 工具 | 用途 |
|------|------|
| `codeatlas_scan` | 扫描项目，构建/更新图谱 |
| `codeatlas_search` | 按名称/关键词搜索符号 |
| `codeatlas_node` | 获取符号详情（含源码、层级、AI 摘要） |
| `codeatlas_calls` | 查找调用者/被调用者（`direction`: in/out/both） |
| `codeatlas_context` | 获取任务上下文（支持任务描述或符号名） |
| `codeatlas_impact` | 影响分析（支持名称/ID/模糊匹配） |
| `codeatlas_path` | 查找两符号间最短路径 |
| `codeatlas_layers` | 查看架构分层 |
| `codeatlas_graph` | 获取可视化图谱数据（nodes + edges） |
| `codeatlas_summary` | 项目概览 |
| `codeatlas_hotspots` | 热点分析 |
| `codeatlas_changes` | 最近修改的文件与符号 |
| `codeatlas_set_project` | 切换 Server 到另一个项目 |

### 代码质量

| 工具 | 用途 |
|------|------|
| `codeatlas_review` | AI 代码审查（smart mode） |
| `codeatlas_guard` | 架构规则检查，返回 pass/fail |
| `codeatlas_refactor` | 代码坏味道检测 |
| `codeatlas_deps` | 依赖健康分析 |
| `codeatlas_diff` | 图谱状态对比 |
| `codeatlas_graph_export` | 多格式导出（JSON/CSV/Mermaid/矩阵/统计/Foam vault） |

### AI / Agent

| 工具 | 用途 |
|------|------|
| `codeatlas_explain` | AI 解释模块/符号 |
| `codeatlas_semantic_search` | 自然语言搜索（`mode`: auto/vector/ai，自动选向量索引或 AI 匹配） |
| `codeatlas_semantic_index` | 构建向量嵌入索引 |
| `codeatlas_agent_execute` | 规划或执行编码任务（`mode`: plan/execute） |
| `codeatlas_orchestrate` | 多 Agent 编排 |

### 协作

| 工具 | 用途 |
|------|------|
| `codeatlas_annotate` | 标注管理（`action`: add/list/resolve） |

### 嵌入式与执行感知

| 工具 | 用途 |
|------|------|
| `codeatlas_embedded` | 嵌入式支持（`action`: analyze/build/exclude） |
| `codeatlas_trace` | Flowtrace 执行数据（`action`: load/flow/analyze） |
| `codeatlas_trace_agent` | 带执行感知的编码任务执行 |
---

## 🏗️ 架构分层

CodeAtlas 用**加权规则引擎**将每个符号归入四层之一（路径、命名、依赖包、代码内容四类规则叠加计分，得分最高者胜出，平分按 `interface > data > business > utility` 优先，未命中默认 `business`）：

| 层 | 颜色 | 典型内容 |
|----|------|----------|
| 🔵 **Interface** | 蓝 | UI、API 端点、路由、控制器、组件 |
| 🟢 **Business** | 绿 | 业务逻辑、服务、领域模型 |
| 🟠 **Data** | 橙 | 数据库、仓储、数据访问层 |
| ⚪ **Utility** | 灰 | 工具函数、辅助类、配置 |

在 `.codeatlas.yaml` 中自定义：

```yaml
layers:
  interface:
    paths: ["src/api/**", "src/pages/**"]
    rules:
      - kind: import
        patterns: ["next", "react"]
        weight: 3
  data:
    paths: ["src/db/**"]
    rules:
      - kind: import
        patterns: ["@prisma/client"]
        weight: 4
```

---

## 🔎 语义搜索

在关键词之外，按**含义**检索代码：

```bash
# 构建向量索引（默认使用本地哈希嵌入，零依赖、无需联网）
codeatlas semantic index

# 语义搜索：即使符号名不含关键词也能命中
codeatlas semantic search "error handling"
# → 找到 try/catch 相关代码，即使名字里没有 "error"

# 索引统计
codeatlas semantic stats
```

嵌入提供方可选：

| provider | 模型 | 维度 | 说明 |
|----------|------|------|------|
| `local`（默认） | FNV-1a 特征哈希 | 256 | 零依赖、离线、够用 |
| `openai` | `text-embedding-3-small` | 1536 | 需 `OPENAI_API_KEY` |
| `ollama` | `nomic-embed-text` | 768 | 本地模型，需 Ollama |

混合检索（`HybridSearch`）融合三路信号：**关键词（权重 0.3）+ 向量（0.5）+ 图谱扩展（0.2）**。

---

## 🔧 嵌入式开发支持

面向 STM32 / ESP32 / 嵌入式 Linux 项目：

- **构建系统解析** — PlatformIO、CMake、Makefile、Kbuild、Yocto、Buildroot
- **RTOS 任务检测** — FreeRTOS、Zephyr 任务
- **中断处理检测** — ISR、IRQ Handler
- **硬件外设分析** — GPIO / SPI / I2C / UART / BLE / WiFi、NVS、Flash
- **嵌入式 Linux** — Kconfig、设备树（Device Tree）、内核驱动与模块、用户态接口
- **宏扫描** — 识别被宏（`LLAMA_API` 等）或复杂返回类型包裹的函数声明
- **Vendor 库排除** — 自动建议排除 `lib/`、`.pio/`、`third_party/` 等第三方目录

```bash
codeatlas scan . --profile embedded-mcu     # 或 embedded-linux
codeatlas embedded build
codeatlas embedded tasks
codeatlas embedded hardware
```

---

## 🔄 执行感知（Flowtrace）

将**静态图谱**与**运行时执行数据**结合，理解代码"实际怎么跑"：

```bash
codeatlas trace load ~/traces/my_app/    # 加载 Flowtrace 数据
codeatlas trace flow                      # 查看执行流 DAG
codeatlas trace analyze                   # 分析热路径、失败原因、覆盖缺口
```

---

## ⚙️ 配置

在项目根目录放置 `.codeatlas.yaml`（或 `.codeatlas.json`）。完整示例见 [`.codeatlas.yaml.example`](.codeatlas.yaml.example)。

```yaml
name: my-project

scan:
  include: ["src/**", "lib/**"]
  exclude: ["node_modules/**", "dist/**", "**/*.test.*"]

layers:
  interface:
    paths: ["src/api/**", "src/components/**"]
  data:
    paths: ["src/db/**"]

ai:
  provider: claude              # claude | openai | local
  model: claude-sonnet-4-20250514
  autoExplain: false
  batchSize: 10
  # apiKey 从环境变量 ANTHROPIC_API_KEY / OPENAI_API_KEY 读取；支持 ${VAR} 插值

mcp:
  autoScan: true
  watchChanges: false
```

支持 `${VAR}` / `$VAR` 环境变量插值。

---

## 🗄️ 数据模型

图谱持久化于 `.codeatlas/db.sqlite`（Node.js 内置 `node:sqlite`，WAL 模式）。

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `symbols` | `id`(PK), `name`, `kind`, `file_path`, `start_line/end_line`, `source_code`, `language`, `layer`, `doc_comment`, `ai_summary`, `complexity`, `exported` | 符号表 |
| `relationships` | `id`(PK), `source_id`(FK), `target_id`(FK), `kind`, `line` | 关系表，外键级联删除 |
| `files` | `path`(PK), `language`, `size`, `line_count`, `hash`, `parsed_at`, `imports` | 文件表（`hash` 用于增量检测） |
| `project_meta` | `key`(PK), `value` | 项目元数据（上次扫描路径/时间/语言） |
| `annotations` | `id`(PK), `symbol_id`, `user_id`, `content`, `type`, `resolved` | 协作标注 |
| `symbol_embeddings` | `symbol_id`(PK), `embedding`, `model` | 向量嵌入（用于语义搜索） |

**关系类型**（`relationships.kind`，共 10 种）：
`calls` · `imports` · `extends` · `implements` · `contains` · `uses_type` · `overrides` · `exports` · `creates` · `decorates`

---

## 👨‍💻 开发

```bash
pnpm install      # 安装依赖
pnpm build        # 构建全部包
pnpm dev          # 并行 watch 开发
pnpm test         # 运行测试（Vitest）
pnpm typecheck    # 全量类型检查
pnpm clean        # 清理构建产物
```

针对单个包：

```bash
pnpm --filter @codeatlas/core build
pnpm --filter @codeatlas/core test
```

### 测试

```bash
pnpm test
# ✓ 22 test files
# ✓ 279 tests passed
```

覆盖单元测试、集成测试（完整扫描流水线）与性能基准（解析/存储/内存）。

更详细的开发约定、扩展点（新增语言 / MCP 工具 / 分层规则）与提交规范，请阅读 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

---

## 📋 Roadmap

### ✅ 已完成
- [x] Tree-sitter 多语言解析（12 种语言）
- [x] 知识图谱构建 + `node:sqlite` 存储 + 增量扫描
- [x] CLI（30 命令）/ MCP Server（28 工具）/ Web / VSCode 扩展四端交付
- [x] 架构分层、影响分析、依赖健康、热点分析
- [x] 语义搜索（本地 / OpenAI / Ollama 嵌入）+ 混合检索
- [x] AI 代码审查、架构守护、坏味道检测、重构建议、图谱 diff
- [x] 自然语言 Copilot（意图识别 + 多轮会话）
- [x] Agent 自主编码与多 Agent 编排
- [x] Flowtrace 执行感知
- [x] 嵌入式 MCU / 嵌入式 Linux 支持
- [x] Foam / 文档 / 多格式图谱导出

### 📋 计划中
- [ ] CI/CD 深度集成（GitHub Action 架构门禁）
- [ ] 代码演化历史与知识库
- [ ] 插件系统（自定义分析器 / 可视化 / 导出器）
- [ ] 更多语言与 IDE 支持（JetBrains / Vim）

---

## 🤝 贡献

欢迎任何形式的贡献！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境、代码规范与 PR 流程。

- 🐛 报告 Bug：[GitHub Issues](https://github.com/Fenghu146/CodeAtlas/issues)
- 💡 功能建议：同样欢迎在 Issues 中讨论

## 📄 License

[MIT License](LICENSE) © 2025 CodeAtlas Contributors

---

<div align="center">

**Made with ❤️ by developers, for developers.**

</div>
