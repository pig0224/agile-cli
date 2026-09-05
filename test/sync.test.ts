import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { computeSyncPlan } from '../src/core/sync.js';
import type { RegistryConfig } from '../src/core/schemas.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-plan-'));
}

async function makeWorkspace(withGitmodules: string | null): Promise<string> {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
  if (withGitmodules != null) {
    await fs.writeFile(path.join(dir, '.gitmodules'), withGitmodules, 'utf8');
  }
  return dir;
}

const REG: RegistryConfig = {
  version: 1,
  repositories: {
    'tech-specs': { url: 'git@x:spec.git', branch: 'main' },
    'projects/foo': { url: 'git@x:foo.git', branch: 'dev' },
  },
};

describe('computeSyncPlan', () => {
  it('全新 workspace：全部进入 adds', async () => {
    const dir = await makeWorkspace(null);
    const plan = await computeSyncPlan(dir, REG);
    expect(plan.adds.map((a) => a.repoPath)).toEqual(['tech-specs', 'projects/foo']);
    expect(plan.removes).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('gitmodules 有、registry 无 → removes', async () => {
    const dir = await makeWorkspace(
      '[submodule "legacy"]\n\tpath = legacy\n\turl = git@x:legacy.git\n',
    );
    const reg: RegistryConfig = { version: 1, repositories: {} };
    const plan = await computeSyncPlan(dir, reg);
    expect(plan.removes).toHaveLength(1);
    expect(plan.removes[0]?.path).toBe('legacy');
  });

  it('registry 与 gitmodules 均有但未初始化 → updates', async () => {
    const dir = await makeWorkspace(
      '[submodule "tech-specs"]\n\tpath = tech-specs\n\turl = git@x:spec.git\n',
    );
    const plan = await computeSyncPlan(dir, REG);
    expect(plan.updates.map((u) => u.repoPath)).toEqual(['tech-specs']);
    expect(plan.adds.map((a) => a.repoPath)).toEqual(['projects/foo']);
  });

  it('URL 变更 → remove + add', async () => {
    const dir = await makeWorkspace(
      '[submodule "tech-specs"]\n\tpath = tech-specs\n\turl = git@OLD:spec.git\n',
    );
    const plan = await computeSyncPlan(dir, REG);
    expect(plan.removes.map((r) => r.path)).toContain('tech-specs');
    const add = plan.adds.find((a) => a.repoPath === 'tech-specs');
    expect(add?.url).toBe('git@x:spec.git');
    expect(add?.reason).toContain('URL 变更');
  });

  it('Windows 本地路径 URL：git 写 .gitmodules 转义的 \\\\ 读回应还原，与 registry 原始路径一致（不触发 URL 变更）', async () => {
    // git config INI 写出时把值中的 `\` 转义为 `\\`（.gitmodules 实际内容为 C:\\Users\\dev\\specs.git）
    const dir = await makeWorkspace(
      '[submodule "tech-specs"]\n\tpath = tech-specs\n\turl = C:\\\\Users\\\\dev\\\\specs.git\n',
    );
    const reg: RegistryConfig = {
      version: 1,
      repositories: { 'tech-specs': { url: 'C:\\Users\\dev\\specs.git', branch: 'main' } },
    };
    const plan = await computeSyncPlan(dir, reg);
    expect(plan.removes).toHaveLength(0);
    expect(plan.adds).toHaveLength(0);
  });

  it('gitmodules url 未转义普通路径不受反转义影响', async () => {
    const dir = await makeWorkspace(
      '[submodule "tech-specs"]\n\tpath = tech-specs\n\turl = git@x:spec.git\n',
    );
    const plan = await computeSyncPlan(dir, {
      version: 1,
      repositories: { 'tech-specs': { url: 'git@x:spec.git', branch: 'main' } },
    });
    expect(plan.removes).toHaveLength(0);
    expect(plan.adds).toHaveLength(0);
  });

  it('骨架目录（仅 README.md）→ takeover', async () => {
    const dir = await makeWorkspace(null);
    await fs.mkdir(path.join(dir, 'tech-specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tech-specs', 'README.md'), '# skeleton', 'utf8');
    const plan = await computeSyncPlan(dir, REG);
    const add = plan.adds.find((a) => a.repoPath === 'tech-specs');
    expect(add?.takeover).toBe(true);
  });

  it('非空目录 → warning 且不 add', async () => {
    const dir = await makeWorkspace(null);
    await fs.mkdir(path.join(dir, 'tech-specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tech-specs', 'a.txt'), 'x', 'utf8');
    await fs.writeFile(path.join(dir, 'tech-specs', 'b.txt'), 'y', 'utf8');
    const plan = await computeSyncPlan(dir, REG);
    expect(plan.adds.find((a) => a.repoPath === 'tech-specs')).toBeUndefined();
    expect(plan.warnings[0]).toContain('tech-specs');
  });

  it('only 过滤：只处理指定仓库及其子路径', async () => {
    const dir = await makeWorkspace(null);
    const plan = await computeSyncPlan(dir, REG, { only: ['projects'] });
    expect(plan.adds.map((a) => a.repoPath)).toEqual(['projects/foo']);
  });
});
