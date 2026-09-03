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

/** 判断目录是否为 git 仓库（含 worktree / submodule） */
export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await gitTry(dir, ['rev-parse', '--git-dir']);
  return r.ok;
}

/** 当前分支名；detached HEAD 时返回 '(detached)' */
export async function currentBranch(cwd: string): Promise<string> {
  const out = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return out || '(detached)';
}

export async function currentCommit(cwd: string): Promise<string> {
  return git(cwd, ['rev-parse', 'HEAD']);
}

/** 工作区是否有未提交改动（含 untracked） */
export async function isDirty(cwd: string): Promise<boolean> {
  const out = await git(cwd, ['status', '--porcelain']);
  return out.length > 0;
}

/** 探测远端可达性 / 权限：git ls-remote --heads <url> */
export async function checkRemote(url: string, timeoutMs = 15_000): Promise<GitResult> {
  // ls-remote 不依赖本地仓库，cwd 用任意目录即可
  return gitTry(process.cwd(), ['ls-remote', '--heads', url], timeoutMs);
}

export function parseGitUrlName(url: string): string {
  // git@gitlab.example.com:group/repo.git / https://host/group/repo.git / 本地路径
  const cleaned = url.replace(/\\/g, '/').replace(/\.git$/, '');
  const last = cleaned.split('/').pop() ?? cleaned;
  return last.split(':').pop() ?? last;
}
