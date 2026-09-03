import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execa } from 'execa';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadPluginFile, savePluginFile } from '../core/config.js';
import * as ui from '../ui.js';

const require = createRequire(import.meta.url);

/** 内置插件名（@fcc/agile-plugin npm 包，随 @fcc/agile 一起安装） */
const BUILTIN = 'agile';
const MARKETPLACE = 'fcc-agile';

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 解析随 CLI 依赖安装的 @fcc/agile-plugin 包目录。
 * 通过 node 模块解析定位（node_modules/@fcc/agile-plugin），
 * 与发布形态一致：npm install -g @fcc/agile 后即存在。
 */
function builtinPluginDir(): string {
  try {
    const pkgJson = require.resolve('@fcc/agile-plugin/package.json');
    return path.dirname(pkgJson);
  } catch {
    throw new AgileError(
      '未找到 @fcc/agile-plugin 包。它应作为 @fcc/agile 的依赖自动安装；' +
        '若为本地开发，请先在仓库根执行 pnpm install。',
    );
  }
}

/** 通过 claude CLI 注册本地 marketplace 并安装插件 */
async function installViaClaudeCli(pluginDir: string, pluginName: string): Promise<boolean> {
  const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
  const add = await execa(claude, ['plugin', 'marketplace', 'add', pluginDir], {
    reject: false,
    timeout: 60_000,
    windowsHide: true,
  });
  if (add.exitCode !== 0) return false;
  const install = await execa(claude, ['plugin', 'install', `${pluginName}@${MARKETPLACE}`], {
    reject: false,
    timeout: 60_000,
    windowsHide: true,
  });
  return install.exitCode === 0;
}

export const pluginCommand = new Command('plugin')
  .description('Claude Code 插件管理（安装 agile plugin 或后期新增的 plugin）')
  .addCommand(
    new Command('install')
      .description('安装插件（默认 agile，随 CLI 的 npm 依赖分发；后续支持 git URL / npm 包名）')
      .argument('[source]', '插件来源：插件名', BUILTIN)
      .action(async (source: string) => {
        const root = requireWorkspaceRoot();

        if (source !== BUILTIN) {
          throw new AgileError(`暂不支持从 ${source} 安装插件。当前内置：${BUILTIN}（第三方插件后续版本支持）。`);
        }

        // 1. 解析插件包目录与插件名
        const pluginDir = builtinPluginDir();
        const manifest = await readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
        if (!manifest.name) {
          throw new AgileError(`插件清单缺失：${path.join(pluginDir, '.claude-plugin', 'plugin.json')} 中无 name 字段。`);
        }
        const pluginName = manifest.name as string;

        // 2. 通过 claude CLI 安装（marketplace add + install）
        const installed = await installViaClaudeCli(pluginDir, pluginName);
        if (!installed) {
          console.log(ui.warn('未能通过 claude CLI 自动安装，请手动执行：'));
          console.log(ui.dim(`  claude plugin marketplace add ${pluginDir}`));
          console.log(ui.dim(`  claude plugin install ${pluginName}@${MARKETPLACE}`));
        }

        // 3. 记录到 .agile/plugin.yaml
        const data = (await loadPluginFile(root)) ?? { version: 1, plugins: {} };
        data.plugins[pluginName] = {
          source: pluginDir.replace(/\\/g, '/'),
          enabled: true,
        };
        await savePluginFile(root, data);

        console.log(ui.ok(`插件 ${pluginName} 已安装（marketplace: ${MARKETPLACE}）`));
        console.log(ui.dim('重启 Claude Code 会话后即可使用 /agile:xxx 系列命令。'));
      }),
  )
  .addCommand(
    new Command('enable')
      .description('启用已安装的插件')
      .argument('<name>', '插件名')
      .action(async (name: string) => {
        const root = requireWorkspaceRoot();
        const data = await loadPluginFile(root);
        if (!data?.plugins[name]) throw new AgileError(`插件未登记：${name}`);
        data.plugins[name]!.enabled = true;
        await savePluginFile(root, data);
        const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
        await execa(claude, ['plugin', 'enable', `${name}@${MARKETPLACE}`], { reject: false, windowsHide: true });
        console.log(ui.ok(`插件 ${name} 已启用`));
      }),
  )
  .addCommand(
    new Command('disable')
      .description('禁用插件')
      .argument('<name>', '插件名')
      .action(async (name: string) => {
        const root = requireWorkspaceRoot();
        const data = await loadPluginFile(root);
        if (!data?.plugins[name]) throw new AgileError(`插件未登记：${name}`);
        data.plugins[name]!.enabled = false;
        await savePluginFile(root, data);
        const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
        await execa(claude, ['plugin', 'disable', `${name}@${MARKETPLACE}`], { reject: false, windowsHide: true });
        console.log(ui.ok(`插件 ${name} 已禁用`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出 .agile/plugin.yaml 中登记的插件')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const data = await loadPluginFile(root);
        if (!data || Object.keys(data.plugins).length === 0) {
          console.log(ui.dim('（未安装任何插件；运行 agile plugin install agile）'));
          return;
        }
        for (const [name, p] of Object.entries(data.plugins)) {
          const state = p.enabled ? ui.ok('启用') : ui.warn('禁用');
          console.log(`  ${state} ${name}（${p.source}）`);
        }
      }),
  );
