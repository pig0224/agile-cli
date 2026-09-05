import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { currentBranch, git, gitTry } from '../core/git.js';
import { loadSettings } from '../core/config.js';
import { syncWorkspace } from '../core/sync.js';
import * as ui from '../ui.js';

/** worktree 存放根目录：workspace 下 .worktrees/（已 gitignore） */
const WORKTREE_ROOT = '.worktrees';

/** 自动同步外部资源（tech-specs/biz-tech-docs/模板/插件，同 agile sync）：失败仅警告不阻塞，基于现有状态继续 */
async function autoSync(dir: string, label: string): Promise<void> {
  try {
    const settings = await loadSettings(dir);
    const steps = await syncWorkspace(dir, settings);
    for (const s of steps) {
      if (s.status === 'warn' || s.status === 'failed') console.log(ui.warn(`${label}：${s.name} ${s.detail}`));
    }
  } catch (e) {
    console.log(ui.warn(`${label}失败（继续）：${(e as Error).message}`));
  }
}

export const worktreeCommand = new Command('worktree')
  .description(
    '开发环境管理：为 workspace 根仓库创建隔离的 git worktree（.worktrees/<分支>，含完整工作区；创建后自动同步外部仓库与插件）',
  )
  .addCommand(
    new Command('create')
      .description(
        [
          '创建 workspace worktree，如 agile worktree create feature/STO-001。',
          '分支来源三分支：① 本地已有该分支 → 直接检出；② 远端 origin 已有 → 跟踪检出（协作场景：负责人推了需求分支，另一端直接拉取）；',
          '③ 都没有 → 以 --base（默认当前 HEAD）新建分支。',
          '创建前自动同步主仓外部资源（同 agile sync，失败仅警告不阻塞）；创建后自动在 worktree 内补一次 sync',
          '（settings.json 随仓库检出，而 tech-specs/biz-tech-docs 不入库，需在 worktree 内独立 clone/拉取）。',
        ].join('\n        '),
      )
      .argument('<branch>', '开发分支名，如 feature/STO-001（目录名中 / 与 \\ 会转写为 __）')
      .option('--base <ref>', '新建分支时的基准分支/commit，默认当前 HEAD（本地/远程已有该分支时无效）')
      .action(async (branch: string, opts: { base?: string }) => {
        const root = requireWorkspaceRoot();

        // 0. 前置：workspace 仓库必须有首次提交（worktree 基于已有 commit）
        const hasHead = await gitTry(root, ['rev-parse', '--verify', 'HEAD']);
        if (!hasHead.ok) {
          throw new AgileError(
            'workspace 仓库还没有首次提交，无法创建 worktree。请先完成初始提交（如 settings.json/抽屉骨架/项目代码）后再试。',
          );
        }

        // 1. 主仓自动同步外部资源（先于创建：基于同步后的状态创建）
        await autoSync(root, '自动同步');

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

        // 3. worktree 内补一次外部资源同步：git worktree 只检出仓库内文件，
        //    tech-specs/biz-tech-docs 是 gitignore 的外部仓库，不会跟随检出——在 worktree 目录内独立 clone/拉取。
        //    失败仅警告不阻塞（开发中可进入 worktree 手动执行 agile sync）。
        await autoSync(target, 'worktree 内同步');

        const wtBranch = await currentBranch(target);
        console.log(ui.ok(`worktree 已创建：${path.relative(root, target)}（分支 ${wtBranch}）`));
        console.log(ui.dim(`开发完成后：agile worktree remove ${branch}`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出所有 workspace worktree（分支 + 目录）')
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
      .description('移除 worktree 并删除对应分支（分支未合并时保留，需人工处理）')
      .argument('<branch>', '分支名（与 create 时一致，如 feature/STO-001）')
      .option('--force', '强制移除（丢弃 worktree 内未提交改动，谨慎使用）')
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
