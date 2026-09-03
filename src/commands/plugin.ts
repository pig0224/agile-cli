import { execa } from 'execa';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadPluginFile, loadWorkspace, savePluginFile } from '../core/config.js';
import * as ui from '../ui.js';

/** 内置插件名（agile 插件市场中的 SDD/TDD 主插件） */
const BUILTIN = 'agile';
/** 本团队市场的固定名称（claude plugin install <name>@<marketplace>） */
const MARKETPLACE_NAME = 'fcc-agile';

export const pluginCommand = new Command('plugin')
  .description('Claude Code 插件管理（插件市场为独立 git 仓库，新增插件无需升级 CLI）')
  .addCommand(
    new Command('install')
      .description('从插件市场（git 仓库）安装插件，默认 agile')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace <url>', '插件市场 git 地址（默认 workspace.yaml plugin.marketplace）')
      .option('--marketplace-name <name>', '市场名称（claude plugin install 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplace?: string; marketplaceName: string }) => {
        const root = requireWorkspaceRoot();

        // 1. 解析市场地址：--marketplace 参数 > workspace.yaml plugin.marketplace
        const workspace = await loadWorkspace(root);
        const marketplaceUrl = opts.marketplace ?? workspace.plugin.marketplace;

        // 2. 注册市场 + 安装插件（本地路径与 git URL 均可，claude CLI 自行处理）
        const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
        const add = await execa(claude, ['plugin', 'marketplace', 'add', marketplaceUrl], {
          reject: false,
          timeout: 120_000,
          windowsHide: true,
        });
        if (add.exitCode !== 0) {
          console.log(ui.warn('注册插件市场失败，请手动执行：'));
          console.log(ui.dim(`  claude plugin marketplace add ${marketplaceUrl}`));
          console.log(ui.dim(`  claude plugin install ${name}@${opts.marketplaceName}`));
          console.log(ui.dim(`失败原因：${(add.stderr || add.stdout || '').split('\n')[0]}`));
        } else {
          const install = await execa(claude, ['plugin', 'install', `${name}@${opts.marketplaceName}`], {
            reject: false,
            timeout: 120_000,
            windowsHide: true,
          });
          if (install.exitCode !== 0) {
            console.log(ui.warn(`安装插件 ${name} 失败，请手动执行：`));
            console.log(ui.dim(`  claude plugin install ${name}@${opts.marketplaceName}`));
            console.log(ui.dim(`失败原因：${(install.stderr || install.stdout || '').split('\n')[0]}`));
          }
        }

        // 3. 记录到 .agile/plugin.yaml（source = 市场 git 地址）
        const data = (await loadPluginFile(root)) ?? { version: 1, plugins: {} };
        data.plugins[name] = {
          source: marketplaceUrl,
          enabled: true,
        };
        await savePluginFile(root, data);

        console.log(ui.ok(`插件 ${name} 已安装（市场：${marketplaceUrl}）`));
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
        await execa(claude, ['plugin', 'enable', `${name}@${MARKETPLACE_NAME}`], { reject: false, windowsHide: true });
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
        await execa(claude, ['plugin', 'disable', `${name}@${MARKETPLACE_NAME}`], { reject: false, windowsHide: true });
        console.log(ui.ok(`插件 ${name} 已禁用`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出 .agile/plugin.yaml 中登记的插件与市场地址')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        console.log(ui.bold(`插件市场：${workspace.plugin.marketplace}`));
        console.log('');
        const data = await loadPluginFile(root);
        if (!data || Object.keys(data.plugins).length === 0) {
          console.log(ui.dim('（未安装任何插件；运行 agile plugin install agile）'));
          return;
        }
        for (const [name, p] of Object.entries(data.plugins)) {
          const state = p.enabled ? ui.ok('启用') : ui.warn('禁用');
          console.log(`  ${state} ${name}（source: ${p.source}）`);
        }
      }),
  );
