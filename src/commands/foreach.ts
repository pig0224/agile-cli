import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import { requireWorkspaceRoot } from '../core/paths.js';
import { listProjects } from '../core/projects.js';
import { matchRepo } from '../core/sync.js';
import * as ui from '../ui.js';

export const foreachCommand = new Command('foreach')
  .description("在每个项目目录执行命令，如 agile foreach 'npm test'（遍历 projects/ 抽屉）")
  .argument('<cmd>', '要执行的 shell 命令')
  .option('--group <glob>', '项目过滤（glob 匹配 projects/<name>，如 projects/*）')
  .option('--parallel', '并行执行（默认串行）')
  .action(async (cmd: string, opts: { group?: string; parallel?: boolean }) => {
    const root = requireWorkspaceRoot();
    const projects = (await listProjects(root)).filter(
      (p) => !opts.group || matchRepo(opts.group, p.path),
    );
    if (projects.length === 0) {
      console.log(ui.dim('（没有匹配的项目）'));
      return;
    }

    const runOne = async (projectPath: string): Promise<void> => {
      const dir = path.join(root, projectPath);
      const r = await execa(cmd, { shell: true, cwd: dir, reject: false, windowsHide: true });
      const tag = r.exitCode === 0 ? ui.ok(projectPath) : ui.fail(projectPath);
      console.log(`${tag} $ ${cmd}`);
      if (r.stdout.trim()) console.log(indent(r.stdout));
      if (r.exitCode !== 0 && r.stderr.trim()) console.log(ui.dim(indent(r.stderr)));
      if (r.exitCode !== 0) process.exitCode = 1;
    };

    if (opts.parallel) {
      await Promise.all(projects.map((p) => runOne(p.path)));
    } else {
      for (const p of projects) await runOne(p.path);
    }
    console.log(ui.dim(`共处理 ${projects.length} 个项目`));
  });

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}
