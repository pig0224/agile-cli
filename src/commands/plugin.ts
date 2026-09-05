import { Command } from 'commander';
import { DEFAULT_PLUGIN_MARKETPLACE, findWorkspaceRoot, requireWorkspaceRoot } from '../core/paths.js';
import { loadSettings, saveSettings } from '../core/config.js';
import { MARKETPLACE_NAME, planPluginSync, readInstalledClaudePlugins, runClaude } from '../core/claude-plugins.js';
import * as ui from '../ui.js';

/** 内置插件名（agile 插件市场中的 SDD/TDD 主插件） */
const BUILTIN = 'agile';

/** 安装/更新后把依赖声明写入 settings.json 的 plugins.dependencies（仅 workspace 内登记） */
async function recordDependency(root: string, name: string, marketplaceName: string): Promise<void> {
  const settings = await loadSettings(root);
  settings.plugins.dependencies[name] = { marketplace: marketplaceName };
  await saveSettings(root, settings);
}

export const pluginCommand = new Command('plugin')
  .description(
    'Claude Code 插件管理（类 npm 心智；插件市场为独立 git 仓库，新增插件无需升级 CLI；依赖声明登记在 .agile/settings.json 的 plugins.dependencies，agile sync 按声明补装；换源：agile config set plugin-repo <git-url>）',
  )
  .addCommand(
    new Command('install')
      .description('从插件市场安装插件并登记依赖声明，默认 agile（类 npm install --save）')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace <url>', '插件市场 git 地址（默认 settings.json plugins.marketplace）')
      .option('--marketplace-name <name>', '市场名称（claude plugin install 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplace?: string; marketplaceName: string }) => {
        // 1. 解析市场地址：--marketplace 参数 > settings.json plugins.marketplace > 官方默认
        //    workspace 外也可安装（仅跳过依赖声明）
        const root = findWorkspaceRoot();
        let marketplaceUrl = opts.marketplace ?? DEFAULT_PLUGIN_MARKETPLACE;
        if (root) {
          const settings = await loadSettings(root);
          marketplaceUrl = opts.marketplace ?? settings.plugins.marketplace;
        } else {
          console.log(ui.dim('当前不在 agile workspace 内：使用官方默认市场，且不登记依赖声明。'));
        }

        // 2. 注册市场 + 安装插件（本地路径与 git URL 均可，claude CLI 自行处理）
        const add = await runClaude(['plugin', 'marketplace', 'add', marketplaceUrl]);
        if (add.exitCode !== 0) {
          console.log(ui.warn('注册插件市场失败，请手动执行：'));
          console.log(ui.dim(`  claude plugin marketplace add ${marketplaceUrl}`));
          console.log(ui.dim(`  claude plugin install ${name}@${opts.marketplaceName}`));
          console.log(ui.dim(`失败原因：${(add.stderr || add.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }
        const install = await runClaude(['plugin', 'install', `${name}@${opts.marketplaceName}`]);
        if (install.exitCode !== 0) {
          console.log(ui.warn(`安装插件 ${name} 失败，请手动执行：`));
          console.log(ui.dim(`  claude plugin install ${name}@${opts.marketplaceName}`));
          console.log(ui.dim(`失败原因：${(install.stderr || install.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 3. 登记依赖声明（仅 workspace 内；安装实况由 Claude Code 全局管理）
        if (root) await recordDependency(root, name, opts.marketplaceName);

        console.log(ui.ok(`插件 ${name} 已安装（市场：${marketplaceUrl}）`));
        console.log(ui.dim('重启 Claude Code 会话后即可使用 /agile:xxx 系列命令。'));
      }),
  )
  .addCommand(
    new Command('uninstall')
      .description('卸载插件并移除依赖声明（缺省为内置插件 agile；重启 Claude Code 会话生效）')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace-name <name>', '市场名称（claude plugin uninstall 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplaceName: string }) => {
        const pluginId = `${name}@${opts.marketplaceName}`;
        const r = await runClaude(['plugin', 'uninstall', pluginId]);
        if (r.exitCode !== 0) {
          console.log(ui.warn(`卸载插件 ${pluginId} 失败（可能未安装），请手动执行：claude plugin uninstall ${pluginId}`));
          console.log(ui.dim(`失败原因：${(r.stderr || r.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 移除依赖声明（仅 workspace 内；无声明时忽略）
        const root = findWorkspaceRoot();
        if (root) {
          const settings = await loadSettings(root);
          if (settings.plugins.dependencies[name]) {
            delete settings.plugins.dependencies[name];
            await saveSettings(root, settings);
          }
        }

        console.log(ui.ok(`插件 ${pluginId} 已卸载。`));
        console.log(ui.dim('重启 Claude Code 会话后 /agile:xxx 命令不再可见。'));
      }),
  )
  .addCommand(
    new Command('update')
      .description('更新插件到市场最新版本并登记声明（刷新市场克隆 → 强制重装；重启 Claude Code 会话后生效）')
      .argument('[name]', '插件名（市场 marketplace.json 中登记的名字）', BUILTIN)
      .option('--marketplace <url>', '插件市场 git 地址（默认 settings.json plugins.marketplace）')
      .option('--marketplace-name <name>', '市场名称（claude plugin install 的 @ 后缀）', MARKETPLACE_NAME)
      .action(async (name: string, opts: { marketplace?: string; marketplaceName: string }) => {
        // 解析市场地址：--marketplace 参数 > settings.json plugins.marketplace > 官方默认（workspace 外也可更新）
        const root = findWorkspaceRoot();
        let marketplaceUrl = opts.marketplace ?? DEFAULT_PLUGIN_MARKETPLACE;
        if (root) {
          const settings = await loadSettings(root);
          marketplaceUrl = opts.marketplace ?? settings.plugins.marketplace;
        } else {
          console.log(ui.dim('当前不在 agile workspace 内：使用官方默认市场。'));
        }
        const pluginId = `${name}@${opts.marketplaceName}`;

        // 1. 注册市场（幂等；未注册时兜底）
        const add = await runClaude(['plugin', 'marketplace', 'add', marketplaceUrl]);
        if (add.exitCode !== 0) {
          console.log(ui.warn(`注册插件市场失败，请手动执行：claude plugin marketplace add ${marketplaceUrl}`));
          console.log(ui.dim(`失败原因：${(add.stderr || add.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 2. 刷新市场克隆到远程最新——add 对已注册市场幂等不拉新，必须显式 update
        const mup = await runClaude(['plugin', 'marketplace', 'update', opts.marketplaceName]);
        if (mup.exitCode !== 0) {
          console.log(ui.warn(`刷新市场失败，请手动执行：claude plugin marketplace update ${opts.marketplaceName}`));
          console.log(ui.dim(`失败原因：${(mup.stderr || mup.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 3. 强制重装：claude plugin update 对 git 分发市场可能判「已是最新」跳过，
        //    uninstall + install 保证装到市场克隆的最新内容（uninstall 未安装时失败可忽略）。
        await runClaude(['plugin', 'uninstall', pluginId]);
        const install = await runClaude(['plugin', 'install', pluginId]);
        if (install.exitCode !== 0) {
          console.log(ui.warn(`重装插件 ${pluginId} 失败，请手动执行：claude plugin install ${pluginId}`));
          console.log(ui.dim(`失败原因：${(install.stderr || install.stdout || '').split('\n')[0]}`));
          process.exitCode = 1;
          return;
        }

        // 4. 登记依赖声明（仅 workspace 内登记）
        if (root) await recordDependency(root, name, opts.marketplaceName);

        console.log(ui.ok(`插件 ${name} 已更新到市场最新版本（${marketplaceUrl}）`));
        console.log(ui.dim('重启 Claude Code 会话后生效。'));
      }),
  )
  .addCommand(
    new Command('ls')
      .description('列出依赖声明与本机安装实况对照（声明来自 settings.json plugins.dependencies；同步补装用 agile sync）')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);
        const dependencies = settings.plugins.dependencies ?? {};
        const installed = await readInstalledClaudePlugins();
        const plan = planPluginSync(dependencies, installed, MARKETPLACE_NAME);

        console.log(ui.bold(`插件市场：${settings.plugins.marketplace}`));
        console.log('');
        const deps = Object.entries(dependencies);
        if (deps.length === 0 && plan.undeclared.length === 0) {
          console.log(ui.dim('（无依赖声明；运行 agile plugin install <name> 安装并登记）'));
          return;
        }
        for (const action of plan.actions) {
          if (action.kind === 'skip') {
            console.log(`  ${ui.ok('✓')} ${action.pluginId}${ui.dim('（已安装）')}`);
          } else if (action.kind === 'conflict') {
            console.log(
              `  ${ui.warn('✖')} ${action.name}${ui.warn(
                `：声明来自市场 ${action.declaredMarketplace}，本机来自 ${action.installedMarketplace}（${action.installedPluginId}）——切换：claude plugin uninstall ${action.installedPluginId} 后 agile sync`,
              )}`,
            );
          } else {
            console.log(`  ${ui.warn('○')} ${action.pluginId}${ui.warn('（未安装；agile sync 或 claude plugin install ' + action.pluginId + '）')}`);
          }
          if (dependencies[action.name]?.ref) {
            console.log(ui.warn(`      ${action.name} 声明了版本锁定（ref）——锁定安装暂未实现，按市场最新安装`));
          }
        }
        for (const pluginId of plan.undeclared) {
          console.log(`  ${ui.dim('·')} ${pluginId}${ui.dim('（本机已装，未在当前 workspace 声明）')}`);
        }
      }),
  );
