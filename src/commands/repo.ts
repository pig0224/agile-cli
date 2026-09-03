import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { assertValidRepoPath, requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry, saveRegistry } from '../core/config.js';
import { currentCommit, git } from '../core/git.js';
import * as ui from '../ui.js';
import path from 'node:path';

export const repoCommand = new Command('repo')
  .description('registry.yaml 仓库条目管理（add/remove/list/pin/set-url/set-branch）')
  .addCommand(
    new Command('add')
      .description('登记一个仓库到 registry（不拉取代码，sync 时生效）')
      .argument('<repoPath>', '仓库路径（相对 workspace 根，如 tech-specs、projects/order-service）')
      .argument('<url>', 'git URL，如 git@gitlab.corp:team/repo.git')
      .option('--branch <branch>', '跟踪分支（默认 main）', 'main')
      .action(async (repoPath: string, url: string, opts: { branch: string }) => {
        const root = requireWorkspaceRoot();
        assertValidRepoPath(repoPath);
        const finalUrl = url;
        const registry = await loadRegistry(root);
        if (registry.repositories[repoPath]) {
          throw new AgileError(`registry 中已存在：${repoPath}（如需更新请用 repo set-url）`);
        }
        registry.repositories[repoPath] = { url: finalUrl, branch: opts.branch };
        await saveRegistry(root, registry);
        console.log(ui.ok(`已登记 ${repoPath} → ${finalUrl}（branch: ${opts.branch}）`));
        console.log(ui.dim('运行 agile sync 拉取该仓库。'));
      }),
  )
  .addCommand(
    new Command('remove')
      .description('从 registry 移除仓库（本地 checkout 由下次 sync 清理）')
      .argument('<repoPath>', '仓库路径')
      .action(async (repoPath: string) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        if (!registry.repositories[repoPath]) {
          throw new AgileError(`registry 中不存在：${repoPath}`);
        }
        delete registry.repositories[repoPath];
        await saveRegistry(root, registry);
        console.log(ui.ok(`已从 registry 移除 ${repoPath}`));
        console.log(ui.dim('运行 agile sync 清理 .gitmodules 与本地目录。'));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出 registry 中所有仓库')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        const rows: string[][] = [[ui.bold('仓库'), ui.bold('URL'), ui.bold('分支'), ui.bold('pin')]];
        for (const [p, e] of Object.entries(registry.repositories)) {
          rows.push([p, e.url, e.branch ?? '-', e.pin ? e.pin.slice(0, 8) : '-']);
        }
        if (rows.length === 1) {
          console.log(ui.dim('（registry 为空）'));
          return;
        }
        console.log(ui.table(rows));
      }),
  )
  .addCommand(
    new Command('pin')
      .description('将仓库固定到当前 HEAD（或指定 commit）')
      .argument('<repoPath>', '仓库路径')
      .argument('[commit]', 'commit SHA，缺省为当前 HEAD')
      .action(async (repoPath: string, commit: string | undefined) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        const entry = registry.repositories[repoPath];
        if (!entry) throw new AgileError(`registry 中不存在：${repoPath}`);
        const repoDir = path.join(root, repoPath);
        const sha = commit ?? (await currentCommit(repoDir));
        entry.pin = sha;
        await saveRegistry(root, registry);
        console.log(ui.ok(`已固定 ${repoPath} → ${sha.slice(0, 12)}`));
      }),
  )
  .addCommand(
    new Command('unpin')
      .description('解除仓库的 pin，恢复跟随分支')
      .argument('<repoPath>', '仓库路径')
      .action(async (repoPath: string) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        const entry = registry.repositories[repoPath];
        if (!entry) throw new AgileError(`registry 中不存在：${repoPath}`);
        delete entry.pin;
        await saveRegistry(root, registry);
        console.log(ui.ok(`已解除 ${repoPath} 的 pin`));
      }),
  )
  .addCommand(
    new Command('set-url')
      .description('更新仓库的远端 URL（同时修正 .gitmodules 与本地 origin）')
      .argument('<repoPath>', '仓库路径')
      .argument('<url>', '新 git URL')
      .action(async (repoPath: string, url: string) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        const entry = registry.repositories[repoPath];
        if (!entry) throw new AgileError(`registry 中不存在：${repoPath}`);
        entry.url = url;
        await saveRegistry(root, registry);
        await git(root, ['config', '-f', '.gitmodules', `submodule.${repoPath}.url`, url]);
        const repoDir = path.join(root, repoPath);
        const hasDotGit = await import('node:fs/promises').then((fs) =>
          fs.stat(path.join(repoDir, '.git')).then(() => true).catch(() => false),
        );
        if (hasDotGit) {
          await git(repoDir, ['remote', 'set-url', 'origin', url]);
        }
        console.log(ui.ok(`${repoPath} URL 已更新 → ${url}`));
      }),
  )
  .addCommand(
    new Command('set-branch')
      .description('更新仓库的跟踪分支')
      .argument('<repoPath>', '仓库路径')
      .argument('<branch>', '分支名')
      .action(async (repoPath: string, branch: string) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        const entry = registry.repositories[repoPath];
        if (!entry) throw new AgileError(`registry 中不存在：${repoPath}`);
        entry.branch = branch;
        await saveRegistry(root, registry);
        console.log(ui.ok(`${repoPath} 分支已更新 → ${branch}`));
      }),
  );
