---
description: 后端开发与测试编排。调度 backend-dev subagent 按 design.md 完成 TDD 开发（Red-Green-Refactor）与接口测试，闭环交付后端任务
argument-hint: <需求编号> [仓库路径或模块名，如 STO-001 projects/order-service]
---

# /agile:backend — 后端 TDD 开发编排

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 前置校验

1. 解析 `$ARGUMENTS`：第一段为需求编号，第二段（可选）为仓库路径/模块名。
2. 校验 `process-docs/<编号>/design.md` 已填充（SDD 红线：**无设计不开发**）。未填充则停止，提示先 `/agile:architect <编号>`。
3. 校验测试案例文档存在（`gen-test.md` 或 AC 内嵌案例）。缺失时警告但允许继续（TDD 红线仍在：先写失败测试）。
4. 运行 `agile status` 确认涉及仓库已检出且干净；dirty 则停下询问用户。

## 开发环境准备

- 若指定仓库：为它创建 worktree（`agile worktree create <repoPath> feature/<编号>`），后续工作在 worktree 路径进行。
- 未指定仓库时：从 design.md「涉及模块」表中选出后端相关仓库，逐个处理。

## 执行步骤

1. 从 `process-docs/<编号>/implementation.md` 读取任务清单（无则从 design.md 的接口/模块清单初始化）。
2. 调用 **backend-dev** subagent（Task 工具委派），传入：
   - 需求编号、design.md 路径、测试案例文档路径、worktree 路径、任务清单（本轮要完成的任务）
   - 任务分批：单次委派不超过 5 个任务，完成一批汇报后再继续下一批
3. subagent 逐任务执行 TDD 循环并更新 implementation.md。
4. 每批完成后校验：在 worktree 目录运行该仓库标准测试命令，确认绿色。

## 闭环条件

- 任务清单全部勾选、测试全绿、implementation.md 的 TDD 循环记录完整、commit 序列符合 `STO-xxx(red|green|refactor):` 规范。

## 输出

汇报：完成任务、测试结果、commit 列表、遗留问题；建议下一步 `/agile:frontend`（如涉及）或 `/agile:run-test <编号>`。
