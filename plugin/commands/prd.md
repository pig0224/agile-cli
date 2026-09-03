---
description: PRD 生成。从需求产出 PRD 文档、验收标准（AC）、功能树与菜单树（写入抽屉三 biz-product-docs）
argument-hint: <需求编号或需求描述，如 STO-001 或一段需求文字>
---

# /agile:prd — PRD 生成

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 输入解析

- `$ARGUMENTS` 中若含需求编号（形如 STO-xxx / BUG-xxx），以其为任务编号；否则自动分配下一个编号（用 `agile task list` 查看现有编号顺延）。
- 其余文字视为需求描述；若为空，向用户询问需求描述后继续。

## 执行步骤

1. 读 `.agile/workspace.yaml` 获取 `paths.bizProductDocs`（抽屉三路径）。
2. 调用 **product-manager** subagent（Task 工具委派），传入：
   - 需求编号与需求描述（`$ARGUMENTS` 全文）
   - 抽屉三路径
3. subagent 产出 `PRD.md / AC.md / feature-tree.md / menu-tree.md` 到 `<bizProductDocs>/requirements/<编号>/`。
4. 向用户汇报：产物文件清单、AC 数量、待确认问题。

## 完成后建议

提示用户下一步：`/agile:sync-req <编号>` 把需求产物同步到过程目录。
