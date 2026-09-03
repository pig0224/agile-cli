import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import {
  DEFAULT_PATHS,
  DEFAULT_PLUGIN_MARKETPLACE,
  DEFAULT_TEMPLATE_REGISTRY,
  DRAWER_PATHS,
  PLACEHOLDER_URL_PREFIX,
  requireWorkspaceRoot,
} from '../core/paths.js';
import { loadRegistry, loadWorkspace, saveRegistry, toYaml } from '../core/config.js';
import { git } from '../core/git.js';
import { loadTemplates, scaffoldFromTemplate, TEMPLATE_NAME_RE } from '../core/template-registry.js';
import * as ui from '../ui.js';

/** 抽屉目录骨架说明（README 放进各抽屉） */
const DRAWER_READMES: Record<string, string> = {
  'tech-specs': '# 抽屉一：公司级技术规范\n\n技术栈规范、SQL 规范、安全规范、通用工程规范。\n通常作为 Git Submodule 由公司规范团队维护。\n',
  'biz-tech-docs': '# 抽屉二：团队技术设计知识库\n\n架构设计、状态机设计、技术方案、工程规范。\nGit Submodule，团队技术负责人维护。\n',
  'biz-product-docs': '# 抽屉三：产品设计知识库\n\nPRD 模板、产品规范、UI 规范、交互设计规范。\nGit Submodule，产品团队维护。\n',
  projects: '# 抽屉四：团队项目代码\n\n多个微服务/前端项目平铺于此，各自为 Git Submodule。\n使用 `agile init project <name> --template <模板名>` 创建（agile template list 查看模板）。\n',
  'process-docs': '# 抽屉五：过程产物\n\n按需求编号（STO-xxx）归档的过程文档，直接保存在 Workspace 根仓库。\n标准目录由 Claude Code 插件命令 /agile:sync-req 或 MCP 工具 agile_task_create 生成。\n',
};

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false);
}

export const initCommand = new Command('init')
  .description('初始化：workspace 工作空间 或 project 项目仓库')
  .addCommand(
    new Command('workspace')
      .description('初始化 workspace（.agile 配置 + 五个抽屉骨架 + git 仓库）')
      .option('--name <name>', 'workspace 名称', path.basename(process.cwd()))
      .option('--default-branch <branch>', '默认分支', 'main')
      .option('--marketplace <url>', '插件市场 git 地址', DEFAULT_PLUGIN_MARKETPLACE)
      .option('--template-registry <url>', '项目模板注册中心 git 地址', DEFAULT_TEMPLATE_REGISTRY)
      .action(async (opts: { name: string; defaultBranch: string; marketplace: string; templateRegistry: string }) => {
        const root = process.cwd();

        // 幂等：允许重复 init，但不覆盖已有配置
        const agileDir = path.join(root, '.agile');
        await fs.mkdir(agileDir, { recursive: true });

        const workspaceFile = path.join(agileDir, 'workspace.yaml');
        if (!(await exists(workspaceFile))) {
          const workspace = {
            version: 1,
            name: opts.name,
            created: new Date().toISOString().slice(0, 10),
            defaultBranch: opts.defaultBranch,
            paths: { ...DEFAULT_PATHS },
            plugin: { marketplace: opts.marketplace },
            templates: { registry: opts.templateRegistry },
            hooks: [],
          };
          await fs.writeFile(workspaceFile, toYaml(workspace), 'utf8');
        }

        const registryFile = path.join(agileDir, 'registry.yaml');
        if (!(await exists(registryFile))) {
          await fs.writeFile(registryFile, toYaml({ version: 1, repositories: {} }), 'utf8');
        }

        const pluginFile = path.join(agileDir, 'plugin.yaml');
        if (!(await exists(pluginFile))) {
          await fs.writeFile(pluginFile, toYaml({ version: 1, plugins: {} }), 'utf8');
        }

        // 抽屉骨架
        for (const drawer of DRAWER_PATHS) {
          const dir = path.join(root, drawer);
          await fs.mkdir(dir, { recursive: true });
          const readme = path.join(dir, 'README.md');
          if (!(await exists(readme)) && DRAWER_READMES[drawer]) {
            await fs.writeFile(readme, DRAWER_READMES[drawer]!, 'utf8');
          }
        }

        // git init（幂等）
        if (!(await exists(path.join(root, '.git')))) {
          await git(root, ['init', '-b', opts.defaultBranch]);
        }

        // 根 .gitignore：忽略 worktree 开发目录与脚手架临时目录
        const gitignore = path.join(root, '.gitignore');
        if (!(await exists(gitignore))) {
          await fs.writeFile(gitignore, '.worktrees/\n.agile/.scaffold/\n', 'utf8');
        }

        console.log(ui.ok(`workspace 初始化完成：${root}`));
        console.log(ui.dim('下一步：'));
        console.log(ui.dim('  1. agile repo add <path> <git-url>    # 登记仓库（如 tech-specs）'));
        console.log(ui.dim('  2. agile sync                         # 拉取所有仓库'));
        console.log(ui.dim('  3. agile template list                # 查看项目模板'));
        console.log(ui.dim('  4. agile plugin install agile         # 安装 Claude Code 插件'));
      }),
  )
  .addCommand(
    new Command('project')
      .description('初始化项目仓库（模板来自注册中心 git 仓库 + 注册 registry + 纳入 submodule）')
      .argument('<name>', '项目名（将作为目录名）')
      .requiredOption('--template <template>', '模板名（agile template list 查看；模板来自 templates.registry 指向的 git 仓库）')
      .option('--group <group>', '所属分组（相对 workspace 根的父目录）', 'projects')
      .option('--branch <branch>', '初始分支名', 'main')
      .option('--registry <url>', '模板仓库 git URL（默认 workspace.yaml templates.registry）')
      .option('--remote <url>', '远端 git URL；缺省时记录占位地址，推送后用 repo set-url 更新')
      .action(async (name: string, opts: { template: string; group: string; branch: string; registry?: string; remote?: string }) => {
        const root = requireWorkspaceRoot();
        if (!TEMPLATE_NAME_RE.test(opts.template)) {
          throw new AgileError(`模板名不合法（格式 ^[a-z][a-z0-9-]*$）：${opts.template}`);
        }
        const repoPath = `${opts.group}/${name}`.replace(/^\/+/, '');
        const abs = path.join(root, repoPath);
        if (await exists(abs)) {
          throw new AgileError(`目录已存在：${repoPath}`);
        }

        const registry = await loadRegistry(root);
        if (registry.repositories[repoPath]) {
          throw new AgileError(`registry 中已存在：${repoPath}`);
        }

        // 0. 解析模板源（--registry 参数 > workspace.yaml）
        const workspace = await loadWorkspace(root);
        const templateUrl = opts.registry ?? workspace.templates.registry;

        // 1. 加载模板注册中心（克隆/更新缓存到 ~/.agile/templates/）
        const { registry: tplRegistry, repoDir, issues } = await loadTemplates(templateUrl);
        if (issues.length > 0) {
          throw new AgileError(`模板注册中心存在一致性问题，拒绝生成：\n${issues.map((i) => `  - ${i}`).join('\n')}`);
        }
        const entry = tplRegistry.templates[opts.template];
        if (!entry) {
          const available = Object.keys(tplRegistry.templates).join('、');
          throw new AgileError(`模板不存在：${opts.template}。可用模板：${available || '（无）'}`);
        }

        // 2. 脚手架生成到临时目录（.agile/.scaffold 下）
        const tmpDir = path.join(root, '.agile', '.scaffold', repoPath.replace(/\//g, '__'));
        await fs.rm(tmpDir, { recursive: true, force: true });
        await scaffoldFromTemplate(repoDir, name, opts.template, tmpDir, tplRegistry);

        // 3. 临时仓库：init + 初始提交
        await git(tmpDir, ['init', '-b', opts.branch]);
        await git(tmpDir, ['add', '.']);
        await git(tmpDir, ['-c', 'user.email=agile-cli@local', '-c', 'user.name=agile', 'commit', '-m', `chore: init ${name} (${opts.template})`]);

        // 4. 挂载为 submodule（从临时目录 clone 到目标位置）
        await fs.mkdir(path.dirname(abs), { recursive: true });
        const tmpUrl = tmpDir.replace(/\\/g, '/');
        await git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--name', repoPath, tmpUrl, repoPath]);

        // 5. 回写真实 URL（远端或占位）
        const finalUrl = opts.remote ?? `${PLACEHOLDER_URL_PREFIX}${repoPath}.git`;
        await git(root, ['config', '-f', '.gitmodules', `submodule.${repoPath}.url`, finalUrl]);
        await git(root, ['add', '.gitmodules', repoPath]);

        // 6. 清理临时目录 + 注册 registry
        await fs.rm(path.join(root, '.agile', '.scaffold'), { recursive: true, force: true });
        registry.repositories[repoPath] = { url: finalUrl, branch: opts.branch };
        await saveRegistry(root, registry);

        console.log(ui.ok(`项目初始化完成：${repoPath}（template=${opts.template}）`));
        if (!opts.remote) {
          console.log(ui.warn(`registry 中记录的是占位 URL（${finalUrl}）`));
          console.log(ui.dim(`推送到远端后请执行：agile repo set-url ${repoPath} <git-url>`));
        }
      }),
  );
