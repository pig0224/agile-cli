---
description: 前端开发与调试编排。调度 frontend-dev subagent 完成分层开发（接口层/组件层/页面层）与浏览器测试，闭环交付前端任务
argument-hint: <需求编号> [仓库路径，如 STO-001 projects/frontend-web]
---

# /agile:frontend — 前端分层开发编排

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 前置校验

1. 解析 `$ARGUMENTS`：第一段为需求编号，第二段（可选）为前端仓库路径（缺省时从 `.agile/registry.yaml` 找 `projects/` 下含 vue/react 特征的仓库）。
2. 校验 `process-docs/<编号>/design.md` 已填充（SDD 红线）。未填充则停止。
3. 读 `process-docs/<编号>/menu-tree.md`（或 feature-tree）确认页面范围。
4. `agile status` 确认仓库干净；dirty 则询问。

## 开发环境准备

`agile worktree create <repoPath> feature/<编号>`，后续在 worktree 中工作。

## 执行步骤

1. 从 implementation.md 读取/初始化前端任务清单（按「接口层→组件层→页面层」分层拆分）。
2. 调用 **frontend-dev** subagent（Task 工具委派），分批（每批 ≤5 任务）传入：
   - 需求编号、design.md、UI/交互规范路径（抽屉三）、worktree 路径、本批任务
3. 浏览器验证（subagent 内完成，编排层复核）：dev server 启动、关键路径对照 AC 走查。
4. 每批完成后在该 worktree 运行前端测试命令，确认绿色。

## 闭环条件

三层全部完成、组件测试与页面走查通过、implementation.md 更新完整。

## 输出

汇报：分层完成度、组件/页面清单、测试与浏览器验证结论、commit 列表、遗留问题；建议下一步 `/agile:run-test <编号>`。
