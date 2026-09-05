import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadSettings, saveSettings } from '../src/core/config.js';
import { planPluginSync, readInstalledClaudePlugins } from '../src/core/claude-plugins.js';

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

  it('声明未装 → install；已装同市场 → skip', () => {
    const plan = planPluginSync(
      { agile: { marketplace: 'fcc' }, other: {} },
      installed(['agile@fcc']),
      'fcc',
    );
    expect(plan.actions).toEqual([
      { kind: 'skip', name: 'agile', pluginId: 'agile@fcc' },
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
