---
description: 技术方案设计。调度 tech-architect subagent 基于 PRD/AC 与团队知识库产出 design.md（SDD：先设计后开发）
argument-hint: <需求编号，如 STO-001>
---

# /agile:architect — 技术方案设计

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 前置校验

1. 读 `.agile/workspace.yaml` 获取 `paths.processDocs`。
2. 需求编号：`$ARGUMENTS`（为空时用 `agile task list` 让用户选择）。
3. 检查 `process-docs/<编号>/requirement.md` 已填充（含 AC）。**未填充则停止**，提示先执行 `/agile:prd` + `/agile:sync-req`。

## 执行步骤

1. 调用 **tech-architect** subagent（Task 工具委派），传入：
   - 需求编号、`process-docs/<编号>/requirement.md` 路径
   - 抽屉一路径（`paths` 中 `techSpecs`）、抽屉二路径（`bizTechDocs`）、抽屉四路径（`projects`）
2. subagent 产出 `process-docs/<编号>/design.md`。
3. 审查产出（自己读一遍 design.md）：
   - 涉及仓库是否都在 `.agile/registry.yaml` 中（不在则列出并建议 `agile repo add`）
   - 是否有 TBD 项
4. 汇报：设计要点摘要、涉及仓库、接口数、TBD 列表。

## 完成后建议

提示下一步：`/agile:gen-test <编号>`（测试案例先行）。
