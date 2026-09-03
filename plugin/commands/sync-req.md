---
description: 需求同步。将需求产物从 biz-product-docs 同步到 process-docs/<编号>/，创建标准五文档目录，为后续开发做准备
argument-hint: <需求编号，如 STO-001>
---

# /agile:sync-req — 需求产物同步

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 输入

- 需求编号：`$ARGUMENTS`（必填；为空时用 `agile task list` 列出现有编号请用户选择）。

## 执行步骤

1. 读 `.agile/workspace.yaml` 获取 `paths.bizProductDocs` 与 `paths.processDocs`。
2. 创建过程目录（幂等，优先用 CLI / MCP 工具）：
   - Bash: `agile task create <编号>`
   - 或 MCP 工具: `agile_task_create`
3. 同步需求产物到过程目录：
   - `<bizProductDocs>/requirements/<编号>/PRD.md` → 若 `process-docs/<编号>/requirement.md` 仍为模板（含「待填充」/占位），将 PRD 核心内容 + AC 完整并入 `requirement.md`（保留模板中的 AC 章节结构，填充 AC 条目）。
   - 其余产物（AC.md、feature-tree.md、menu-tree.md）**复制**到 `process-docs/<编号>/`（保持文件名）。
   - 源文件保留不删（抽屉三是知识库原件）。
4. 校验：`process-docs/<编号>/requirement.md` 中 AC 至少 1 条；否则警告用户回到 `/agile:prd`。

## 输出

汇报：创建/更新的文件清单（相对路径），并提示下一步 `/agile:architect <编号>`。
