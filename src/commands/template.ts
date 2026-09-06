import { Command } from 'commander';
import { DEFAULT_TEMPLATE_REGISTRY, findWorkspaceRoot } from '../core/paths.js';
import { loadSettings } from '../core/config.js';
import { cleanAllTemplateCaches, loadTemplates } from '../core/template-registry.js';
import * as ui from '../ui.js';

/** 模板源解析：workspace 内读 settings.json 的 templates.registry；workspace 外用内置官方源
 *  （模板缓存位于用户级 ~/.agile/templates，跨 workspace 共享——list / update 属查询能力，无需 workspace） */
async function resolveRegistryUrl(): Promise<string> {
  const root = findWorkspaceRoot();
  if (root) return (await loadSettings(root)).templates.registry;
  console.log(ui.dim('当前不在 agile workspace 内：使用内置官方模板源（换源：agile config set template-repo <git-url>）。'));
  return DEFAULT_TEMPLATE_REGISTRY;
}

export const templateCommand = new Command('template')
  .description('项目模板管理（模板注册中心 = git 仓库，换源：agile config set template-repo <git-url>）')
  .addCommand(
    new Command('list')
      .description('列出注册中心全部可用模板（默认走本地缓存；agile sync 或 template update 刷新）')
      .action(async () => {
        const registryUrl = await resolveRegistryUrl();
        const { registry, issues, stale } = await loadTemplates(registryUrl);
        if (stale) console.log(ui.warn('模板源同步失败，使用本地缓存。'));

        console.log(ui.bold(`模板注册中心：${registryUrl}`));
        console.log('');
        if (registry.singles.length === 0 && registry.solutions.length === 0) {
          console.log(ui.dim('（注册中心为空）'));
        }
        // 单例模板：展示顺序 = registry.json singles 数组顺序
        for (const entry of registry.singles) {
          const tags = [entry.language?.join(' / '), entry.framework?.join(' / ')]
            .filter(Boolean)
            .join(' / ');
          console.log(`  ${ui.info(entry.name.padEnd(18))}${entry.description}${tags ? ui.dim(`（${tags}）`) : ''}`);
        }

        // 组合模板分组（solutions 数组；无组合时隐藏）
        if (registry.solutions.length > 0) {
          console.log('');
          console.log(ui.bold('组合模板（一次生成多个平铺成员项目）：'));
          for (const solution of registry.solutions) {
            const summary = solution.projects.map((p) => `${p.name}（${p.description}）`).join('、');
            console.log(`  ${ui.info(solution.name.padEnd(18))}${solution.description}${summary ? ui.dim(`（成员：${summary}）`) : ''}`);
          }
        }

        if (issues.length > 0) {
          console.log('');
          for (const issue of issues) console.log(ui.warn(issue));
          process.exitCode = 1;
        }
        console.log('');
        console.log(ui.dim('使用：agile init project <name> --template <模板名>（--template 缺省创建空项目）'));
        console.log(ui.dim('组合：agile init project <系统标签> --template <组合名> 平铺生成全部成员项目（--member 成员名=目录名 改成员目录名）'));
      }),
  )
  .addCommand(
    new Command('update')
      .description('刷新模板缓存到注册中心最新（拉取 templates.registry 仓库远端最新）')
      .action(async () => {
        const registryUrl = await resolveRegistryUrl();
        const { issues, stale } = await loadTemplates(registryUrl, { refresh: true });
        if (stale) {
          console.log(ui.fail('模板缓存刷新失败（网络/权限问题）'));
          process.exitCode = 1;
          return;
        }
        console.log(ui.ok(`模板缓存已更新：${registryUrl}`));
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
