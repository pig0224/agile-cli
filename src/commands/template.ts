import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_TEMPLATE_REGISTRY, requireWorkspaceRoot } from '../core/paths.js';
import { loadWorkspace, toYaml } from '../core/config.js';
import { cleanAllTemplateCaches, cleanTemplateCache, loadTemplates } from '../core/template-registry.js';
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
        console.log(ui.dim('使用：agile init project <name> --template <模板名>（--template 缺省创建空项目）'));
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
    new Command('clean')
      .description('删除模板仓库的本地缓存副本（~/.agile/templates；下次使用自动重新克隆）')
      .option('--registry <url>', '要清理的模板仓库 git URL（默认 workspace.yaml templates.registry）')
      .option('--all', '清理全部模板缓存（所有克隆过的源）')
      .action(async (opts: { registry?: string; all?: boolean }) => {
        if (opts.all === true) {
          const cleaned = await cleanAllTemplateCaches();
          if (cleaned === 0) console.log(ui.dim('无模板缓存。'));
          else console.log(ui.ok(`已清理 ${cleaned} 个模板缓存。`));
          return;
        }
        const url = await resolveRegistryUrl(opts.registry);
        const removed = await cleanTemplateCache(url);
        if (removed) console.log(ui.ok(`模板缓存已清理：${url}`));
        else console.log(ui.dim('该源无本地缓存（本地目录直读模式也没有缓存）。'));
      }),
  )
  .addCommand(
    new Command('unregister')
      .description('取消注册模板仓库（移除 workspace.yaml 的 templates.registry 自定义配置，回退官方默认源；本地缓存不受影响）')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const file = path.join(root, '.agile', 'workspace.yaml');
        const raw = await fs.readFile(file, 'utf8');
        const doc = (await import('yaml')).parse(raw) as Record<string, unknown>;
        const templates = doc.templates as Record<string, unknown> | undefined;
        if (templates == null || !('registry' in templates)) {
          console.log(ui.dim('workspace 未注册自定义模板仓库（templates.registry 未配置，当前使用官方默认源）。'));
          return;
        }
        delete templates.registry;
        if (Object.keys(templates).length === 0) delete doc.templates;
        await fs.writeFile(file, toYaml(doc), 'utf8');
        console.log(ui.ok(`已取消注册模板仓库（回退官方默认源：${DEFAULT_TEMPLATE_REGISTRY}）`));
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
