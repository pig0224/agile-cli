---
description: 测试案例生成（Stage 1）。基于 AC 与设计产出测试案例文档 gen-test.md，先于实现
argument-hint: <需求编号，如 STO-001>
---

# /agile:gen-test — 测试案例生成（Stage 1）

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 前置校验

1. 需求编号：`$ARGUMENTS`（为空时 `agile task list` 让用户选择）。
2. 校验 `process-docs/<编号>/requirement.md` 已填充（含 AC）——测试案例来自 AC。缺失则停止，提示先 /agile:prd + /agile:sync-req。
3. 校验 `process-docs/<编号>/design.md` 已填充（案例需要接口/数据模型信息）。缺失则警告并提示 /agile:architect（可选择仅基于 AC 生成，需用户确认）。

## 执行步骤

1. 调用 **test-engineer** subagent（Task 工具委派），传入：
   - 需求编号、requirement.md 与 design.md 路径、涉及的仓库列表（来自 design.md 涉及模块表）
2. subagent 产出 `process-docs/<编号>/gen-test.md`（案例清单 TC 表格、数据准备、自动化映射）。
3. 校验产出：每条 AC 至少 1 正常 + 1 边界/异常案例；不满足则让 subagent 补齐。

## 输出

汇报：案例数量（按类型/优先级统计）、自动化覆盖率、文件路径；提示下一步 /agile:backend 或 /agile:frontend。
