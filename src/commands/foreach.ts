import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry, loadWorkspace } from '../core/config.js';
import { matchRepo } from '../core/sync.js';
import * as ui from '../ui.js';

export const foreachCommand = new Command('foreach')
  .description("在每个仓库目录执行命令（gclient recurse 风格），如 agile foreach 'git pull'")
  .argument('<cmd>', '要执行的 shell 命令')
  .option('--group <glob>', '仓库路径过滤（glob，如 projects/*、tech-specs）')
  .option('--parallel', '并行执行（默认串行）')
  .action(async (cmd: string, opts: { group?: string; parallel?: boolean }) => {
    const root = requireWorkspaceRoot();
    const registry = await loadRegistry(root);
    const workspace = await loadWorkspace(root);

    const repos = Object.keys(registry.repositories).filter((p) => !opts.group || matchRepo(opts.group, p));
    if (repos.length === 0) {
      console.log(ui.dim('（没有匹配的仓库）'));
      return;
    }

    const runOne = async (repoPath: string): Promise<void> => {
      const repoDir = path.join(root, repoPath);
      const r = await execa(cmd, { shell: true, cwd: repoDir, reject: false, windowsHide: true });
      const tag = r.exitCode === 0 ? ui.ok(repoPath) : ui.fail(repoPath);
      console.log(`${tag} $ ${cmd}`);
      if (r.stdout.trim()) console.log(indent(r.stdout));
      if (r.exitCode !== 0 && r.stderr.trim()) console.log(ui.dim(indent(r.stderr)));
    };

    if (opts.parallel) {
      await Promise.all(repos.map(runOne));
    } else {
      for (const repoPath of repos) await runOne(repoPath);
    }
    console.log(ui.dim(`workspace 配置：${workspace.name}，共处理 ${repos.length} 个仓库`));
  });

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}
