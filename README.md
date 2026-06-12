# 🗺️ CodeAtlas

> 把代码变成可交互的知识地图 — 十分钟看清一个陌生项目的架构。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 特性

- 🔍 **智能解析** - Tree-sitter 多语言支持（12 种语言），准确提取代码结构
- 🕸️ **知识图谱** - 自动构建符号关系图，支持调用链分析
- 🏗️ **架构分层** - 自动识别 interface / business / data / utility 层
- 🤖 **AI 增强** - LLM 驱动的语义搜索、智能解释、代码审查
- 💻 **多端交付** - CLI / MCP Server / Web / VSCode 四种使用方式
- 📊 **交互可视化** - Cytoscape.js 驱动的可交互图谱
- ⚡ **增量扫描** - 基于哈希的变更检测，只解析变化的文件
- 🔌 **MCP 协议** - 原生支持 Claude Code / Cursor / Qoder 等 AI 工具
- 🧠 **语义搜索** - 向量嵌入 + 混合搜索，按含义查找代码
- 🔧 **嵌入式支持** - 专为 STM32/ESP32/Linux 嵌入式项目优化
- 🔄 **执行感知** - 集成 Flowtrace，理解代码运行时行为
- 🎯 **Agent 协作** - 多 Agent 编排，自主规划→生成→验证

## 🚀 快速开始

```bash
# 安装
npm install -g codeatlas

# 扫描项目
cd /path/to/your/project
codeatlas scan

# 启动 Web 可视化
codeatlas serve
# → 浏览器打开 http://localhost:8080

# 或在 Claude Code 中使用 (配置 MCP 后自动可用)
# Claude 会自动调用 codeatlas_* 工具来理解代码
```

## 📦 项目结构

```
codeatlas/
├── packages/
│   ├── core/           # 核心引擎 (解析 + 图谱 + 存储 + 分析)
│   ├── cli/            # 命令行工具 (20+ 命令)
│   ├── mcp-server/     # MCP Server (30+ AI 工具)
│   ├── web/            # Web 可视化 (Cytoscape.js)
│   └── vscode/         # VSCode 扩展 (TreeView + Webview)
└── docs/               # 文档
```

## 🛠️ CLI 命令

### 核心分析
```bash
codeatlas scan [path]              # 扫描项目，构建图谱
codeatlas search <query>           # 搜索符号（支持模糊匹配）
codeatlas info <symbol>            # 查看符号详情
codeatlas status                   # 查看索引状态
```

### 依赖分析
```bash
codeatlas callers <symbol>         # 查找调用者
codeatlas callees <symbol>         # 查找被调用者
codeatlas deps                     # 依赖健康分析
codeatlas path <source> <target>   # 查找两个符号之间的路径
```

### 影响分析
```bash
codeatlas impact <symbol>          # 影响分析（支持符号名模糊匹配）
codeatlas hotspots                 # 热点分析（找复杂度最高的函数）
codeatlas layers                   # 查看架构分层
```

### 代码质量
```bash
codeatlas review                   # AI 代码审查（smart mode 省 90% token）
codeatlas guard                    # 架构守护（支持自定义规则）
codeatlas refactor                 # 代码坏味道检测
```

### 变更验证
```bash
codeatlas diff --save baseline.json    # 保存基线
codeatlas diff --baseline baseline.json # 对比变更
```

### 嵌入式支持
```bash
codeatlas embedded build           # 构建配置（PlatformIO/CMake）
codeatlas embedded tasks           # RTOS 任务检测
codeatlas embedded hardware        # 硬件外设分析
codeatlas embedded exclude         # Vendor 库排除模式
```

### 语义搜索
```bash
codeatlas semantic index           # 构建向量索引
codeatlas semantic search "查询"   # 语义搜索（按含义查找）
codeatlas semantic stats           # 索引统计
```

### Agent 自主编码
```bash
codeatlas agent "任务描述"         # 自主编码（plan→generate→verify）
codeatlas agent --dry-run          # 仅生成计划
```

### 执行感知（Flowtrace）
```bash
codeatlas trace load <path>        # 加载 Flowtrace 数据
codeatlas trace steps              # 查看执行步骤
codeatlas trace analyze            # 分析执行热点
```

### 数据导出
```bash
codeatlas export --format json     # 导出图谱数据
codeatlas graph-export --format mermaid  # 导出 Mermaid 图
codeatlas graph-export --stats     # 图谱统计
codeatlas foam                     # 导出为 Foam 格式
codeatlas doc                      # 生成文档骨架
```

## 🤖 MCP 工具

集成到 Claude Code / Cursor 等 AI 工具后，可用以下工具：

### 图谱查询
| 工具 | 用途 |
|------|------|
| `codeatlas_scan` | 扫描项目，构建/更新图谱 |
| `codeatlas_search` | 按名称/关键词搜索符号 |
| `codeatlas_node` | 获取符号详情（含源码） |
| `codeatlas_callers` | 查找调用者 |
| `codeatlas_callees` | 查找被调用者 |
| `codeatlas_context` | 获取任务上下文（支持 symbol 参数） |
| `codeatlas_impact` | 影响分析（支持模糊匹配） |
| `codeatlas_path` | 查找两个符号之间的路径 |
| `codeatlas_layers` | 查看架构分层 |
| `codeatlas_summary` | 项目概览 |
| `codeatlas_hotspots` | 热点分析 |
| `codeatlas_changes` | 最近修改 |

### 代码质量
| 工具 | 用途 |
|------|------|
| `codeatlas_review` | AI 代码审查（smart mode） |
| `codeatlas_guard` | 架构守护（支持自定义规则） |
| `codeatlas_refactor` | 代码坏味道检测 |
| `codeatlas_deps` | 依赖健康分析 |

### Agent 能力
| 工具 | 用途 |
|------|------|
| `codeatlas_agent_plan` | 生成执行计划 |
| `codeatlas_agent_execute` | 执行编码任务 |
| `codeatlas_orchestrate` | 多 Agent 编排 |
| `codeatlas_trace_agent` | 执行感知 Agent |

### 语义搜索
| 工具 | 用途 |
|------|------|
| `codeatlas_semantic_index` | 构建向量索引 |
| `codeatlas_semantic_search_v2` | 语义搜索 |

### 嵌入式
| 工具 | 用途 |
|------|------|
| `codeatlas_embedded_analyze` | 嵌入式分析 |
| `codeatlas_embedded_build` | 构建配置 |
| `codeatlas_embedded_exclude` | 排除模式 |

### 执行感知
| 工具 | 用途 |
|------|------|
| `codeatlas_trace_load` | 加载 Flowtrace 数据 |
| `codeatlas_trace_flow` | 显示执行流 DAG |
| `codeatlas_trace_analyze` | 分析执行热点 |

## 📊 架构分层

CodeAtlas 自动将代码分为四个架构层：

- 🔵 **Interface** - UI、API 端点、路由、控制器
- 🟢 **Business** - 业务逻辑、服务、领域模型
- 🟠 **Data** - 数据库、仓储、数据访问层
- ⚪ **Utility** - 工具函数、辅助类、配置

支持自定义分层规则（`.codeatlas.yaml`）：

```yaml
layers:
  interface:
    rules:
      - kind: import
        patterns: ["next", "nuxt"]
        weight: 3
  data:
    rules:
      - kind: import
        patterns: ["@prisma/client"]
        weight: 4
```

## 🔧 嵌入式开发支持

专为 STM32/ESP32/Linux 嵌入式项目优化：

- **构建系统解析** - 自动识别 PlatformIO、CMake、Makefile
- **RTOS 任务检测** - 识别 FreeRTOS、Zephyr 任务
- **中断处理检测** - 识别 ISR、IRQ Handler
- **硬件外设分析** - 识别 GPIO、SPI、I2C、BLE、WiFi 等
- **Vendor 库排除** - 自动排除 lib/、.pio/ 等第三方库

```bash
# 嵌入式项目分析流程
codeatlas scan . --exclude "lib,.pio"
codeatlas embedded analyze
codeatlas embedded tasks
codeatlas embedded hardware
```

## 🧠 语义搜索

基于向量嵌入的语义搜索，按含义查找代码：

```bash
# 构建索引
codeatlas semantic index

# 语义搜索（即使符号名不含关键词）
codeatlas semantic search "error handling"
# → 找到 try/catch 相关代码，即使名字不含 "error"

# 混合搜索（关键词 + 向量 + 图谱）
# 自动融合三种搜索策略
```

## 🔄 执行感知（Flowtrace 集成）

结合静态分析和运行时执行数据：

```bash
# 加载 Flowtrace 数据
codeatlas trace load ~/traces/my_app/

# 分析执行热点
codeatlas trace analyze
# → 找到热点路径、失败原因、覆盖率

# Agent 基于执行历史决策
codeatlas agent "优化性能" --trace ~/traces/my_app/
```

## 📈 Roadmap

### ✅ 已完成 (v0.1)
- [x] Tree-sitter 多语言解析（12 种语言）
- [x] 知识图谱构建
- [x] SQLite + FTS5 存储
- [x] CLI 工具 (20+ 命令)
- [x] MCP Server (30+ 工具)
- [x] Web 可视化
- [x] VSCode 扩展
- [x] Foam 导出

### ✅ 已完成 (v0.2)
- [x] LLM 集成 - 智能摘要生成
- [x] 语义搜索 - 向量嵌入 + 混合搜索
- [x] 嵌入式支持 - STM32/ESP32/Linux
- [x] Agent 自主编码 - plan→generate→verify
- [x] 多 Agent 编排
- [x] Flowtrace 集成
- [x] 架构守护（自定义规则）
- [x] 代码坏味道检测
- [x] 变更对比（diff）

### 📋 计划中 (v0.3)
- [ ] CI/CD 深度集成 - GitHub Action
- [ ] 知识库 - 代码演化历史
- [ ] 多模态分析 - 文档 + 提交历史
- [ ] 插件系统

### 🔮 未来 (v1.0)
- [ ] CodeAtlas Cloud - 云端协作平台
- [ ] 多 IDE 支持 - JetBrains / Vim
- [ ] 开放 API
- [ ] 企业级功能

## 🏗️ 技术栈

| 组件 | 技术 |
|------|------|
| 核心引擎 | TypeScript + Node.js |
| 代码解析 | Tree-sitter (WASM) |
| 图谱存储 | SQLite + FTS5 |
| 向量搜索 | 本地 Hash Embedding + cosine similarity |
| AI 分析 | Claude / OpenAI / Ollama |
| MCP Server | @modelcontextprotocol/sdk |
| Web 可视化 | Cytoscape.js + Vite |
| VSCode 扩展 | VSCode Extension API |
| 包管理 | pnpm workspaces |

## 📝 文档

- [BLUEPRINT.md](BLUEPRINT.md) - 详细设计文档

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

## 📄 License

MIT License - 详见 [LICENSE](LICENSE)

---

**Made with ❤️ by developers, for developers.**
