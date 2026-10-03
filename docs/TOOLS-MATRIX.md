# CodeAtlas 工具面对照（CLI ↔ MCP）

> 权威对照表。MCP 工具面按"agent 高频查询"收敛（28 个工具），CLI 保留完整开发者工作流
>（30 个命令）。两者的对应关系、合并情况与已知缺口如下。

## 对照表

| CLI 命令 | MCP 工具 | 状态 | 说明 |
|---|---|---|---|
| `scan [path]` | `codeatlas_scan` | ✅ | 扫描并构建/增量更新图谱 |
| `search <query>` | `codeatlas_search` | ✅ | 按名称/关键词搜索符号 |
| `info <symbol>` | `codeatlas_node` | ✅ | 符号详情（改名 node；支持限定名解析） |
| `callers <symbol>` | `codeatlas_calls(direction=in)` | ✅ | 两命令合并为一个 calls 工具 |
| `callees <symbol>` | `codeatlas_calls(direction=out)` | ✅ | 同上，`direction=both` 双向 |
| `impact <symbol>` | `codeatlas_impact` | ✅ | 变更影响面分析 |
| `layers` | `codeatlas_layers` | ✅ | 架构分层统计 |
| `path <src> <tgt>` | `codeatlas_path` | ✅ | 符号间最短路径 |
| `hotspots` | `codeatlas_hotspots` | ✅ | 复杂/高风险符号 |
| `deps` | `codeatlas_deps` | ✅ | 依赖健康度（循环/未用/未声明） |
| `diff` | `codeatlas_diff` | ✅ | 图谱版本对比（新增/删除/移动符号） |
| `review` | `codeatlas_review` | ✅ | AI 代码审查（图上下文省 token） |
| `refactor` | `codeatlas_refactor` | ✅ | 代码异味与重构建议 |
| `agent <desc>` | `codeatlas_agent_execute(mode=plan/execute)` | ✅ | 两命令合一 |
| `embedded <sub>` | `codeatlas_embedded(action=analyze/build/exclude)` | ✅ | 三件套合一 |
| `trace <sub>` | `codeatlas_trace(action=load/flow/analyze)` | ✅ | Flowtrace 三件套合一 |
| `semantic <sub>` | `codeatlas_semantic_search` / `codeatlas_semantic_index` | ✅ | 查询/建索引分开（高频动作） |
| `foam` | `codeatlas_graph_export(format=foam)` | ✅ | 并入 graph_export |
| `graph-export` | `codeatlas_graph_export` | ✅ | |
| `export` | `codeatlas_graph` / `codeatlas_graph_export` | 🟡 | CLI 支持更多格式（JSON/CSV/Mermaid/Matrix/Stats） |
| `status` | `codeatlas_summary` | 🟡 | summary 含语义索引状态，语义等价 |
| `ask <question>` | `codeatlas_explain` | 🟡 | explain 是符号级语义近似；自由问答走会话模型 |
| `flow <symbol>` | `codeatlas_calls(direction=both)` + `codeatlas_path` | 🟡 | 入口调用链可由两个查询组合 |
| `doc` | — | ⚠️ | 文档骨架生成（写文件型任务） |
| `coverage` | — | ⚠️ | 测试覆盖映射 |
| `team` | — | ⚠️ | 团队协作导出 |
| `serve` | — | ℹ️ | Web 服务入口，非查询工具（设计如此） |
| `help` | — | ℹ️ | 入口命令 |
| — | `codeatlas_annotate(add/list/resolve)` | ✅ | 纯 MCP 能力（注释/解析） |
| — | `codeatlas_context` | ✅ | 纯 MCP 能力（任务上下文） |
| — | `codeatlas_orchestrate` | ✅ | 纯 MCP 能力（任务编排） |
| — | `codeatlas_trace_agent` | ✅ | 纯 MCP 能力（trace 驱动的 agent 分析） |
| — | `codeatlas_set_project` | ✅ | 纯 MCP 能力（切换项目） |

## 缺口的处理原则

MCP 工具面**只收 agent 高频只读查询**；写文件/生成/协作类工作流留在 CLI，
agent 需要时通过 `exec` 调用 CLI 子命令即可。因此 `doc` / `coverage` / `team`
不加对应工具，避免工具面重新膨胀（38 → 28 的收敛不再回退）。

`ask` / `flow` / `status` 标 🟡 而非 ⚠️：它们的能力可由现有工具组合覆盖或语义等价。

## 历史合并记录（38 → 28）

| 合并后 | 替代 |
|---|---|
| `semantic_search(mode: auto/vector/ai)` | semantic_search + semantic_search_v2 |
| `calls(direction: in/out/both)` | callers + callees |
| `annotate(action: add/list/resolve)` | annotate + comments + resolve_annotation |
| `trace(action: load/flow/analyze)` | trace_load + trace_flow + trace_analyze |
| `agent_execute(mode: plan/execute)` | agent_plan + agent_execute |
| `embedded(action: analyze/build/exclude)` | embedded_analyze + embedded_build + embedded_exclude |
| `graph_export(format: foam)` | 吸收 export_foam |