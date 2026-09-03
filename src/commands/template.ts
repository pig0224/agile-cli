import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadWorkspace } from '../core/config.js';
import { loadTemplates } from '../core/template-registry.js';
import * as ui from '../ui.js';

/** 模板源：--registry 参数 > workspace.yaml templates.registry */
async function resolveRegistryUrl(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const root = requireWorkspaceRoot();
  const workspace = await loadWorkspace(root);
  return workspace.templates.registry;
}

export const templateCommand = new Command('template')
  .description('项目模板注册中心管理（模板来自独立 git 仓库，新增模板无需升级 CLI）')
  .addCommand(
    new Command('list')
      .description('列出模板注册中心的全部可用模板（默认读本地缓存，--refresh 联网刷新）')
      .option('--registry <url>', '模板仓库 git URL（默认 workspace.yaml templates.registry）')
      .option('--refresh', '联网刷新模板缓存（默认走缓存）')
      .option('--json', '输出 JSON（供 AI / MCP 消费）')
      .action(async (opts: { registry?: string; refresh?: boolean; json?: boolean }) => {
        const url = await resolveRegistryUrl(opts.registry);
        const { registry, issues, stale } = await loadTemplates(url, { refresh: opts.refresh === true });
        if (stale) console.log(ui.warn('模板仓库同步失败，使用本地缓存。'));

        if (opts.json) {
          console.log(JSON.stringify({ registry: url, templates: registry.templates, issues, stale }, null, 2));
          return;
        }
        console.log(ui.bold(`模板注册中心：${url}`));
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
        console.log(ui.dim('使用：agile init project <name> --template <模板名>'));
      }),
  )
  .addCommand(
    new Command('update')
      .description('强制刷新模板缓存（拉取注册中心仓库最新版本，等价 list --refresh）')
      .option('--registry <url>', '模板仓库 git URL（默认 workspace.yaml templates.registry）')
      .action(async (opts: { registry?: string }) => {
        const url = await resolveRegistryUrl(opts.registry);
        const { issues, stale } = await loadTemplates(url, { refresh: true });
        if (stale) {
          console.log(ui.fail('模板缓存刷新失败（网络/权限问题）'));
          process.exitCode = 1;
          return;
        }
        console.log(ui.ok(`模板缓存已更新：${url}`));
        for (const issue of issues) console.log(ui.warn(issue));
      }),
  )
  .addCommand(
    new Command('check')
      .description('校验注册中心一致性（命名规范 / 目录同名 / 无重复指向）')
      .option('--registry <url>', '模板仓库 git URL（默认 workspace.yaml templates.registry）')
      .action(async (opts: { registry?: string }) => {
        const url = await resolveRegistryUrl(opts.registry);
        const { issues } = await loadTemplates(url, { refresh: true });
        if (issues.length === 0) {
          console.log(ui.ok('注册中心一致，无问题。'));
          return;
        }
        for (const issue of issues) console.log(ui.fail(issue));
        process.exitCode = 1;
      }),
  );
