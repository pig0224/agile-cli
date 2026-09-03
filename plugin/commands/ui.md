---
description: UI 设计与组件库全生命周期：建设、原型设计、维护升级
argument-hint: <子命令与参数，如 build 建设组件库 | prototype STO-001 页面原型 | maintain 升级组件>
---

# /agile:ui — UI 设计与组件库全生命周期

先阅读 skill `sdd-tdd-method`，然后按 `$ARGUMENTS` 判断模式（缺省时询问用户选择）：

## 模式一：build（组件库建设）

1. 读抽屉三 UI 规范、抽屉二前端工程规范。
2. 调用 **ui-designer** subagent：从 0 到 1建设组件库（设计 token、基础组件 5-8 个起步、目录结构、README、测试）。
3. 完成后建议 `agile init project <name> --type vue|react` 落库并注册 registry。

## 模式二：prototype STO-xxx（页面原型）

1. 校验 `process-docs/<编号>/requirement.md` 存在（否则先 /agile:prd）。
2. 调用 **ui-designer** subagent：产出 `<bizProductDocs>/prototypes/<编号>/page-*.md`（结构、交互说明、mermaid 流程、规范缺口清单）。
3. 汇报原型文件与规范缺口。

## 模式三：maintain（组件维护/升级）

1. 调用 **ui-designer** subagent：盘点组件库（读 CHANGELOG 与组件目录），按 `$ARGUMENTS` 中描述的变更需求执行：
   - 升级：改实现 + 更新测试 + CHANGELOG 登记
   - 废弃：标记 deprecated + 迁移指引
2. 受影响页面：grep 组件库引用，列出受影响仓库与文件，建议批量验证方式。

## 通用要求

- 所有产物全中文、遵循抽屉三 UI 规范；组件先测试后实现（TDD）。
- 汇报格式：产出/变更清单、测试结果、规范缺口/兼容性影响。
