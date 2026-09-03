---
description: 快速修复 bug。自主诊断根因、设计最小修复并验证（含回归测试），开发/测试阶段任意问题均可使用
argument-hint: <问题描述或需求编号+问题描述，如 STO-001 下单接口 500>
---

# /agile:fix-bug — 快速修复

先阅读 skill `sdd-tdd-method`，然后按以下步骤执行。

## 输入解析

- `$ARGUMENTS` 中若含需求编号（STO-xxx/BUG-xxx）则登记到该任务目录；不含则视为新缺陷，创建 `BUG-xxx`（`agile task create BUG-xxx`，顺延编号）。
- 其余文字为 bug 描述；为空则询问用户。

## 执行步骤

1. **环境检查**：`agile doctor --offline` + `agile status`；目标仓库 dirty 时停下询问用户（修复应基于干净基线）。
2. 调用 **bug-hunter** subagent（Task 工具委派），传入：
   - bug 描述、涉及仓库（从描述推断或让用户指定）、任务编号
   - 要求完整走「复现 → 定位 → 根因 → 最小修复 → 回归验证 → 登记」闭环
3. 复核 subagent 产出：
   - 修复 diff 是否最小（只针对根因）
   - 复现测试确实从红转绿
   - 该仓库全量测试无回归
4. 若根因涉及设计偏差，同步更新 design.md 并在汇报中标注。

## 输出

汇报：根因（一句话）、证据链、修复概要、验证结果、登记位置；建议受影响面较大时运行 `/agile:run-test <编号>`。
