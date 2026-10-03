# 性能基线（2026-10-03）

全量扫描（`codeatlas scan <path> --full`）在真实仓库上的基准。测量方式：
[scripts/bench-scan.mjs](../scripts/bench-scan.mjs)（墙钟时间 + 进程树峰值 RSS，含解析池子进程）。

| 仓库 | 语言 | 文件 | 符号 | 关系 | 墙钟（中位） | 峰值 RSS |
|---|---|---|---|---|---|---|
| HIS_cpp | C++ | 46 | 610 | 914 | 3.0 s | 825 MB |
| SmartBracelet | Python/C/C++ | 68 | 1 181 | 1 193 | 4.4 s | 1 070 MB |
| CodeAtlas（自身） | TypeScript | 121 | 1 142 | 2 092 | 12.5 s | 1.4 GB |

观察：

- **峰值 RSS 的大头是解析池子进程**：每个子进程加载 tree-sitter + 语法 WASM 约
  220 MB 基线；多语言项目按并发预算（cgroup 感知）控制同时存活的子进程数。
- 小仓库（<50 文件）的固定开销以语法 WASM 加载为主，2~3 秒是合理地板。
- 增量扫描按文件哈希跳过未变文件，典型增量重扫 <1 s（无变化重扫 50 ms 级）。

## 回归防线

`packages/core/src/performance.test.ts` 持续监控解析吞吐，断言**worker 内解析耗时**
（而非墙钟 —— 墙钟极易被并行争用拉爆，同段代码实测过 435 ms 与 311 s 两种结果）：

| 用例 | 内容 | 阈值 | 实测 |
|---|---|---|---|
| small files | 100 个小文件 × 1000 jobs | < 100 ms/job | ~0.4 ms |
| medium files | 30 个中文件 | < 500 ms/job | ~28 ms |
| large files | 5 个大文件（7000+ 行） | < 2 000 ms/job | ~270 ms |

阈值对实测保留 10 倍余量，只拦截灾难性回归（如内存泄漏引发的回收抖动、O(n²) 遍历）。

## 复测方法

```bash
node scripts/bench-scan.mjs /path/to/repo 2    # 2 轮取中位
```