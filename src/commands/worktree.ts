import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { currentBranch, git, gitTry } from '../core/git.js';
import { computeSyncPlan, executeSyncPlan } from '../core/sync.js';
import { loadRegistry } from '../core/config.js';
import * as ui from '../ui.js';

/** worktree 存放根目录：workspace 下 .worktrees/（已 gitignore） */
const WORKTREE_ROOT = '.worktrees';

/** worktree create 前自动同步外部仓库（失败仅警告不阻塞，基于现有状态创建） */
async function autoSync(root: string): Promise<void> {
  try {
    const registry = await loadRegistry(root);
    const plan = await computeSyncPlan(root, registry);
    if (plan.adds.length + plan.updates.length + plan.removes.length > 0) {
      await executeSyncPlan(root, registry, plan);
    }
  } catch (e) {
    console.log(ui.warn(`自动同步外部仓库失败（继续创建 worktree）：${(e as Error).message}`));
  }
}

export const worktreeCommand = new Command('worktree')
  .description('开发环境管理：为 workspace 根仓库创建隔离的 git worktree（含全部代码的完整开发环境）')
  .addCommand(
    new Command('create')
      .description('创建 workspace worktree，如 agile worktree create feature/STO-001（创建前自动同步外部仓库；本地或远程已有该分支时直接检出/跟踪，多人可各自拉取同一需求分支）')
      .argument('<branch>', '开发分支名，如 feature/STO-001')
      .option('--base <ref>', '基准分支/commit，默认当前 HEAD（仅新建分支时生效）')
      .action(async (branch: string, opts: { base?: string }) => {
        const root = requireWorkspaceRoot();

        // 0. 前置：workspace 仓库必须有首次提交（worktree 基于已有 commit）
        const hasHead = await gitTry(root, ['rev-parse', '--verify', 'HEAD']);
        if (!hasHead.ok) {
          throw new AgileError(
            'workspace 仓库还没有首次提交，无法创建 worktree。请先完成初始提交（如 registry/抽屉骨架/项目代码）后再试。',
          );
        }

        // 1. 自动同步外部仓库（tech-specs 等）
        await autoSync(root);

        // 2. 解析分支来源：本地已有 → 直接检出；远程已有 → 跟踪检出（协作场景：负责人推了需求分支，另一端拉取）；
        //    都没有 → 以 base 新建。fetch 失败忽略（离线时用本地已有的远程引用判断）。
        const target = path.join(root, WORKTREE_ROOT, branch.replace(/[/\\]/g, '__'));
        await gitTry(root, ['fetch', 'origin', branch, '--quiet']);
        const hasLocal = (await gitTry(root, ['rev-parse', '--verify', `refs/heads/${branch}`])).ok;
        const hasRemote = (await gitTry(root, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])).ok;
        let addArgs: string[];
        if (hasLocal) {
          addArgs = ['worktree', 'add', target, branch];
          console.log(ui.dim(`本地分支已存在，直接检出：${branch}`));
        } else if (hasRemote) {
          addArgs = ['worktree', 'add', '--track', '-b', branch, target, `origin/${branch}`];
          console.log(ui.dim(`远程分支已存在，创建跟踪分支：${branch}（origin/${branch}）`));
        } else {
          addArgs = ['worktree', 'add', '-b', branch, target, opts.base ?? 'HEAD'];
        }
        try {
          await git(root, addArgs);
        } catch (e) {
          // 失败时清理半成品目录（git 可能已创建目录）
          await import('node:fs/promises').then((fs) => fs.rm(target, { recursive: true, force: true }));
          throw e;
        }

        const wtBranch = await currentBranch(target);
        console.log(ui.ok(`worktree 已创建：${path.relative(root, target)}（分支 ${wtBranch}）`));
        console.log(ui.dim(`开发完成后：agile worktree remove ${branch}`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出所有 workspace worktree')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const r = await gitTry(root, ['worktree', 'list', '--porcelain']);
        if (!r.ok) {
          throw new AgileError(`获取 worktree 列表失败：${r.stderr}`);
        }
        let found = false;
        for (const block of r.stdout.split('\n\n')) {
          const lines = block.split('\n');
          const wtLine = lines.find((l) => l.startsWith('worktree '));
          if (!wtLine) continue;
          const wtPath = path.resolve(wtLine.slice('worktree '.length));
          if (path.resolve(root) === wtPath) continue;
          if (wtPath.includes(`${path.sep}.git${path.sep}modules${path.sep}`)) continue;
          const branchLine = lines.find((l) => l.startsWith('branch '));
          const branch = branchLine ? branchLine.slice('branch refs/heads/'.length) : '(detached)';
          found = true;
          console.log(`${ui.info(branch.padEnd(28))}${path.relative(root, wtPath)}`);
        }
        if (!found) console.log(ui.dim('（无 worktree）'));
      }),
  )
  .addCommand(
    new Command('remove')
      .description('移除 worktree（--force 处理含未提交改动的工作区）')
      .argument('<branch>', '分支名（与 create 时一致）')
      .option('--force', '强制移除（丢弃未提交改动）')
      .action(async (branch: string, opts: { force?: boolean }) => {
        const root = requireWorkspaceRoot();
        const target = path.join(root, WORKTREE_ROOT, branch.replace(/[/\\]/g, '__'));
        const fs = await import('node:fs/promises');
        if (!(await fs.stat(target).then(() => true).catch(() => false))) {
          throw new AgileError(`worktree 不存在：${path.relative(root, target)}（agile worktree list 查看）`);
        }
        const rm = await gitTry(root, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), target]);
        if (!rm.ok) {
          // 不是有效 worktree（如创建失败残留的半成品目录）：直接删除目录
          await fs.rm(target, { recursive: true, force: true });
          console.log(ui.warn(`已清理非 worktree 目录：${path.relative(root, target)}`));
          return;
        }
        console.log(ui.ok(`worktree 已移除：${path.relative(root, target)}`));
        const del = await gitTry(root, ['branch', '-D', branch]);
        if (del.ok) console.log(ui.ok(`分支已删除：${branch}`));
        else console.log(ui.warn(`分支 ${branch} 未删除（可能未合并）：${del.stderr.split('\n')[0]}`));
      }),
  );
