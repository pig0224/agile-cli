import fs from 'node:fs/promises';
import path from 'node:path';
import { AgileError } from './errors.js';
import { loadWorkspace } from './config.js';

/** 过程产物标准五文档（本模块不注册 CLI 命令，仅由 MCP 工具 agile_task_create 暴露） */
export const TASK_DOCS: Array<{ file: string; template: string }> = [
  {
    file: 'requirement.md',
    template: `# {{id}} 需求说明

> 由 MCP 工具 agile_task_create 生成，agile:prd / agile:sync-req 会填充此文档。

## 背景

（需求来源、业务背景）

## 目标

（本需求要达成的目标）

## 验收标准（AC）

- [ ] AC1: ...
- [ ] AC2: ...
`,
  },
  {
    file: 'design.md',
    template: `# {{id}} 技术设计

> 由 agile:architect 填充（SDD：先设计后开发）。参考抽屉二 biz-tech-docs 知识库。

## 方案概述

## 涉及模块

| 模块 | 仓库 | 改动类型 |
|---|---|---|
| | | |

## 接口设计

## 状态机 / 数据模型

## 风险与取舍
`,
  },
  {
    file: 'implementation.md',
    template: `# {{id}} 实施记录

> 由 agile:backend / agile:frontend 填充（TDD：Red → Green → Refactor）。

## 任务清单

- [ ] 任务1
- [ ] 任务2

## TDD 循环记录

| # | 测试（先写） | 实现后状态 |
|---|---|---|
| 1 | | |

## 变更清单
`,
  },
  {
    file: 'review.md',
    template: `# {{id}} 评审记录

## Code Review 结论

## 问题与修复

## 遗留问题
`,
  },
  {
    file: 'release.md',
    template: `# {{id}} 发布记录

## 发布内容

## 涉及仓库与 commit

| 仓库 | 分支 | commit |
|---|---|---|
| | | |

## 回滚方案
`,
  },
];

export const TASK_ID_RE = /^[A-Za-z]+-\d{3,}$/;

/** 在 process-docs 下生成需求编号目录与标准五文档（幂等） */
export async function createTaskDocs(root: string, taskId: string): Promise<string> {
  if (!TASK_ID_RE.test(taskId)) {
    throw new AgileError(`需求编号格式应为 形如 STO-001 的 <前缀>-<序号>：${taskId}`);
  }
  const workspace = await loadWorkspace(root);
  const dir = path.join(root, workspace.paths.processDocs, taskId);
  await fs.mkdir(dir, { recursive: true });

  for (const doc of TASK_DOCS) {
    const file = path.join(dir, doc.file);
    if (await fs.stat(file).then(() => true).catch(() => false)) continue;
    await fs.writeFile(file, doc.template.replaceAll('{{id}}', taskId), 'utf8');
  }
  return dir;
}
