---
description: 命令总览：展示 agile 插件全部可用命令及 SDD/TDD 流程主线说明
disable-model-invocation: true
---

# agile 插件命令总览

先读 skill `sdd-tdd-method`（若已安装本插件则自动可用）了解方法论，然后按下面的表格输出。

## 输出要求

1. 以表格形式列出所有命令（名称 / 用途 / 建议角色）：

| 命令 | 用途 | 建议角色 |
|---|---|---|
| /agile:prd | 从需求产出 PRD、AC、功能树与菜单树 | 产品 |
| /agile:sync-req | 需求产物从抽屉三同步到 process-docs，准备开发目录 | 全员 |
| /agile:architect | 技术方案设计（SDD：先设计后开发） | 架构 |
| /agile:gen-test | Stage 1：测试案例生成（先于实现） | 测试 |
| /agile:backend | 后端 TDD 开发与接口测试编排 | 后端 |
| /agile:frontend | 前端分层开发与浏览器测试编排 | 前端 |
| /agile:ui | UI 设计与组件库全生命周期（建设/原型/维护） | UI |
| /agile:run-test | Stage 2：测试执行与验收报告 | 测试 |
| /agile:fix-bug | 快速修复：自主根因诊断→修复→验证 | 全员 |
| /agile:add-task | 补充遗漏的开发任务（不动已有任务） | 全员 |
| /agile:feedback | 收集会话错误，生成标准问题反馈报告 | 全员 |
| /agile:help | 本帮助 | - |

2. 输出 SDD/TDD 流程主线：

```
需求 → /agile:prd → /agile:sync-req → /agile:architect → /agile:gen-test
     → /agile:backend | /agile:frontend → /agile:run-test → review/release 归档
```

3. 检查当前工作区状态（若在 agile 工作区内）：运行 `agile status` 概述仓库情况；否则提示「当前目录不在 agile workspace，需先 agile init workspace」。

4. 提示两个硬规则：没有 design.md 不开发（SDD 红线）；没有失败测试不写实现（TDD 红线）。
