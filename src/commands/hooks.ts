import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadWorkspace } from '../core/config.js';
import { matchRepo } from '../core/sync.js';
import { collectStatus } from '../core/status.js';
import { loadRegistry } from '../core/config.js';
import * as ui from '../ui.js';

export const hooksCommand = new Command('hooks')
  .description('post-sync hooks 管理（gclient runhooks 风格）')
  .addCommand(
    new Command('run')
      .description('执行 workspace.yaml 中声明的 hooks')
      .option('--only <glob>', '只执行 match 匹配的 hook')
      .option('--repo <repoPath>', '只在指定仓库上执行（可重复）', collect, [] as string[])
      .action(async (opts: { only?: string; repo: string[] }) => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        const registry = await loadRegistry(root);

        // 默认目标：所有已检出的仓库
        const statuses = await collectStatus(root, registry);
        const targets = statuses
          .filter((s) => s.exists)
          .map((s) => s.repoPath)
          .filter((p) => opts.repo.length === 0 || opts.repo.includes(p));

        let ran = 0;
        for (const hook of workspace.hooks) {
          if (opts.only && !matchRepo(opts.only, hook.match)) continue;
          const matched = targets.filter((t) => matchRepo(hook.match, t));
          for (const t of matched) {
            console.log(ui.info(`${t} $ ${hook.run}`));
            const r = await execa(hook.run, { shell: true, cwd: path.join(root, t), reject: false, windowsHide: true });
            ran++;
            if (r.exitCode === 0) console.log(ui.ok(`${t} hook 成功`));
            else {
              console.log(ui.fail(`${t} hook 失败：${r.stderr || r.stdout || `exit ${r.exitCode}`}`));
              process.exitCode = 1;
            }
          }
        }
        if (ran === 0) console.log(ui.dim('（没有匹配的 hooks）'));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出声明的 hooks')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        if (workspace.hooks.length === 0) {
          console.log(ui.dim('（未声明任何 hook，可在 .agile/workspace.yaml 中配置）'));
          return;
        }
        for (const h of workspace.hooks) console.log(`  ${ui.info(h.match)} → ${h.run}`);
      }),
  );

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
