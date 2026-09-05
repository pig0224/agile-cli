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
import { loadSettings } from '../core/config.js';
import { git } from '../core/git.js';
import { loadTemplates, scaffoldFromTemplate, TEMPLATE_NAME_RE } from '../core/template-registry.js';
import { scaffoldEmptyProject } from '../core/scaffold.js';
import * as ui from '../ui.js';

/** 抽屉目录骨架说明（README 放进各抽屉） */
const DRAWER_READMES: Record<string, string> = {
  'tech-specs': '# 抽屉一：公司级技术规范\n\n技术栈规范、SQL 规范、安全规范、通用工程规范。\n外部 git 仓库（公司规范团队维护），目录不入 workspace 仓库（.gitignore 忽略）：`agile config set tech-specs <git-url>` 登记后 `agile sync` 自动 clone/拉取。\n',
  'biz-tech-docs': '# 抽屉二：团队技术设计知识库\n\n架构设计、状态机设计、技术方案、工程规范（默认 workspace 仓库内目录）。\n多 workspace 团队可登记为外部 git 仓库共享（单一事实源，同样不入库）：`agile config set biz-tech-docs <git-url>` 后 `agile sync`（骨架目录自动让位）。\n',
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

/** 旧版三 yaml（workspace/registry/plugin）→ settings.json 自动迁移；旧文件保留在磁盘，由人工 git rm */
async function migrateLegacyConfig(agileDir: string, settingsFile: string): Promise<boolean> {
  const legacyWorkspace = path.join(agileDir, 'workspace.yaml');
  if (!(await exists(legacyWorkspace))) return false;
  const YAML = await import('yaml');
  const raw = ((await YAML.parse(await fs.readFile(legacyWorkspace, 'utf8'))) ?? {}) as Record<string, any>;
  const registryRaw = await fs
    .readFile(path.join(agileDir, 'registry.yaml'), 'utf8')
    .then((c) => (YAML.parse(c) ?? {}) as Record<string, any>)
    .catch(() => ({}) as Record<string, any>);
  const pluginRaw = await fs
    .readFile(path.join(agileDir, 'plugin.yaml'), 'utf8')
    .then((c) => (YAML.parse(c) ?? {}) as Record<string, any>)
    .catch(() => ({}) as Record<string, any>);

  const paths = { ...DEFAULT_PATHS, ...(raw.paths ?? {}) };
  const repositories = (registryRaw.repositories ?? {}) as Record<string, { url?: string }>;
  const techSpecsUrl = repositories[paths.techSpecs]?.url;
  const bizTechDocsUrl = repositories[paths.bizTechDocs]?.url;

  const settings = {
    version: 1,
    name: raw.name ?? path.basename(process.cwd()),
    created: raw.created ?? new Date().toISOString().slice(0, 10),
    defaultBranch: raw.defaultBranch ?? 'main',
    paths,
    repos: {
      ...(techSpecsUrl ? { techSpecs: { url: techSpecsUrl } } : {}),
      ...(bizTechDocsUrl ? { bizTechDocs: { url: bizTechDocsUrl } } : {}),
    },
    plugins: {
      marketplace: raw.plugin?.marketplace ?? DEFAULT_PLUGIN_MARKETPLACE,
      dependencies: pluginRaw.dependencies ?? {},
    },
    templates: { registry: raw.templates?.registry ?? DEFAULT_TEMPLATE_REGISTRY },
  };
  await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return true;
}

export const initCommand = new Command('init')
  .description('初始化：workspace 工作空间 或 project 项目')
  .addCommand(
    new Command('workspace')
      .description('初始化 workspace（.agile/settings.json + 五个抽屉骨架 + git 仓库；旧版三 yaml 自动迁移）')
      .option('--name <name>', 'workspace 名称', path.basename(process.cwd()))
      .option('--default-branch <branch>', '默认分支', 'main')
      .option('--marketplace <url>', '插件市场 git 地址', DEFAULT_PLUGIN_MARKETPLACE)
      .option('--template-registry <url>', '项目模板注册中心 git 地址', DEFAULT_TEMPLATE_REGISTRY)
      .option('--tech-specs <url>', '公司级规范外部仓库 git 地址（也可之后 agile config set tech-specs）')
      .option('--biz-tech-docs <url>', '团队知识库外部仓库 git 地址（可选；也可之后 agile config set biz-tech-docs）')
      .action(
        async (opts: {
          name: string;
          defaultBranch: string;
          marketplace: string;
          templateRegistry: string;
          techSpecs?: string;
          bizTechDocs?: string;
        }) => {
          const root = process.cwd();

          // 幂等：允许重复 init，但不覆盖已有配置
          const agileDir = path.join(root, '.agile');
          await fs.mkdir(agileDir, { recursive: true });

          const settingsFile = path.join(agileDir, 'settings.json');
          if (!(await exists(settingsFile))) {
            // 优先迁移旧版三 yaml（内容并入 settings.json，旧文件保留）
            const migrated = await migrateLegacyConfig(agileDir, settingsFile);
            if (migrated) {
              console.log(ui.warn('检测到旧版 .agile 配置（workspace.yaml / registry.yaml / plugin.yaml），已自动迁移到 .agile/settings.json。'));
              console.log(ui.dim('旧文件内容已全部并入，确认无误后请人工删除：git rm .agile/workspace.yaml .agile/registry.yaml .agile/plugin.yaml'));
              console.log(ui.dim('注意：tech-specs / biz-tech-docs 现由 agile sync 管理（目录不入库、走 .gitignore）；若此前登记为 submodule，请先人工执行 git submodule deinit --all 再 agile sync。'));
            } else {
              const settings = {
                version: 1,
                name: opts.name,
                created: new Date().toISOString().slice(0, 10),
                defaultBranch: opts.defaultBranch,
                paths: { ...DEFAULT_PATHS },
                repos: {
                  ...(opts.techSpecs ? { techSpecs: { url: opts.techSpecs } } : {}),
                  ...(opts.bizTechDocs ? { bizTechDocs: { url: opts.bizTechDocs } } : {}),
                },
                plugins: { marketplace: opts.marketplace, dependencies: {} },
                templates: { registry: opts.templateRegistry },
              };
              await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
            }
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

          // 根 .gitignore：幂等确保三行——worktree 开发目录 + 两个外部仓库抽屉（不入库）
          const gitignore = path.join(root, '.gitignore');
          let gi = '';
          try {
            gi = await fs.readFile(gitignore, 'utf8');
          } catch {
            /* 新文件 */
          }
          const have = new Set(
            gi
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean),
          );
          const missing = ['.worktrees/', 'tech-specs/', 'biz-tech-docs/'].filter((l) => !have.has(l));
          if (missing.length > 0) {
            gi = gi === '' ? `${missing.join('\n')}\n` : `${gi.replace(/\n*$/, '\n')}${missing.join('\n')}\n`;
            await fs.writeFile(gitignore, gi, 'utf8');
          }

          // 根 .gitattributes：统一换行符为 LF（防跨平台合并假冲突），Windows 脚本保持 CRLF
          const gitattributes = path.join(root, '.gitattributes');
          if (!(await exists(gitattributes))) {
            await fs.writeFile(gitattributes, '* text=auto eol=lf\n*.bat text eol=crlf\n*.cmd text eol=crlf\n', 'utf8');
          }

          const settings = await loadSettings(root);
          console.log(ui.ok(`workspace 初始化完成：${root}`));
          console.log(ui.dim('下一步：'));
          let n = 1;
          if (!settings.repos.techSpecs?.url) {
            console.log(ui.dim(`  ${n++}. agile config set tech-specs <公司规范仓库 git-url>       # 登记公司级规范（不入库，agile sync 拉取）`));
          }
          if (!settings.repos.bizTechDocs?.url) {
            console.log(ui.dim(`  ${n++}. agile config set biz-tech-docs <团队知识库仓库 git-url>  # 可选：多 workspace 团队共享知识库`));
          }
          console.log(ui.dim(`  ${n++}. agile sync            # 拉取外部仓库 + 模板缓存 + 插件`));
          console.log(ui.dim(`  ${n++}. agile template list   # 查看项目模板`));
          console.log(ui.dim(`  ${n++}. agile plugin install agile  # 安装 Claude Code 插件`));
        },
      ),
  )
  .addCommand(
    new Command('project')
      .description('初始化项目到 projects/ 下（workspace 单仓内普通目录）：--template 从模板脚手架，缺省为空项目骨架')
      .argument('<name>', '项目名（将作为 projects/ 下的目录名）')
      .option('--template <template>', '模板名（agile template list 查看；缺省创建空项目骨架，不访问模板注册中心）')
      .action(async (name: string, opts: { template?: string }) => {
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);
        const repoPath = `${settings.paths.projects}/${name}`;
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

          // 1. 加载模板注册中心（源 = settings.json templates.registry；默认走本地缓存）
          const { registry: tplRegistry, repoDir, issues } = await loadTemplates(settings.templates.registry);
          if (issues.length > 0) {
            throw new AgileError(`模板注册中心存在一致性问题，拒绝生成：\n${issues.map((i) => `  - ${i}`).join('\n')}`);
          }
          const entry = tplRegistry.templates[opts.template];
          if (!entry) {
            const available = Object.keys(tplRegistry.templates).join('、');
            throw new AgileError(`模板不存在：${opts.template}。可用模板：${available || '（无）'}`);
          }

          // 2. 脚手架直接生成到 projects/<name>（workspace 单仓内普通目录）
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await scaffoldFromTemplate(repoDir, name, opts.template, abs, tplRegistry);
        }

        // 3. 纳入 workspace 仓库版本管理（只 add，不自动 commit）
        await git(root, ['add', repoPath]);

        console.log(ui.ok(`项目初始化完成：${repoPath}（${opts.template ? `template=${opts.template}` : '空项目骨架'}）`));
        console.log(ui.dim('已 git add，commit 时机由你决定；提交后与 workspace 其余变更一起走一个 PR。'));
      }),
  );
