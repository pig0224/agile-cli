import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertValidRepoPath, findWorkspaceRoot } from '../src/core/paths.js';
import { parseYaml, toYaml } from '../src/core/config.js';
import { RegistrySchema, WorkspaceSchema } from '../src/core/schemas.js';
import { parseGitmodules } from '../src/core/gitmodules.js';
import { matchRepo } from '../src/core/sync.js';
import { AgileError } from '../src/core/errors.js';
import { scaffoldProject, PROJECT_TYPES } from '../src/core/templates.js';
import { createTaskDocs, TASK_ID_RE } from '../src/core/task.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-test-'));
}

describe('paths', () => {
  it('assertValidRepoPath 拒绝非法路径', () => {
    expect(() => assertValidRepoPath('C:/abs')).toThrow(AgileError);
    expect(() => assertValidRepoPath('../escape')).toThrow(AgileError);
    expect(() => assertValidRepoPath('.agile/evil')).toThrow(AgileError);
    expect(() => assertValidRepoPath('a b')).toThrow(AgileError);
    expect(() => assertValidRepoPath('projects/order-service')).not.toThrow();
  });

  it('findWorkspaceRoot 逐级向上查找', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(path.join(dir, '.agile', 'workspace.yaml'), '', 'utf8');
    const nested = path.join(dir, 'a', 'b', 'c');
    await fs.mkdir(nested, { recursive: true });
    expect(findWorkspaceRoot(nested)).toBe(dir);
    expect(findWorkspaceRoot(os.tmpdir())).toBeNull();
  });
});

describe('config schema', () => {
  it('workspace：必填校验 + 默认值', () => {
    const ws = parseYaml('version: 1\nname: x\ncreated: 2026-01-01', WorkspaceSchema, 'workspace.yaml');
    expect(ws.paths.projects).toBe('projects');
    expect(ws.hooks).toEqual([]);
    expect(ws.defaultBranch).toBe('main');
    expect(() =>
      parseYaml('version: 2\nname: x\ncreated: d', WorkspaceSchema, 'workspace.yaml'),
    ).toThrow(/格式校验失败/);
  });

  it('registry：解析并保留 pin/branch', () => {
    const reg = parseYaml(
      'version: 1\nrepositories:\n  projects/foo:\n    url: git@x:foo.git\n    branch: dev\n    pin: abc123',
      RegistrySchema,
      'registry.yaml',
    );
    expect(reg.repositories['projects/foo']?.pin).toBe('abc123');
    expect(toYaml(reg)).toContain('pin: abc123');
  });
});

describe('gitmodules 解析', () => {
  it('解析 submodule 段', async () => {
    const dir = await tmp();
    await fs.writeFile(
      path.join(dir, '.gitmodules'),
      '[submodule "tech-specs"]\n\tpath = tech-specs\n\turl = git@x:spec.git\n\tbranch = main\n\n[submodule "projects/foo"]\n\tpath = projects/foo\n\turl = https://x/foo.git\n',
      'utf8',
    );
    const entries = await parseGitmodules(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ path: 'tech-specs', url: 'git@x:spec.git', branch: 'main' });
    expect(entries[1]).toMatchObject({ path: 'projects/foo', url: 'https://x/foo.git' });
  });

  it('文件不存在返回空', async () => {
    const dir = await tmp();
    expect(await parseGitmodules(dir)).toEqual([]);
  });
});

describe('matchRepo', () => {
  it('支持 * 与 **', () => {
    expect(matchRepo('projects/*', 'projects/foo')).toBe(true);
    expect(matchRepo('projects/*', 'projects/foo/bar')).toBe(false);
    expect(matchRepo('projects/**', 'projects/foo/bar')).toBe(true);
    expect(matchRepo('tech-specs', 'tech-specs')).toBe(true);
    expect(matchRepo('tech-specs', 'tech-specs/sub')).toBe(false);
  });
});

describe('templates', () => {
  it.each(PROJECT_TYPES)('%s 模板占位符替换', async (type) => {
    const dir = await tmp();
    await scaffoldProject(path.join(dir, type), `demo-${type}`, type);
    // 检查生成的文本文件不再含占位符
    const files: string[] = [];
    async function walk(d: string) {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(json|ts|tsx|go|xml|md|mod|yml|java)$/.test(e.name)) files.push(p);
      }
    }
    await walk(path.join(dir, type));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const content = await fs.readFile(f, 'utf8');
      // 注：JSX 的 style={{...}} 合法含 "{{"，只断言模板占位符已消失
      expect(content, `${f} 仍含占位符`).not.toContain('{{name}}');
      expect(content, `${f} 仍含占位符`).not.toContain('{{safeName}}');
    }
  });
});

describe('task', () => {
  it('TASK_ID_RE 匹配需求编号', () => {
    expect(TASK_ID_RE.test('STO-001')).toBe(true);
    expect(TASK_ID_RE.test('BUG-12')).toBe(false);
    expect(TASK_ID_RE.test('STO-1')).toBe(false);
  });

  it('createTaskDocs 生成五文档（幂等）', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.agile', 'workspace.yaml'),
      toYaml({ version: 1, name: 't', created: '2026-01-01' }),
      'utf8',
    );
    const taskDir = await createTaskDocs(dir, 'STO-042');
    const files = (await fs.readdir(taskDir)).sort();
    expect(files).toEqual(['design.md', 'implementation.md', 'release.md', 'requirement.md', 'review.md']);
    const req = await fs.readFile(path.join(taskDir, 'requirement.md'), 'utf8');
    expect(req).toContain('STO-042');
    // 幂等：再次创建不覆盖
    await fs.appendFile(path.join(taskDir, 'requirement.md'), 'USER-CONTENT', 'utf8');
    await createTaskDocs(dir, 'STO-042');
    expect(await fs.readFile(path.join(taskDir, 'requirement.md'), 'utf8')).toContain('USER-CONTENT');
  });
});
