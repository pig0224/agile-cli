import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import { loadSettings, saveSettings } from '../src/core/config.js';
import { planPluginSync, readInstalledClaudePlugins, syncPlugins } from '../src/core/claude-plugins.js';

// syncPlugins 执行路径测试：mock 掉 claude CLI 调用（runClaude → execa），Windows 下无需伪造可执行脚本
vi.mock('execa', () => ({ execa: vi.fn() }));

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-plugin-test-'));
}

const mkInstalled = (entries: Record<string, unknown[]>) => entries;

describe('planPluginSync', () => {
  const installed = (ids: string[]) =>
    new Map(
      ids.map((pluginId) => [
        pluginId,
        { pluginId, scope: 'user', installPath: `/cache/${pluginId}`, version: '0.1.0' },
      ]),
    );

  it('声明未装 → install；已装同市场 → update（sync 时检查更新）', () => {
    const plan = planPluginSync(
      { agile: { marketplace: 'fcc' }, other: {} },
      installed(['agile@fcc']),
      'fcc',
    );
    expect(plan.actions).toEqual([
      { kind: 'update', name: 'agile', marketplace: 'fcc', pluginId: 'agile@fcc' },
      { kind: 'install', name: 'other', marketplace: 'fcc', pluginId: 'other@fcc' },
    ]);
    expect(plan.undeclared).toEqual([]);
    expect(plan.refLocked).toEqual([]);
  });

  it('已装同名的其他市场 → conflict，不自动替换', () => {
    const plan = planPluginSync({ agile: {} }, installed(['agile@corp']), 'fcc');
    expect(plan.actions).toEqual([
      {
        kind: 'conflict',
        name: 'agile',
        declaredMarketplace: 'fcc',
        installedPluginId: 'agile@corp',
        installedMarketplace: 'corp',
      },
    ]);
  });

  it('本机已装未声明 → undeclared（信息性）', () => {
    const plan = planPluginSync({ agile: {} }, installed(['agile@fcc', 'zzz@fcc']), 'fcc');
    expect(plan.undeclared).toEqual(['zzz@fcc']);
  });

  it('ref 版本锁定 → 记入 refLocked（锁定安装暂未实现）', () => {
    const plan = planPluginSync(
      { agile: { ref: 'abc123' }, plain: {} },
      installed([]),
      'fcc',
    );
    expect(plan.refLocked).toEqual(['agile']);
    expect(plan.actions).toEqual([
      { kind: 'install', name: 'agile', marketplace: 'fcc', pluginId: 'agile@fcc' },
      { kind: 'install', name: 'plain', marketplace: 'fcc', pluginId: 'plain@fcc' },
    ]);
  });

  it('marketplace 缺省用 defaultMarketplace', () => {
    const plan = planPluginSync({ agile: {} }, installed([]), 'my-mkt');
    expect(plan.actions[0]).toMatchObject({ kind: 'install', marketplace: 'my-mkt', pluginId: 'agile@my-mkt' });
  });
});

describe('readInstalledClaudePlugins', () => {
  it('解析 installed_plugins.json（v2 结构，多 scope 取第一条）', async () => {
    const dir = await tmp();
    await fs.writeFile(
      path.join(dir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: mkInstalled({
          'agile@fcc': [
            { scope: 'user', installPath: 'C:/cache/agile/0.1.0', version: '0.1.0', gitCommitSha: 'abc' },
            { scope: 'project', installPath: 'C:/cache/agile/p', version: '0.1.0' },
          ],
        }),
      }),
      'utf8',
    );
    const result = await readInstalledClaudePlugins(dir);
    expect(result.size).toBe(1);
    expect(result.get('agile@fcc')).toMatchObject({ scope: 'user', gitCommitSha: 'abc' });
  });

  it('文件缺失 / 坏 JSON / 未知结构 → 空实况', async () => {
    const missing = await tmp();
    expect((await readInstalledClaudePlugins(missing)).size).toBe(0);

    const broken = await tmp();
    await fs.writeFile(path.join(broken, 'installed_plugins.json'), '{oops', 'utf8');
    expect((await readInstalledClaudePlugins(broken)).size).toBe(0);
  });
});

describe('syncPlugins（执行路径，mock claude CLI）', () => {
  type FakeResult = { exitCode: number; stdout: string; stderr: string };
  const ok: FakeResult = { exitCode: 0, stdout: 'ok', stderr: '' };
  const execaMock = vi.mocked(execa);
  const calls = () => execaMock.mock.calls.map((c) => c[1] as string[]);

  /** 临时 installed_plugins.json（claudePluginsDir 注入 syncPlugins 的实况读取） */
  async function writeInstalled(dir: string, entries: Record<string, unknown[]>): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: entries }), 'utf8');
  }

  async function mkSettings(deps: Record<string, { marketplace?: string }>) {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(path.join(dir, '.agile', 'settings.json'), JSON.stringify({ version: 1, name: 't', created: '2026-01-01' }), 'utf8');
    const settings = await loadSettings(dir);
    for (const [name, dep] of Object.entries(deps)) settings.plugins.dependencies[name] = dep;
    return settings;
  }

  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockResolvedValue(ok as never);
  });

  it('已装+声明 → 先市场刷新再 plugin update；sha 不变 → 已是最新（无汇总重启提示）', async () => {
    const settings = await mkSettings({ agile: {} });
    const instDir = await tmp();
    await writeInstalled(instDir, { 'agile@fcc': [{ scope: 'user', gitCommitSha: 'aaa' }] });

    const steps = await syncPlugins(instDir, settings, { claudePluginsDir: instDir });

    expect(calls()).toEqual([
      ['plugin', 'marketplace', 'update', 'fcc'],
      ['plugin', 'update', 'agile@fcc'],
    ]);
    expect(steps).toContainEqual({ name: 'agile@fcc', status: 'done', detail: '已是最新' });
    expect(steps.filter((s) => s.name === '插件' && s.status === 'done')).toHaveLength(0);
  });

  it('plugin update 后 gitCommitSha 变化 → 已更新（重启生效）+ 汇总重启提示', async () => {
    const settings = await mkSettings({ agile: {} });
    const instDir = await tmp();
    await writeInstalled(instDir, { 'agile@fcc': [{ scope: 'user', gitCommitSha: 'aaa' }] });
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'plugin' && args[1] === 'update') {
        await writeInstalled(instDir, { 'agile@fcc': [{ scope: 'user', gitCommitSha: 'bbb' }] });
      }
      return ok as never;
    });

    const steps = await syncPlugins(instDir, settings, { claudePluginsDir: instDir });

    expect(steps).toContainEqual({ name: 'agile@fcc', status: 'done', detail: '已更新到市场最新（重启 Claude Code 会话生效）' });
    expect(steps).toContainEqual({ name: '插件', status: 'done', detail: '重启 Claude Code 会话后生效' });
  });

  it('市场刷新失败 → warn 降级沿用本地已装版本，不调 plugin update（同市场后续插件同样降级）', async () => {
    const settings = await mkSettings({ agile: {}, other: { marketplace: 'fcc' } });
    const instDir = await tmp();
    await writeInstalled(instDir, {
      'agile@fcc': [{ scope: 'user', gitCommitSha: 'a' }],
      'other@fcc': [{ scope: 'user', gitCommitSha: 'b' }],
    });
    execaMock.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'network down' } as never);

    const steps = await syncPlugins(instDir, settings, { claudePluginsDir: instDir });

    const warns = steps.filter((s) => s.status === 'warn');
    expect(warns).toHaveLength(2);
    expect(warns[0]?.detail).toContain('claude plugin marketplace update fcc');
    expect(warns[1]?.detail).toContain('沿用本地已装版本');
    expect(calls().some((a) => a[0] === 'plugin' && a[1] === 'update')).toBe(false);
  });

  it('plugin update 失败 → warn 沿用本地已装版本', async () => {
    const settings = await mkSettings({ agile: {} });
    const instDir = await tmp();
    await writeInstalled(instDir, { 'agile@fcc': [{ scope: 'user', gitCommitSha: 'aaa' }] });
    execaMock.mockImplementation(async (_cmd: string, args: string[]) =>
      args[0] === 'plugin' && args[1] === 'update' ? ({ exitCode: 1, stdout: '', stderr: 'boom' } as never) : (ok as never),
    );

    const steps = await syncPlugins(instDir, settings, { claudePluginsDir: instDir });

    expect(steps).toContainEqual({ name: 'agile@fcc', status: 'warn', detail: expect.stringContaining('更新失败，沿用本地已装版本') });
  });

  it('声明未装 → 走 install（marketplace add 兜底 + install）不动', async () => {
    const settings = await mkSettings({ agile: {} });
    const instDir = await tmp(); // 不写 installed_plugins.json → 空实况

    const steps = await syncPlugins(instDir, settings, { claudePluginsDir: instDir });

    expect(calls()).toEqual([
      ['plugin', 'marketplace', 'add', settings.plugins.marketplace],
      ['plugin', 'install', 'agile@fcc'],
    ]);
    expect(steps).toContainEqual({ name: 'agile@fcc', status: 'done', detail: '已安装' });
    expect(steps).toContainEqual({ name: '插件', status: 'done', detail: '重启 Claude Code 会话后生效' });
  });

  it('dry-run：已装插件出计划且不调 claude', async () => {
    const settings = await mkSettings({ agile: {} });
    const instDir = await tmp();
    await writeInstalled(instDir, { 'agile@fcc': [{ scope: 'user', gitCommitSha: 'aaa' }] });

    const steps = await syncPlugins(instDir, settings, { dryRun: true, claudePluginsDir: instDir });

    expect(steps).toContainEqual({ name: 'agile@fcc', status: 'skipped', detail: '[dry-run] 将检查更新' });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('实况无 gitCommitSha → 更新成功后报已检查更新（无法判定是否变化）', async () => {
    const settings = await mkSettings({ agile: {} });
    const instDir = await tmp();
    await writeInstalled(instDir, { 'agile@fcc': [{ scope: 'user', installPath: 'C:/cache/agile' }] });

    const steps = await syncPlugins(instDir, settings, { claudePluginsDir: instDir });

    expect(steps).toContainEqual({ name: 'agile@fcc', status: 'done', detail: '已检查更新' });
  });
});

describe('settings.json 插件依赖声明（plugins.dependencies）', () => {
  it('依赖声明读写往返（install 登记 / uninstall 移除同款路径）', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.agile', 'settings.json'),
      JSON.stringify({ version: 1, name: 't', created: '2026-01-01' }),
      'utf8',
    );
    // 登记（类 npm install --save）
    const settings = await loadSettings(dir);
    settings.plugins.dependencies['agile'] = { marketplace: 'fcc' };
    await saveSettings(dir, settings);
    expect((await loadSettings(dir)).plugins.dependencies).toEqual({ agile: { marketplace: 'fcc' } });

    // 移除（类 npm uninstall）
    const next = await loadSettings(dir);
    delete next.plugins.dependencies['agile'];
    await saveSettings(dir, next);
    expect((await loadSettings(dir)).plugins.dependencies).toEqual({});
  });
});
