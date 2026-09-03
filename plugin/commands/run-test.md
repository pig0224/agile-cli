---
description: 测试执行（Stage 2）。按测试案例执行测试脚本并生成测试验收报告 run-test.md，全程 auto 模式
argument-hint: <需求编号，如 STO-001> [--only P0] [--repo 仓库路径]
---

# /agile:run-test — 测试执行与验收（Stage 2）

先阅读 skill `sdd-tdd-method`，然后**全程自动执行（auto 模式）**：不中途向用户提问，遇到问题记录后继续，最后一次性汇报。

## 前置校验

1. 解析 `$ARGUMENTS`：需求编号，可选 `--only P0`（只跑指定优先级）、`--repo <path>`（只跑指定仓库）。
2. 校验 `process-docs/<编号>/gen-test.md` 存在；缺失则基于 requirement.md 的 AC 现场生成精简案例清单（在报告中注明「Stage 1 缺失」）。

## 执行步骤

1. 读 design.md「涉及模块」表 + `agile status` 确定要跑的仓库。
2. 调用 **test-engineer** subagent（Task 工具委派，auto 模式）：
   - 逐仓库执行标准测试命令（从 package.json scripts / Makefile / pom.xml 读取）
   - 按案例清单核对结果；失败的记录现象与初步归因，继续其余案例
3. 产出 `process-docs/<编号>/run-test.md`：范围、执行环境、逐案例结果表、失败清单、通过率、结论（通过验收 / 有条件通过 / 不通过）。

## 诚实原则

- 没执行的一律标「未执行」；禁止推断填充。
- 测试命令与关键输出摘录写入报告。

## 输出

汇报：结论、通过率、失败/阻塞清单；不通过时建议 `/agile:fix-bug <编号> <问题描述>`。
