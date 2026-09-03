---
name: sdd-tdd-method
description: agile 工作区的 SDD/TDD 研发方法论与文档规范。凡执行 agile:prd / agile:architect / agile:backend / agile:frontend / agile:gen-test / agile:run-test 等 agile 系列命令时必须先阅读本 skill。涵盖：一个根五个抽屉的目录约定、需求编号任务目录、SDD 先设计后开发、TDD Red-Green-Refactor 循环、过程产物五文档的填写规范。
---

# agile SDD/TDD 方法论

## 1. 工作区结构（一个根、五个抽屉）

工作区根 = 存在 `.agile/workspace.yaml` 的目录。**一切路径先读 `.agile/workspace.yaml` 的 `paths` 段获得**，默认约定：

| 抽屉 | 默认路径 | 内容 | 角色 |
|---|---|---|---|
| 一 | `tech-specs/` | 公司级技术规范（技术栈、SQL、安全硬规范） | 全员遵守 |
| 二 | `biz-tech-docs/` | 团队技术设计知识库（架构、状态机、技术方案、工程规范） | 架构师 |
| 三 | `biz-product-docs/` | 产品设计知识库（PRD、产品规范、UI 规范、交互规范） | 产品经理 |
| 四 | `projects/` | 项目代码（多个 git submodule） | 开发 |
| 五 | `process-docs/` | 过程产物（按需求编号归档，workspace 根仓库内） | 全员 |

CLI 与 MCP：工作区操作（sync/status/task/doctor 等）通过 Bash 执行 `agile <command>`，或调用捆绑 MCP 工具 `mcp__plugins_agile_agile__*`。**不要手工造 git submodule 命令，交给 agile CLI。**

## 2. 需求编号（STO-xxx）任务目录

`process-docs/STO-xxx/` 标准五文档，由 `agile task create STO-xxx`（或 MCP `agile_task_create`）生成：

- `requirement.md` — 需求说明与验收标准（AC）。产品/需求侧填充。
- `design.md` — 技术设计。**SDD 核心：开发前必须先完成**。参考抽屉一/二规范。
- `implementation.md` — 实施记录：任务清单、TDD 循环记录、变更清单。
- `review.md` — 评审记录。
- `release.md` — 发布记录与回滚方案。

当前需求编号贯穿始终：所有命令产出都写入对应 `process-docs/<编号>/`。

## 3. SDD（Spec-Driven Design）流程主线

```
需求输入
  → /agile:prd          （产品经理 subagent：PRD/AC/功能树/菜单树 → 抽屉三）
  → /agile:sync-req     （需求产物同步到 process-docs/STO-xxx，创建标准目录）
  → /agile:architect    （架构师 subagent：design.md，先设计后开发）
  → /agile:gen-test     （测试工程师 Stage 1：基于 AC 产出测试案例文档）
  → /agile:backend / /agile:frontend   （TDD 开发实现）
  → /agile:run-test     （测试工程师 Stage 2：执行测试 + 验收报告）
  → review.md / release.md 归档闭环
```

**硬规则：**
1. 没有 `design.md` 不得进入开发阶段（SDD 红线）。
2. 没有失败测试不得写实现代码（TDD 红线；脚手架/接口签名除外）。
3. 所有产物先落盘到 process-docs，再写代码；代码变更与文档同步更新。

## 4. TDD 循环（Red → Green → Refactor）

每个开发任务在 `implementation.md` 登记，然后：

1. **Red**：根据 design.md 与测试案例写一个失败的测试（运行证明它失败）。
2. **Green**：写最小实现让测试通过（不许过度设计）。
3. **Refactor**：消除重复、改善命名与结构，测试保持绿色。

循环记录写入 `implementation.md` 的「TDD 循环记录」表格。多任务按依赖顺序逐个循环。

## 5. 规范引用优先级

写任何代码/文档前：
1. `tech-specs/`（公司硬规范，冲突时优先级最高）
2. `biz-tech-docs/`（团队规范与既有设计，保持一致，禁止重复造轮子）
3. `biz-product-docs/`（产品/UI 规范，前端实现必须对齐）
4. 当前任务 `design.md`（本次的具体决策）

## 6. 命令速查

| 命令 | 用途 |
|---|---|
| /agile:help | 全部命令总览 |
| /agile:prd | 生成 PRD/AC/功能树/菜单树 |
| /agile:sync-req | 需求产物 → process-docs |
| /agile:architect | 技术方案设计 |
| /agile:gen-test | Stage 1 测试案例 |
| /agile:backend | 后端 TDD 开发 |
| /agile:frontend | 前端分层开发 |
| /agile:ui | UI/组件库生命周期 |
| /agile:run-test | Stage 2 测试执行与验收 |
| /agile:add-task | 补充遗漏任务 |
| /agile:fix-bug | 根因诊断修复 |
| /agile:feedback | 问题反馈报告 |
