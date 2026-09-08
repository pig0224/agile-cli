import { execa } from 'execa';
import { GitError } from './errors.js';

export interface GitResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 在 cwd 执行 git 命令，不抛错，返回结构化结果 */
export async function gitTry(cwd: string, args: string[], timeoutMs?: number): Promise<GitResult> {
  const r = await execa('git', args, {
    cwd,
    reject: false,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    ok: r.exitCode === 0,
    exitCode: r.exitCode ?? 1,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  };
}

/** 在 cwd 执行 git 命令，失败时抛 GitError */
export async function git(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const r = await gitTry(cwd, args, timeoutMs);
  if (!r.ok) {
    throw new GitError(`git ${args.join(' ')} 执行失败（exit ${r.exitCode}）：${r.stderr || r.stdout}`, args, r.stderr);
  }
  return r.stdout;
}

/** 当前分支名；detached HEAD 时返回 '(detached)' */
export async function currentBranch(cwd: string): Promise<string> {
  const out = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return out || '(detached)';
}

/** 工作区是否有未提交改动（含 untracked） */
export async function isDirty(cwd: string): Promise<boolean> {
  const out = await git(cwd, ['status', '--porcelain']);
  return out.length > 0;
}

/** worktree 分支名 → 存放目录名：/ 与 \ 转写为 __（feature/STO-001 → feature__STO-001） */
export function worktreeDirName(branch: string): string {
  return branch.replace(/[/\\]/g, '__');
}

/** 解析 `git worktree list --porcelain` 输出：每个 worktree 一个 { path, branch }；
 *  branch 为 null 表示 detached HEAD / bare。保持输出顺序。 */
export function parseWorktreeList(output: string): Array<{ path: string; branch: string | null }> {
  const out: Array<{ path: string; branch: string | null }> = [];
  for (const block of output.split('\n\n')) {
    let p: string | null = null;
    let b: string | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) p = line.slice('worktree '.length);
      else if (line.startsWith('branch refs/heads/')) b = line.slice('branch refs/heads/'.length);
    }
    if (p) out.push({ path: p, branch: b });
  }
  return out;
}
