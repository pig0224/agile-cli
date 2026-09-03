import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadWorkspace } from '../core/config.js';
import { createTaskDocs, TASK_DOCS, TASK_ID_RE } from '../core/task.js';
import * as ui from '../ui.js';

export const taskCommand = new Command('task')
  .description('过程产物（process-docs/STO-xxx）任务目录管理')
  .addCommand(
    new Command('create')
      .description('生成需求编号目录及标准五文档（幂等）')
      .argument('<taskId>', '需求编号，如 STO-001')
      .action(async (taskId: string) => {
        const root = requireWorkspaceRoot();
        const dir = await createTaskDocs(root, taskId);
        console.log(ui.ok(`任务目录已就绪：${path.relative(root, dir)}`));
        console.log(ui.dim('文档：requirement / design / implementation / review / release.md'));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出所有需求编号目录')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        const dir = path.join(root, workspace.paths.processDocs);
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const ids = entries.filter((e) => e.isDirectory() && TASK_ID_RE.test(e.name)).map((e) => e.name);
        if (ids.length === 0) {
          console.log(ui.dim('（暂无任务目录）'));
          return;
        }
        for (const id of ids) console.log(id);
      }),
  )
  .addCommand(
    new Command('status')
      .description('查看任务五文档的完成度')
      .argument('<taskId>', '需求编号')
      .action(async (taskId: string) => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        const dir = path.join(root, workspace.paths.processDocs, taskId);
        if (!(await fs.stat(dir).then(() => true).catch(() => false))) {
          throw new AgileError(`任务目录不存在：${taskId}（agile task create ${taskId}）`);
        }
        for (const doc of TASK_DOCS) {
          const file = path.join(dir, doc.file);
          const exists = await fs.stat(file).then(() => true).catch(() => false);
          const state = exists ? ui.ok('已生成') : ui.warn('缺失');
          const filled = exists ? await isFilled(file) : false;
          console.log(`  ${state} ${filled ? '' : ui.dim('（待填充）')} ${doc.file}`);
        }
      }),
  );

/** 粗略判断文档是否已被填充：内容比模板多（非模板原始行数） */
async function isFilled(file: string): Promise<boolean> {
  const content = await fs.readFile(file, 'utf8');
  // 模板特征：仍含有占位提示或全空小节
  return !content.includes('{{id}}') && content.length > 300;
}
