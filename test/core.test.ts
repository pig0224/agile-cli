import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findWorkspaceRoot } from '../src/core/paths.js';
import { parseYaml, loadSettings, saveSettings } from '../src/core/config.js';
import { SettingsSchema } from '../src/core/schemas.js';
import { AgileError } from '../src/core/errors.js';
import { createTaskDocs, TASK_ID_RE } from '../src/core/task.js';
import { scaffoldEmptyProject } from '../src/core/scaffold.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-test-'));
}

const MINIMAL = { version: 1, name: 't', created: '2026-01-01' };

describe('paths', () => {
  it('findWorkspaceRoot 逐级向上查找（探针 = .agile/settings.json）', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(path.join(dir, '.agile', 'settings.json'), JSON.stringify(MINIMAL), 'utf8');
    const nested = path.join(dir, 'a', 'b', 'c');
    await fs.mkdir(nested, { recursive: true });
    expect(findWorkspaceRoot(nested)).toBe(dir);
    expect(findWorkspaceRoot(os.tmpdir())).toBeNull();
  });
});

describe('settings schema', () => {
  it('最小配置：默认值补齐（paths/repos/plugins/templates）', () => {
    const r = SettingsSchema.safeParse(MINIMAL);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.paths.projects).toBe('projects');
    expect(r.data.paths.processDocs).toBe('process-docs');
    expect(r.data.repos).toEqual({});
    expect(r.data.defaultBranch).toBe('main');
    expect(r.data.plugins.dependencies).toEqual({});
    expect(r.data.templates.registry).toContain('agile-templates');
  });

  it('repos 条目：url 必填，ref 可选（版本锁定预留）', () => {
    const bad = SettingsSchema.safeParse({ ...MINIMAL, repos: { techSpecs: {} } });
    expect(bad.success).toBe(false);
    const good = SettingsSchema.safeParse({
      ...MINIMAL,
      repos: { techSpecs: { url: 'git@x:spec.git', ref: 'v1' } },
    });
    expect(good.success).toBe(true);
  });

  it('version 必须为 1', () => {
    expect(SettingsSchema.safeParse({ ...MINIMAL, version: 2 }).success).toBe(false);
  });
});

describe('config 读写', () => {
  it('loadSettings/saveSettings 往返', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(path.join(dir, '.agile', 'settings.json'), JSON.stringify(MINIMAL), 'utf8');
    const settings = await loadSettings(dir);
    settings.repos.techSpecs = { url: 'git@x:spec.git' };
    await saveSettings(dir, settings);
    const reloaded = await loadSettings(dir);
    expect(reloaded.repos.techSpecs?.url).toBe('git@x:spec.git');
  });

  it('文件缺失 / 坏 JSON / schema 不合法 → 中文报错', async () => {
    const missing = await tmp();
    await expect(loadSettings(missing)).rejects.toThrow(/未找到 .*settings\.json.*init workspace/s);

    const broken = await tmp();
    await fs.mkdir(path.join(broken, '.agile'), { recursive: true });
    await fs.writeFile(path.join(broken, '.agile', 'settings.json'), '{oops', 'utf8');
    await expect(loadSettings(broken)).rejects.toThrow(/不是合法的 JSON/);

    const invalid = await tmp();
    await fs.mkdir(path.join(invalid, '.agile'), { recursive: true });
    await fs.writeFile(path.join(invalid, '.agile', 'settings.json'), JSON.stringify({ ...MINIMAL, version: 9 }), 'utf8');
    await expect(loadSettings(invalid)).rejects.toThrow(/格式校验失败/);
  });

  it('parseYaml 保留给模板注册中心（registry.yaml）使用', () => {
    expect(() => parseYaml('version: [', SettingsSchema, 'registry.yaml')).toThrow(AgileError);
  });
});

describe('task', () => {
  it('TASK_ID_RE 匹配需求编号', () => {
    expect(TASK_ID_RE.test('STO-001')).toBe(true);
    expect(TASK_ID_RE.test('BUG-12')).toBe(false);
    expect(TASK_ID_RE.test('STO-1')).toBe(false);
  });

  it('createTaskDocs 生成标准任务目录（7 个文件，implementation 含 be/fe 角色文件，幂等）', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(path.join(dir, '.agile', 'settings.json'), JSON.stringify(MINIMAL), 'utf8');
    const taskDir = await createTaskDocs(dir, 'STO-042');
    const files = (await fs.readdir(taskDir)).sort();
    expect(files).toEqual([
      'design.md',
      'implementation-be.md',
      'implementation-fe.md',
      'implementation.md',
      'release.md',
      'requirement.md',
      'review.md',
    ]);
    const req = await fs.readFile(path.join(taskDir, 'requirement.md'), 'utf8');
    expect(req).toContain('STO-042');
    // 幂等：再次创建不覆盖
    await fs.appendFile(path.join(taskDir, 'requirement.md'), 'USER-CONTENT', 'utf8');
    await createTaskDocs(dir, 'STO-042');
    expect(await fs.readFile(path.join(taskDir, 'requirement.md'), 'utf8')).toContain('USER-CONTENT');
  });
});

describe('scaffold', () => {
  it('scaffoldEmptyProject 生成空项目骨架（仅 README，含项目名）', async () => {
    const dir = await tmp();
    const dest = path.join(dir, 'projects', 'my-lib');
    await scaffoldEmptyProject(dest, 'my-lib');
    const files = await fs.readdir(dest);
    expect(files).toEqual(['README.md']);
    const readme = await fs.readFile(path.join(dest, 'README.md'), 'utf8');
    expect(readme).toContain('# my-lib');
    expect(readme).toContain('空项目骨架');
  });
});
