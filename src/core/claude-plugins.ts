import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { z } from 'zod';
import type { PluginDependency, Settings } from './schemas.js';

/** 本团队市场的固定名称（claude plugin install <name>@<marketplace> 的 @ 后缀） */
export const MARKETPLACE_NAME = 'fcc';

/** 调用 Claude Code CLI（本地已装 claude；测试/CI 可用 CLAUDE_CODE_CLI 覆盖） */
export const runClaude = (args: string[]) =>
  execa(process.env.CLAUDE_CODE_CLI ?? 'claude', args, { reject: false, timeout: 120_000, windowsHide: true });

// ---------------------------------------------------------------------------
// Claude Code 全局插件实况（~/.claude/plugins/installed_plugins.json）
// ---------------------------------------------------------------------------

const InstalledEntrySchema = z.object({
  scope: z.string().optional(),
  installPath: z.string().optional(),
  version: z.string().optional(),
  gitCommitSha: z.string().optional(),
});

const InstalledFileSchema = z.object({
  plugins: z.record(z.string(), z.array(InstalledEntrySchema)).optional(),
});

/** 本机一个已安装插件的实况（installed_plugins.json 中同 id 多 scope 时取第一条） */
export interface ClaudeInstallInfo {
  pluginId: string;
  scope: string;
  installPath?: string;
  version?: string;
  gitCommitSha?: string;
}

/** 读取 Claude Code 全局插件安装实况；文件缺失/损坏一律视为空（首次使用或非 Claude 环境） */
export async function readInstalledClaudePlugins(claudePluginsDir?: string): Promise<Map<string, ClaudeInstallInfo>> {
  const dir = claudePluginsDir ?? path.join(os.homedir(), '.claude', 'plugins');
  const result = new Map<string, ClaudeInstallInfo>();
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(dir, 'installed_plugins.json'), 'utf8'));
  } catch {
    return result;
  }
  const parsed = InstalledFileSchema.safeParse(raw);
  if (!parsed.success) return result;
  for (const [pluginId, entries] of Object.entries(parsed.data.plugins ?? {})) {
    // 同 id 多 scope（user/project 等）时优先 user 实况，避免被局部安装的条目误导对照
    const first = entries.find((e) => e.scope === 'user') ?? entries[0];
    if (!first) continue;
    result.set(pluginId, {
      pluginId,
      scope: first.scope ?? 'user',
      installPath: first.installPath,
      version: first.version,
      gitCommitSha: first.gitCommitSha,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 依赖声明 → 同步计划（纯函数）
// ---------------------------------------------------------------------------

export type PluginSyncAction =
  | { kind: 'install'; name: string; marketplace: string; pluginId: string }
  | { kind: 'update'; name: string; marketplace: string; pluginId: string }
  | {
      kind: 'conflict';
      name: string;
      /** 声明的市场名 */
      declaredMarketplace: string;
      /** 本机实际的插件实例（来自其他市场，不自动替换） */
      installedPluginId: string;
      installedMarketplace: string;
    };

export interface PluginSyncPlan {
  actions: PluginSyncAction[];
  /** 本机已安装但当前 workspace 未声明的插件（信息性提示，不做任何处理） */
  undeclared: string[];
  /** 声明了 ref 版本锁定的插件（锁定安装暂未实现，按市场最新安装） */
  refLocked: string[];
}

const splitPluginId = (pluginId: string): [string, string] => {
  const at = pluginId.lastIndexOf('@');
  return at <= 0 ? [pluginId, ''] : [pluginId.slice(0, at), pluginId.slice(at + 1)];
};

/** 由依赖声明与本机实况产出同步计划：缺的装、已装检查更新、市场不符判冲突、绝不卸载 */
export function planPluginSync(
  dependencies: Record<string, PluginDependency>,
  installed: Map<string, ClaudeInstallInfo>,
  defaultMarketplace: string,
): PluginSyncPlan {
  const actions: PluginSyncAction[] = [];
  const refLocked: string[] = [];
  const declaredNames = new Set<string>();

  for (const [name, dep] of Object.entries(dependencies)) {
    declaredNames.add(name);
    const marketplace = dep.marketplace || defaultMarketplace;
    const pluginId = `${name}@${marketplace}`;
    if (installed.has(pluginId)) {
      actions.push({ kind: 'update', name, marketplace, pluginId });
    } else {
      const elsewhere = [...installed.keys()].find((id) => splitPluginId(id)[0] === name);
      if (elsewhere) {
        const [, installedMarketplace] = splitPluginId(elsewhere);
        actions.push({ kind: 'conflict', name, declaredMarketplace: marketplace, installedPluginId: elsewhere, installedMarketplace });
        continue;
      }
      actions.push({ kind: 'install', name, marketplace, pluginId });
    }
    if (dep.ref) refLocked.push(name);
  }

  const undeclared = [...installed.keys()].filter((id) => !declaredNames.has(splitPluginId(id)[0]!));
  return { actions, undeclared, refLocked };
}

// ---------------------------------------------------------------------------
// 插件同步执行（agile sync 与 plugin 命令共用）
// ---------------------------------------------------------------------------

export interface PluginSyncStep {
  name: string;
  status: 'done' | 'skipped' | 'warn' | 'failed';
  detail: string;
}

/** 按 settings.plugins.dependencies 声明收敛本机插件：缺的装、已装检查更新（失联/失败降级沿用本地已装版本）、
 *  市场不符警告，绝不卸载 */
export async function syncPlugins(
  root: string,
  settings: Settings,
  opts: { dryRun?: boolean; /** 测试注入：Claude Code 插件实况目录（缺省 ~/.claude/plugins） */ claudePluginsDir?: string } = {},
): Promise<PluginSyncStep[]> {
  const steps: PluginSyncStep[] = [];
  const dependencies = settings.plugins.dependencies ?? {};
  if (Object.keys(dependencies).length === 0) {
    steps.push({ name: '插件', status: 'skipped', detail: '无依赖声明（agile plugin install <name> 安装并登记）' });
    return steps;
  }

  const installed = await readInstalledClaudePlugins(opts.claudePluginsDir);
  const plan = planPluginSync(dependencies, installed, MARKETPLACE_NAME);
  let marketplaceReady = false;
  let installedAny = false;
  let updatedAny = false;
  /** 已刷新/刷新失败的市场名（claude plugin marketplace update 每市场只跑一次） */
  const refreshed = new Set<string>();
  const refreshFailed = new Set<string>();

  for (const action of plan.actions) {
    if (action.kind === 'update') {
      if (opts.dryRun) {
        steps.push({ name: action.pluginId, status: 'skipped', detail: '[dry-run] 将检查更新' });
        continue;
      }
      // 1. 市场刷新（对已注册市场幂等拉新；add 只兜底注册不拉新，故这里必须显式 update）
      if (refreshFailed.has(action.marketplace)) {
        steps.push({ name: action.pluginId, status: 'warn', detail: '插件市场刷新失败，沿用本地已装版本' });
        continue;
      }
      if (!refreshed.has(action.marketplace)) {
        const mup = await runClaude(['plugin', 'marketplace', 'update', action.marketplace]);
        if (mup.exitCode !== 0) {
          refreshFailed.add(action.marketplace);
          steps.push({
            name: action.pluginId,
            status: 'warn',
            detail: `插件市场刷新失败，沿用本地已装版本（可手动执行：claude plugin marketplace update ${action.marketplace}；${(mup.stderr || mup.stdout || '').split('\n')[0]}）`,
          });
          continue;
        }
        refreshed.add(action.marketplace);
      }
      // 2. 更新到市场最新（插件无 version 字段 → 按 git commit SHA 判定，push 即有新缓存键）
      const upd = await runClaude(['plugin', 'update', action.pluginId]);
      if (upd.exitCode !== 0) {
        steps.push({
          name: action.pluginId,
          status: 'warn',
          detail: `更新失败，沿用本地已装版本（${(upd.stderr || upd.stdout || '').split('\n')[0]}）`,
        });
        continue;
      }
      // 3. 比对更新前后的 gitCommitSha 判定是否真有更新（sha 缺失时无法判定，报已检查更新）
      const before = installed.get(action.pluginId)?.gitCommitSha;
      const after = (await readInstalledClaudePlugins(opts.claudePluginsDir)).get(action.pluginId)?.gitCommitSha;
      if (before !== undefined && after !== undefined && before !== after) {
        updatedAny = true;
        steps.push({ name: action.pluginId, status: 'done', detail: '已更新到市场最新（重启 Claude Code 会话生效）' });
      } else if (before === undefined || after === undefined) {
        steps.push({ name: action.pluginId, status: 'done', detail: '已检查更新' });
      } else {
        steps.push({ name: action.pluginId, status: 'done', detail: '已是最新' });
      }
      continue;
    }
    if (action.kind === 'conflict') {
      steps.push({
        name: action.name,
        status: 'warn',
        detail: `本机来自市场 ${action.installedMarketplace}（${action.installedPluginId}），与声明的 ${action.declaredMarketplace} 不符，不自动替换——如需切换：claude plugin uninstall ${action.installedPluginId} 后重跑`,
      });
      continue;
    }
    if (opts.dryRun) {
      steps.push({ name: action.pluginId, status: 'skipped', detail: `[dry-run] 将安装` });
      continue;
    }
    // 兜底注册市场（幂等；已注册不拉新，要拉新用 agile plugin update）
    if (!marketplaceReady) {
      const add = await runClaude(['plugin', 'marketplace', 'add', settings.plugins.marketplace]);
      if (add.exitCode !== 0) {
        steps.push({
          name: action.pluginId,
          status: 'failed',
          detail: `注册市场失败，请手动执行后重跑：claude plugin marketplace add ${settings.plugins.marketplace}（${(add.stderr || add.stdout || '').split('\n')[0]}）`,
        });
        continue;
      }
      marketplaceReady = true;
    }
    const install = await runClaude(['plugin', 'install', action.pluginId]);
    if (install.exitCode !== 0) {
      steps.push({
        name: action.pluginId,
        status: 'failed',
        detail: `安装失败，请手动执行：claude plugin install ${action.pluginId}（${(install.stderr || install.stdout || '').split('\n')[0]}）`,
      });
      continue;
    }
    installedAny = true;
    steps.push({ name: action.pluginId, status: 'done', detail: '已安装' });
  }

  for (const name of plan.refLocked) {
    steps.push({ name, status: 'warn', detail: '声明了版本锁定（ref）——锁定安装暂未实现，按市场最新安装' });
  }
  for (const pluginId of plan.undeclared) {
    steps.push({ name: pluginId, status: 'skipped', detail: `本机已装但未在当前 workspace 声明（不影响使用；不再需要可 claude plugin uninstall ${pluginId}）` });
  }

  if (installedAny || updatedAny) {
    steps.push({ name: '插件', status: 'done', detail: '重启 Claude Code 会话后生效' });
  }
  return steps;
}
