import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findWorkspaceRoot, requireWorkspaceRoot } from '../src/core/paths.js';
import { loadSettings, saveSettings } from '../src/core/config.js';
import { SettingsSchema } from '../src/core/schemas.js';
import { AgileError } from '../src/core/errors.js';
import { scaffoldEmptyProject, workspaceClaudeMdContent } from '../src/core/scaffold.js';

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

  it('requireWorkspaceRoot：workspace 外抛中文报错（写操作类命令保留的必要边界）', async () => {
    expect(() => requireWorkspaceRoot(os.tmpdir())).toThrow(AgileError);
    expect(() => requireWorkspaceRoot(os.tmpdir())).toThrow(/agile init workspace/);
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

  it('version 只允许 1（2.0.x 存量）或 2（当前）', () => {
    expect(SettingsSchema.safeParse({ ...MINIMAL, version: 2 }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...MINIMAL, version: 3 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...MINIMAL, version: 9 }).success).toBe(false);
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

  it('settings.json version：v1（2.0.x 存量）兼容读取并归一为 v2，v2 原样通过', async () => {
    const legacy = await tmp();
    await fs.mkdir(path.join(legacy, '.agile'), { recursive: true });
    await fs.writeFile(path.join(legacy, '.agile', 'settings.json'), JSON.stringify(MINIMAL), 'utf8');
    expect((await loadSettings(legacy)).version).toBe(2);

    const current = await tmp();
    await fs.mkdir(path.join(current, '.agile'), { recursive: true });
    await fs.writeFile(
      path.join(current, '.agile', 'settings.json'),
      JSON.stringify({ ...MINIMAL, version: 2 }),
      'utf8',
    );
    expect((await loadSettings(current)).version).toBe(2);
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

  it('workspaceClaudeMdContent：五类目录表按实际路径渲染 + 项目导航指针', () => {
    const md = workspaceClaudeMdContent('demo-ws', {
      techSpecs: 'specs',
      bizTechDocs: 'kb',
      bizProductDocs: 'prd',
      projects: 'code',
      processDocs: 'process',
    });
    expect(md).toContain('# CLAUDE.md — demo-ws');
    expect(md).toContain('| specs/ |');
    expect(md).toContain('| kb/ |');
    expect(md).toContain('| code/ |');
    expect(md).toContain('| process/ |');
    // 导航不复制事实源：目录详情指向抽屉 README，项目细节指向项目级 CLAUDE.md
    expect(md).toContain('code/<项目>/CLAUDE.md');
    expect(md).toContain('无 design.md 不开发');
    expect(md).toContain('.agile/settings.json');
  });
});
