import { execa } from 'execa';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { DEFAULT_PLUGIN_MARKETPLACE, findWorkspaceRoot, requireWorkspaceRoot } from '../core/paths.js';
import { loadPluginFile, loadWorkspace, savePluginFile } from '../core/config.js';
import * as ui from '../ui.js';

/** 内置插件名（agile 插件市场中的 SDD/TDD 主插件） */
const BUILTIN = 'agile';
/** 本团队市场的固定名称（claude plugin install <name>@<marketplace>） */
const MARKETPLACE_NAME = 'fcc';

export const pluginCommand = new Command('plugin')
  .description('Claude Code 插件管理（插件市场为独立 git 仓库，新增插件无需升级 CLI）')
  .addCommand(
    new Command('install')
      .description('从插件市场（git 仓库）安装插件，默认 agile')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace <url>', '插件市场 git 地址（默认 workspace.yaml plugin.marketplace）')
      .option('--marketplace-name <name>', '市场名称（claude plugin install 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplace?: string; marketplaceName: string }) => {
        // 1. 解析市场地址：--marketplace 参数 > workspace.yaml plugin.marketplace > 官方默认
        //    workspace 外也可安装（仅跳过 plugin.yaml 登记）
        const root = findWorkspaceRoot();
        let marketplaceUrl = opts.marketplace ?? DEFAULT_PLUGIN_MARKETPLACE;
        if (root) {
          const workspace = await loadWorkspace(root);
          marketplaceUrl = opts.marketplace ?? workspace.plugin.marketplace;
        } else {
          console.log(ui.dim('当前不在 agile workspace 内：使用官方默认市场，且不登记 plugin.yaml。'));
        }

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

        // 3. 记录到 .agile/plugin.yaml（source = 市场 git 地址；仅 workspace 内登记）
        if (root) {
          const data = (await loadPluginFile(root)) ?? { version: 1, plugins: {} };
          data.plugins[name] = {
            source: marketplaceUrl,
            enabled: true,
          };
          await savePluginFile(root, data);
        }

        console.log(ui.ok(`插件 ${name} 已安装（市场：${marketplaceUrl}）`));
        console.log(ui.dim('重启 Claude Code 会话后即可使用 /agile:xxx 系列命令。'));
      }),
  )
  .addCommand(
    new Command('uninstall')
      .description('卸载插件并移除 workspace 登记（缺省为内置插件 agile；重启 Claude Code 会话生效）')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace-name <name>', '市场名称（claude plugin uninstall 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplaceName: string }) => {
        const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
        const pluginId = `${name}@${opts.marketplaceName}`;
        const r = await execa(claude, ['plugin', 'uninstall', pluginId], {
          reject: false,
          timeout: 120_000,
          windowsHide: true,
        });
        if (r.exitCode !== 0) {
          console.log(ui.warn(`卸载插件 ${pluginId} 失败（可能未安装），请手动执行：claude plugin uninstall ${pluginId}`));
          console.log(ui.dim(`失败原因：${(r.stderr || r.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 移除 workspace 登记（仅 workspace 内；无登记时忽略）
        const root = findWorkspaceRoot();
        if (root) {
          const data = await loadPluginFile(root);
          if (data?.plugins[name]) {
            delete data.plugins[name];
            await savePluginFile(root, data);
          }
        }

        console.log(ui.ok(`插件 ${pluginId} 已卸载。`));
        console.log(ui.dim('重启 Claude Code 会话后 /agile:xxx 命令不再可见。'));
      }),
  )
  .addCommand(
    new Command('update')
      .description('更新插件到市场最新版本（刷新市场克隆 → 强制重装；重启 Claude Code 会话后生效）')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace <url>', '插件市场 git 地址（默认 workspace.yaml plugin.marketplace）')
      .option('--marketplace-name <name>', '市场名称（claude plugin install 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplace?: string; marketplaceName: string }) => {
        // 解析市场地址：--marketplace 参数 > workspace.yaml plugin.marketplace > 官方默认（workspace 外也可更新）
        const root = findWorkspaceRoot();
        let marketplaceUrl = opts.marketplace ?? DEFAULT_PLUGIN_MARKETPLACE;
        if (root) {
          const workspace = await loadWorkspace(root);
          marketplaceUrl = opts.marketplace ?? workspace.plugin.marketplace;
        } else {
          console.log(ui.dim('当前不在 agile workspace 内：使用官方默认市场。'));
        }
        const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
        const pluginId = `${name}@${opts.marketplaceName}`;

        // 1. 注册市场（幂等；未注册时兜底）
        const add = await execa(claude, ['plugin', 'marketplace', 'add', marketplaceUrl], {
          reject: false,
          timeout: 120_000,
          windowsHide: true,
        });
        if (add.exitCode !== 0) {
          console.log(ui.warn(`注册插件市场失败，请手动执行：claude plugin marketplace add ${marketplaceUrl}`));
          console.log(ui.dim(`失败原因：${(add.stderr || add.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 2. 刷新市场克隆到远程最新——add 对已注册市场幂等不拉新，必须显式 update
        const mup = await execa(claude, ['plugin', 'marketplace', 'update', opts.marketplaceName], {
          reject: false,
          timeout: 120_000,
          windowsHide: true,
        });
        if (mup.exitCode !== 0) {
          console.log(ui.warn(`刷新市场失败，请手动执行：claude plugin marketplace update ${opts.marketplaceName}`));
          console.log(ui.dim(`失败原因：${(mup.stderr || mup.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 3. 强制重装：git 分发模式 plugin.json version 不变，claude plugin update 会判「已是最新」跳过，
        //    uninstall + install 才能装到市场克隆的最新内容（uninstall 未安装时失败可忽略）。
        await execa(claude, ['plugin', 'uninstall', pluginId], { reject: false, timeout: 120_000, windowsHide: true });
        const install = await execa(claude, ['plugin', 'install', pluginId], {
          reject: false,
          timeout: 120_000,
          windowsHide: true,
        });
        if (install.exitCode !== 0) {
          console.log(ui.warn(`重装插件 ${pluginId} 失败，请手动执行：claude plugin install ${pluginId}`));
          console.log(ui.dim(`失败原因：${(install.stderr || install.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 4. 登记 .agile/plugin.yaml（source = 市场 git 地址；仅 workspace 内登记）
        if (root) {
          const data = (await loadPluginFile(root)) ?? { version: 1, plugins: {} };
          data.plugins[name] = {
            source: marketplaceUrl,
            enabled: true,
          };
          await savePluginFile(root, data);
        }

        console.log(ui.ok(`插件 ${name} 已更新到市场最新版本（${marketplaceUrl}）`));
        console.log(ui.dim('重启 Claude Code 会话后生效。'));
      }),
  )
  .addCommand(
    new Command('marketplace')
      .description('插件市场注册管理（注册由 install 自动完成，此处可移除）')
      .addCommand(
        new Command('remove')
          .description('取消注册插件市场仓库（Claude Code 层移除；workspace.yaml 的 plugin.marketplace 配置保留，重新 install 会自动再注册）')
          .argument('[name]', '市场名称（默认 fcc）', MARKETPLACE_NAME)
          .action(async (name: string) => {
            const claude = process.env.CLAUDE_CODE_CLI ?? 'claude';
            const r = await execa(claude, ['plugin', 'marketplace', 'remove', name], {
              reject: false,
              timeout: 120_000,
              windowsHide: true,
            });
            if (r.exitCode !== 0) {
              console.log(ui.warn(`取消注册市场 ${name} 失败（可能未注册），请手动执行：claude plugin marketplace remove ${name}`));
              console.log(ui.dim(`失败原因：${(r.stderr || r.stdout || '').split('\n')[0]}`));
              process.exitCode = 1;
              return;
            }
            console.log(ui.ok(`插件市场 ${name} 已取消注册。`));
          }),
      ),
  )
  .addCommand(
    new Command('enable')
      .description('启用已安装的插件（缺省为内置插件 agile）')
      .argument('[name]', '插件名（默认 agile）', BUILTIN)
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
      .description('禁用插件（缺省为内置插件 agile）')
      .argument('[name]', '插件名（默认 agile）', BUILTIN)
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
