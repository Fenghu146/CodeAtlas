# 贡献指南 (Contributing to CodeAtlas)

感谢你对 CodeAtlas 的关注！本文档说明如何搭建开发环境、项目约定以及提交贡献的流程。

## 行为准则

请保持友善、尊重与专业。我们欢迎任何背景的贡献者。

## 开发环境

### 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | **>= 22.13.0** | 核心引擎使用内置 `node:sqlite`，该版本起无需 `--experimental-sqlite` 标志 |
| pnpm | **>= 9** | 通过 `corepack enable` 或 `npm i -g pnpm` 安装 |

### 初始化

```bash
git clone https://github.com/Fenghu146/CodeAtlas.git
cd CodeAtlas
pnpm install          # 安装全部工作区依赖
pnpm build            # 构建所有包（core → cli / mcp-server / vscode / web）
```

### 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建所有包 |
| `pnpm dev` | 并行 watch 模式开发 |
| `pnpm test` | 运行单元 / 集成测试（Vitest） |
| `pnpm test:watch` | 测试 watch 模式 |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm clean` | 清理构建产物 |

针对单个包：

```bash
pnpm --filter @codeatlas/core build
pnpm --filter @codeatlas/core test
```

## 项目结构

```
packages/
├── core/        # 核心引擎：解析 / 图谱 / 存储 / 分析 / 搜索 / 导出
├── cli/         # 命令行工具（codeatlas）
├── mcp-server/  # MCP Server，供 Claude Code / Cursor 等调用
├── web/         # Cytoscape.js 交互式可视化
└── vscode/      # VSCode 扩展（TreeView / Webview / Hover / CodeLens）
```

详细架构与数据模型见 [BLUEPRINT.md](BLUEPRINT.md)。

## 代码规范

- **语言**：TypeScript（`strict` 模式），ESM 模块。
- **缩进**：2 个空格；文件以 LF 结尾，UTF-8 编码。编辑器请遵循 [.editorconfig](.editorconfig)。
- **命名**：类 `PascalCase`，函数 / 变量 `camelCase`，常量 `UPPER_SNAKE_CASE`，文件名 `kebab-case`。
- **导入**：包内相对导入需带 `.js` 后缀（NodeNext 解析）。
- **日志**：**库代码（`core`）禁止使用 `console.log`**——它会污染使用 stdout 的消费方（尤其是 MCP 的 stdio 传输）。请统一使用 `@codeatlas/core` 导出的 `logger`（写入 stderr）。
- **注释**：解释「为什么」而非「是什么」；每个模块顶部保留简短的分区标题注释。

提交前请确保：

```bash
pnpm typecheck && pnpm test
```

## 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

feat(cli): add `codeatlas layers --by-file`
fix(core): drop dangling relationships that violate the FK constraint
docs(readme): correct SQLite storage description
```

常用 `type`：`feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `chore`。
`scope` 建议使用包名（`core` / `cli` / `mcp` / `web` / `vscode`）。

## 扩展点

### 新增语言支持

1. 将对应的 `tree-sitter-<lang>.wasm` 放入 `packages/core/src/parser/language-packs/`。
2. 在 `packages/core/src/parser/index.ts` 的 `EXTENSION_MAP` 中登记扩展名 → 语言名。
3. 如有需要，在 `getSymbolNodeTypes()` 中补充该语言的 AST 节点类型。
4. 添加测试并更新 README 的支持语言列表。

### 新增 MCP 工具

在 `packages/mcp-server/src/server.ts` 中通过 `server.tool(name, description, schema, handler)` 注册，并遵循 `codeatlas_*` 命名。若面向 AI 使用，请补充简洁、明确的参数描述。

### 新增架构分层规则

在 `packages/core/src/graph/layer-classifier.ts` 的 `LAYER_RULES` 中追加规则，或通过 `.codeatlas.yaml` 的 `layers.*.rules` 由用户自定义。

## 测试

测试文件与源码同目录，命名为 `*.test.ts`，由根目录 `vitest.config.ts` 统一收集。

- 单元测试：聚焦单个模块（如 `graph/builder.test.ts`）。
- 集成测试：覆盖完整流水线（如 `integration.test.ts`）。
- 性能测试：验证关键路径的时间/内存预算（如 `performance.test.ts`）。

新增功能请一并补充测试；修复缺陷请先写一个能复现问题的测试。

## 提交 Pull Request

1. Fork 并基于 `main` 创建特性分支：`git checkout -b feat/your-feature`。
2. 保持改动聚焦，一个 PR 解决一个问题。
3. 确保 `pnpm typecheck` 与 `pnpm test` 全绿。
4. 在 PR 描述中说明动机、方案与影响范围；如有 UI 变化请附截图。

## 问题反馈

- Bug：请提供复现步骤、期望行为、实际行为，以及 `node -v`、`pnpm -v` 和操作系统信息。
- 功能建议：请描述使用场景与期望价值。

感谢你的贡献！
