import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadSettings } from '../core/config.js';
import { cleanAllTemplateCaches, loadTemplates } from '../core/template-registry.js';
import * as ui from '../ui.js';

export const templateCommand = new Command('template')
  .description('项目模板管理（模板注册中心 = git 仓库，换源：agile config set template-repo <git-url>）')
  .addCommand(
    new Command('list')
      .description('列出注册中心全部可用模板（默认走本地缓存；agile sync 或 template update 刷新）')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);
        const { registry, issues, stale } = await loadTemplates(settings.templates.registry);
        if (stale) console.log(ui.warn('模板源同步失败，使用本地缓存。'));

        console.log(ui.bold(`模板注册中心：${settings.templates.registry}`));
        console.log('');
        if (Object.keys(registry.templates).length === 0) {
          console.log(ui.dim('（注册中心为空）'));
        }
        for (const [name, entry] of Object.entries(registry.templates)) {
          const tags = [entry.language, entry.framework].filter(Boolean).join(' / ');
          console.log(`  ${ui.info(name.padEnd(18))}${entry.description}${tags ? ui.dim(`（${tags}）`) : ''}`);
        }
        if (issues.length > 0) {
          console.log('');
          for (const issue of issues) console.log(ui.warn(issue));
          process.exitCode = 1;
        }
        console.log('');
        console.log(ui.dim('使用：agile init project <name> --template <模板名>（--template 缺省创建空项目）'));
      }),
  )
  .addCommand(
    new Command('update')
      .description('刷新模板缓存到注册中心最新（拉取 templates.registry 仓库远端最新）')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);
        const { issues, stale } = await loadTemplates(settings.templates.registry, { refresh: true });
        if (stale) {
          console.log(ui.fail('模板缓存刷新失败（网络/权限问题）'));
          process.exitCode = 1;
          return;
        }
        console.log(ui.ok(`模板缓存已更新：${settings.templates.registry}`));
        for (const issue of issues) console.log(ui.warn(issue));
      }),
  )
  .addCommand(
    new Command('clean')
      .description('清理全部模板缓存（~/.agile/templates；下次使用自动重新克隆）')
      .action(async () => {
        const cleaned = await cleanAllTemplateCaches();
        if (cleaned === 0) console.log(ui.dim('无模板缓存。'));
        else console.log(ui.ok(`已清理 ${cleaned} 个模板缓存。`));
      }),
  );
