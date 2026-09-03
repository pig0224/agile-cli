import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry } from '../core/config.js';
import { currentBranch, git, gitTry } from '../core/git.js';
import * as ui from '../ui.js';

/** worktree 存放根目录：workspace 下 .worktrees/（已在 .gitignore 思路中隔离） */
const WORKTREE_ROOT = '.worktrees';

export const worktreeCommand = new Command('worktree')
  .description('项目开发环境（git worktree）管理：为仓库创建隔离的开发目录')
  .addCommand(
    new Command('create')
      .description('为仓库创建开发 worktree，如 agile worktree create projects/order-service feature/STO-001')
      .argument('<repoPath>', '仓库路径（registry 中的 key）')
      .argument('[branch]', '开发分支名；缺省为 feature/<日期>-<序号>')
      .option('--base <ref>', '基准分支/commit，默认当前 HEAD')
      .action(async (repoPath: string, branch: string | undefined, opts: { base?: string }) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        if (!registry.repositories[repoPath]) {
          throw new AgileError(`registry 中不存在：${repoPath}`);
        }
        const repoDir = path.join(root, repoPath);
        const finalBranch = branch ?? `feature/${new Date().toISOString().slice(0, 10)}`;

        const target = path.join(root, WORKTREE_ROOT, repoPath, finalBranch.replace(/[/\\]/g, '__'));
        await git(root, [
          '-C', repoDir,
          'worktree', 'add', '-b', finalBranch, target, opts.base ?? 'HEAD',
        ]);

        const wtBranch = await currentBranch(target);
        console.log(ui.ok(`worktree 已创建：${path.relative(root, target)}（分支 ${wtBranch}）`));
        console.log(ui.dim(`开发完成后：agile worktree remove ${repoPath} ${finalBranch}`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出所有 worktree')
      .argument('[repoPath]', '可选：限定某个仓库')
      .action(async (repoPath?: string) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        const repos = repoPath ? [repoPath] : Object.keys(registry.repositories);
        let found = false;
        for (const rp of repos) {
          const repoDir = path.join(root, rp);
          const r = await gitTry(repoDir, ['worktree', 'list', '--porcelain']);
          if (!r.ok) continue;
          for (const line of r.stdout.split('\n')) {
            if (!line.startsWith('worktree ')) continue;
            const wtPath = path.resolve(line.slice('worktree '.length));
            // 跳过主工作区与 .git/modules 内部路径（submodule 场景）
            if (path.resolve(repoDir) === wtPath) continue;
            if (wtPath.includes(`${path.sep}.git${path.sep}modules${path.sep}`)) continue;
            found = true;
            console.log(`${ui.info(rp)}  ${path.relative(root, wtPath)}`);
          }
        }
        if (!found) console.log(ui.dim('（无 worktree）'));
      }),
  )
  .addCommand(
    new Command('remove')
      .description('移除 worktree（--force 处理含未提交改动的工作区）')
      .argument('<repoPath>', '仓库路径')
      .argument('[branch]', '分支名（与 create 时一致）')
      .option('--force', '强制移除（丢弃未提交改动）')
      .action(async (repoPath: string, branch: string | undefined, opts: { force?: boolean }) => {
        const root = requireWorkspaceRoot();
        const registry = await loadRegistry(root);
        if (!registry.repositories[repoPath]) {
          throw new AgileError(`registry 中不存在：${repoPath}`);
        }
        const repoDir = path.join(root, repoPath);
        const list = await git(repoDir, ['worktree', 'list', '--porcelain']);
        const candidates = list
          .split('\n')
          .filter((l) => l.startsWith('worktree '))
          .map((l) => l.slice('worktree '.length))
          .filter((p) => p !== repoDir.replace(/\\/g, '/'));

        let target: string | undefined;
        if (branch) {
          target = candidates.find((p) => p.replace(/\\/g, '/').endsWith(branch.replace(/[/\\]/g, '__')));
        } else if (candidates.length === 1) {
          target = candidates[0];
        } else if (candidates.length > 1) {
          throw new AgileError(`该仓库有多个 worktree，请指定分支：\n${candidates.join('\n')}`);
        }
        if (!target) throw new AgileError('未找到对应的 worktree');

        await git(repoDir, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), target]);
        console.log(ui.ok(`worktree 已移除：${path.relative(root, target)}`));
        if (branch) {
          const del = await gitTry(repoDir, ['branch', '-D', branch]);
          if (del.ok) console.log(ui.ok(`分支已删除：${branch}`));
          else console.log(ui.warn(`分支 ${branch} 未删除（可能未合并）：${del.stderr.split('\n')[0]}`));
        }
      }),
  );
