import { describe, expect, it } from 'vitest';
import { parseWorktreeList, worktreeDirName } from '../src/core/git.js';

describe('parseWorktreeList（git worktree list --porcelain 输出解析）', () => {
  it('按空行分块解析 path 与 branch', () => {
    const out = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/feature__STO-001',
      'HEAD def456',
      'branch refs/heads/feature/STO-001',
      '',
    ].join('\n');
    expect(parseWorktreeList(out)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.worktrees/feature__STO-001', branch: 'feature/STO-001' },
    ]);
  });

  it('detached HEAD 无 branch 行 → branch 为 null', () => {
    const out = ['worktree /repo/.worktrees/tmp', 'HEAD abc123', 'detached', ''].join('\n');
    expect(parseWorktreeList(out)).toEqual([{ path: '/repo/.worktrees/tmp', branch: null }]);
  });

  it('Windows 反斜杠路径原样保留（比较交给 samePath 归一）', () => {
    const out = ['worktree F:\\ws', 'branch refs/heads/main', ''].join('\n');
    expect(parseWorktreeList(out)).toEqual([{ path: 'F:\\ws', branch: 'main' }]);
  });

  it('空输出返回空数组', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('worktreeDirName（分支名 → 目录名转写）', () => {
  it('斜杠转双下划线（Windows 目录名禁 /）', () => {
    expect(worktreeDirName('feature/STO-001')).toBe('feature__STO-001');
  });

  it('反斜杠同样转写', () => {
    expect(worktreeDirName('a\\b')).toBe('a__b');
  });

  it('无分隔符分支名原样返回', () => {
    expect(worktreeDirName('main')).toBe('main');
  });
});
