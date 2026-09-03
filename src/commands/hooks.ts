import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadWorkspace } from '../core/config.js';
import { listProjects } from '../core/projects.js';
import { matchRepo } from '../core/sync.js';
import * as ui from '../ui.js';

export const hooksCommand = new Command('hooks')
  .description('项目钩子管理：按 workspace.yaml 声明的 hooks 批量作用于 projects/ 下的项目')
  .addCommand(
    new Command('run')
      .description('执行 workspace.yaml 中声明的 hooks（如依赖安装、codegen）')
      .option('--only <glob>', '只执行 match 匹配的 hook')
      .option('--project <name>', '只在指定项目上执行（可重复）', collect, [] as string[])
      .action(async (opts: { only?: string; project: string[] }) => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        const projects = (await listProjects(root)).filter(
          (p) => opts.project.length === 0 || opts.project.includes(p.name),
        );

        let ran = 0;
        for (const hook of workspace.hooks) {
          if (opts.only && !matchRepo(opts.only, hook.match)) continue;
          for (const p of projects) {
            if (!matchRepo(hook.match, p.path)) continue;
            console.log(ui.info(`${p.path} $ ${hook.run}`));
            const r = await execa(hook.run, { shell: true, cwd: path.join(root, p.path), reject: false, windowsHide: true });
            ran++;
            if (r.exitCode === 0) console.log(ui.ok(`${p.path} hook 成功`));
            else {
              console.log(ui.fail(`${p.path} hook 失败：${r.stderr || r.stdout || `exit ${r.exitCode}`}`));
              process.exitCode = 1;
            }
          }
        }
        if (ran === 0) console.log(ui.dim('（没有匹配的 hooks/项目）'));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出声明的 hooks 与匹配的项目数')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        const projects = await listProjects(root);
        if (workspace.hooks.length === 0) {
          console.log(ui.dim('（未声明任何 hook，可在 .agile/workspace.yaml 中配置）'));
          return;
        }
        for (const h of workspace.hooks) {
          const matched = projects.filter((p) => matchRepo(h.match, p.path)).length;
          console.log(`  ${ui.info(h.match)} → ${h.run}${ui.dim(`（匹配 ${matched} 个项目）`)}`);
        }
      }),
  );

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
