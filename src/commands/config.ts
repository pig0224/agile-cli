import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { DEFAULT_PLUGIN_MARKETPLACE, DEFAULT_TEMPLATE_REGISTRY, requireWorkspaceRoot } from '../core/paths.js';
import { loadSettings, saveSettings } from '../core/config.js';
import type { Settings } from '../core/schemas.js';
import * as ui from '../ui.js';

/**
 * config 快捷键（类 npm registry 换源体验；其余配置直接编辑 .agile/settings.json）：
 * - tech-specs / biz-tech-docs：外部内容仓 → repos.<slot>.url（unset 移除条目，sync 提示跳过）
 * - plugin-repo / template-repo：插件市场 / 模板注册中心 → plugins.marketplace / templates.registry
 *   （unset 恢复内置官方源；换源后已安装插件不受影响，sync 绝不卸载）
 */
const CONFIG_KEYS = {
  'tech-specs': 'repos.techSpecs.url',
  'biz-tech-docs': 'repos.bizTechDocs.url',
  'plugin-repo': 'plugins.marketplace',
  'template-repo': 'templates.registry',
} as const;
type ConfigKey = keyof typeof CONFIG_KEYS;

const KEYS_HINT = Object.keys(CONFIG_KEYS).join(' / ');
const parseKey = (key: string): ConfigKey => {
  if (!(key in CONFIG_KEYS)) {
    throw new AgileError(`不支持的配置键：${key}（可选：${KEYS_HINT}；其余配置直接编辑 .agile/settings.json）`);
  }
  return key as ConfigKey;
};

/** 各键的读写落点（操作 Settings 对象，落盘由命令层统一 saveSettings） */
const ACCESSORS: Record<
  ConfigKey,
  { get: (s: Settings) => string | undefined; set: (s: Settings, url: string) => void; unset: (s: Settings) => void; setHint: string; unsetHint: string }
> = {
  'tech-specs': {
    get: (s) => s.repos.techSpecs?.url,
    set: (s, url) => {
      s.repos.techSpecs = { url };
    },
    unset: (s) => {
      delete s.repos.techSpecs;
    },
    setHint: 'agile sync 生效',
    unsetHint: 'sync 时将提示跳过该资源',
  },
  'biz-tech-docs': {
    get: (s) => s.repos.bizTechDocs?.url,
    set: (s, url) => {
      s.repos.bizTechDocs = { url };
    },
    unset: (s) => {
      delete s.repos.bizTechDocs;
    },
    setHint: 'agile sync 生效',
    unsetHint: 'sync 时将提示跳过该资源',
  },
  'plugin-repo': {
    get: (s) => s.plugins.marketplace,
    set: (s, url) => {
      s.plugins.marketplace = url;
    },
    unset: (s) => {
      s.plugins.marketplace = DEFAULT_PLUGIN_MARKETPLACE;
    },
    setHint: 'agile sync / agile plugin install 生效；已安装插件不受影响（绝不卸载）',
    unsetHint: `已恢复内置官方源：${DEFAULT_PLUGIN_MARKETPLACE}`,
  },
  'template-repo': {
    get: (s) => s.templates.registry,
    set: (s, url) => {
      s.templates.registry = url;
    },
    unset: (s) => {
      s.templates.registry = DEFAULT_TEMPLATE_REGISTRY;
    },
    setHint: 'agile sync / agile template list 生效',
    unsetHint: `已恢复内置官方源：${DEFAULT_TEMPLATE_REGISTRY}`,
  },
};

export const configCommand = new Command('config')
  .description(`快捷配置外部仓库与分发源地址（${KEYS_HINT}）；其余配置直接编辑 .agile/settings.json`)
  .addCommand(
    new Command('get')
      .description('查看配置值，如 agile config get tech-specs / agile config get template-repo')
      .argument('<key>', `配置键：${KEYS_HINT}`)
      .action(async (key: string) => {
        const settings = await loadSettings(requireWorkspaceRoot());
        const k = parseKey(key);
        console.log(ACCESSORS[k].get(settings) ?? ui.dim(`（未配置；agile config set ${k} <git-url>）`));
      }),
  )
  .addCommand(
    new Command('set')
      .description('设置配置值，如 agile config set tech-specs git@corp:com/specs.git')
      .argument('<key>', `配置键：${KEYS_HINT}`)
      .argument('<url>', 'git 仓库地址（支持 https / ssh / 本地路径）')
      .action(async (key: string, url: string) => {
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);
        const k = parseKey(key);
        ACCESSORS[k].set(settings, url);
        await saveSettings(root, settings);
        console.log(ui.ok(`${k} = ${url}（写入 .agile/settings.json 的 ${CONFIG_KEYS[k]}；${ACCESSORS[k].setHint}）`));
      }),
  )
  .addCommand(
    new Command('unset')
      .description('移除配置：tech-specs / biz-tech-docs 移除条目；plugin-repo / template-repo 恢复内置官方源')
      .argument('<key>', `配置键：${KEYS_HINT}`)
      .action(async (key: string) => {
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);
        const k = parseKey(key);
        ACCESSORS[k].unset(settings);
        await saveSettings(root, settings);
        console.log(ui.ok(`已移除 ${k} 配置（${ACCESSORS[k].unsetHint}）`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('显示全部配置（.agile/settings.json 原样输出）')
      .action(async () => {
        const settings = await loadSettings(requireWorkspaceRoot());
        console.log(JSON.stringify(settings, null, 2));
      }),
  );
