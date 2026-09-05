import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import {
  DEFAULT_PATHS,
  DEFAULT_PLUGIN_MARKETPLACE,
  DEFAULT_TEMPLATE_REGISTRY,
  DRAWER_PATHS,
  requireWorkspaceRoot,
} from '../core/paths.js';
import { loadWorkspace, toYaml } from '../core/config.js';
import { git } from '../core/git.js';
import { loadTemplates, scaffoldFromTemplate, TEMPLATE_NAME_RE } from '../core/template-registry.js';
import { scaffoldEmptyProject } from '../core/scaffold.js';
import * as ui from '../ui.js';

/** 抽屉目录骨架说明（README 放进各抽屉） */
const DRAWER_READMES: Record<string, string> = {
  'tech-specs': '# 抽屉一：公司级技术规范\n\n技术栈规范、SQL 规范、安全规范、通用工程规范。\nGit Submodule，由公司规范团队维护，`agile sync` 自动同步。\n',
  'biz-tech-docs': '# 抽屉二：团队技术设计知识库\n\n架构设计、状态机设计、技术方案、工程规范（workspace 仓库内目录）。\n',
  'biz-product-docs': '# 抽屉三：产品设计知识库\n\nPRD 模板、产品规范、UI 规范、交互设计规范（workspace 仓库内目录）。\n需求文档放 `requirements/<编号>/`（PRD.md、AC.md、feature-tree.md、menu-tree.md）；产品通过 GitHub Web / VS Code 直接编辑（走 PR）。\nPRD 写作模板见 `templates/PRD模板.md`。\n',
  projects: '# 抽屉四：团队项目代码\n\n多个项目平铺于此（workspace 仓库内目录）。\n使用 `agile init project <name> [--template <模板名>]` 创建（--template 缺省为空项目骨架；agile template list 查看模板）。\n',
  'process-docs': '# 抽屉五：过程产物\n\n按需求编号（STO-xxx）归档的过程文档（workspace 仓库内目录）。\n标准目录由 Claude Code 插件命令 /agile:sync-req 或 MCP 工具 agile_task_create 生成。\n',
};

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false);
}

/** 产品需求文档（PRD）写作模板——产品在仓库（GitHub Web / VS Code）按此结构写，最低要求：背景/目标/AC ≥ 1 */
const PRD_TEMPLATE = `# <编号> 需求名称

> 使用方式：复制本文件为 \`requirements/<编号>/PRD.md\` 并填充；配套产物（AC.md / feature-tree.md / menu-tree.md）可选，拆出后与 PRD.md 同目录。
> 最低结构要求：背景、目标、验收标准（AC ≥ 1 条）。

## 背景

（需求来源、业务背景、现状问题）

## 目标

（本需求要达成的业务目标，可量化）

## 验收标准（AC）

- [ ] AC1:
- [ ] AC2:

## 功能树

（可选：功能拆解，/agile:prd 可生成 feature-tree.md）

## 菜单树

（可选：页面/菜单结构，前端页面范围依据）

## 非目标

（可选：本需求明确不做什么）
`;

export const initCommand = new Command('init')
  .description('初始化：workspace 工作空间 或 project 项目')
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

        // 产品 PRD 写作模板（幂等）
        const prdTemplate = path.join(root, 'biz-product-docs', 'templates', 'PRD模板.md');
        if (!(await exists(prdTemplate))) {
          await fs.mkdir(path.dirname(prdTemplate), { recursive: true });
          await fs.writeFile(prdTemplate, PRD_TEMPLATE, 'utf8');
        }

        // git init（幂等）
        if (!(await exists(path.join(root, '.git')))) {
          await git(root, ['init', '-b', opts.defaultBranch]);
        }

        // 根 .gitignore：忽略 worktree 开发目录
        const gitignore = path.join(root, '.gitignore');
        if (!(await exists(gitignore))) {
          await fs.writeFile(gitignore, '.worktrees/\n', 'utf8');
        }

        // 根 .gitattributes：统一换行符为 LF（防跨平台合并假冲突），Windows 脚本保持 CRLF
        const gitattributes = path.join(root, '.gitattributes');
        if (!(await exists(gitattributes))) {
          await fs.writeFile(gitattributes, '* text=auto eol=lf\n*.bat text eol=crlf\n*.cmd text eol=crlf\n', 'utf8');
        }

        console.log(ui.ok(`workspace 初始化完成：${root}`));
        console.log(ui.dim('下一步：'));
        console.log(ui.dim('  1. agile repo add tech-specs <公司规范仓库 git-url>   # 登记外部规范仓库（唯一需要 submodule 的）'));
        console.log(ui.dim('  2. agile sync                                          # 同步外部仓库'));
        console.log(ui.dim('  3. agile template list                                 # 查看项目模板'));
        console.log(ui.dim('  4. agile plugin install agile                          # 安装 Claude Code 插件'));
      }),
  )
  .addCommand(
    new Command('project')
      .description('初始化项目到 projects/ 下（workspace 单仓内普通目录）：--template 从模板脚手架，缺省为空项目骨架')
      .argument('<name>', '项目名（将作为 projects/ 下的目录名）')
      .option('--template <template>', '模板名（agile template list 查看；缺省创建空项目骨架，不访问模板注册中心）')
      .option('--registry <url>', '模板仓库 git URL（默认 workspace.yaml templates.registry）')
      .option('--refresh', '联网刷新模板缓存（默认走本地缓存；agile template update 可强制刷新）')
      .action(async (name: string, opts: { template?: string; registry?: string; refresh?: boolean }) => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        const repoPath = `${workspace.paths.projects}/${name}`;
        const abs = path.join(root, repoPath);
        if (await exists(abs)) {
          throw new AgileError(`目录已存在：${repoPath}`);
        }

        if (opts.template === undefined) {
          // 空项目骨架：不依赖模板注册中心（不联网、不读缓存）
          await scaffoldEmptyProject(abs, name);
        } else {
          if (!TEMPLATE_NAME_RE.test(opts.template)) {
            throw new AgileError(`模板名不合法（格式 ^[a-z][a-z0-9-]*$）：${opts.template}`);
          }

          // 1. 解析模板源（--registry 参数 > workspace.yaml）
          const templateUrl = opts.registry ?? workspace.templates.registry;

          // 2. 加载模板注册中心（默认走本地缓存；--refresh 时联网刷新）
          const { registry: tplRegistry, repoDir, issues } = await loadTemplates(templateUrl, { refresh: opts.refresh === true });
          if (issues.length > 0) {
            throw new AgileError(`模板注册中心存在一致性问题，拒绝生成：\n${issues.map((i) => `  - ${i}`).join('\n')}`);
          }
          const entry = tplRegistry.templates[opts.template];
          if (!entry) {
            const available = Object.keys(tplRegistry.templates).join('、');
            throw new AgileError(`模板不存在：${opts.template}。可用模板：${available || '（无）'}`);
          }

          // 3. 脚手架直接生成到 projects/<name>（workspace 单仓内普通目录）
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await scaffoldFromTemplate(repoDir, name, opts.template, abs, tplRegistry);
        }

        // 4. 纳入 workspace 仓库版本管理（只 add，不自动 commit）
        await git(root, ['add', repoPath]);

        console.log(ui.ok(`项目初始化完成：${repoPath}（${opts.template ? `template=${opts.template}` : '空项目骨架'}）`));
        console.log(ui.dim('已 git add，commit 时机由你决定；提交后与 workspace 其余变更一起走一个 PR。'));
      }),
  );
