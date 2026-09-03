import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { DEFAULT_PATHS, DRAWER_PATHS, requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry, saveRegistry, toYaml } from '../core/config.js';
import { git } from '../core/git.js';
import { scaffoldProject, PROJECT_TYPES, type ProjectType } from '../core/templates.js';
import * as ui from '../ui.js';

/** 抽屉目录骨架说明（README 放进各抽屉） */
const DRAWER_READMES: Record<string, string> = {
  'tech-specs': '# 抽屉一：公司级技术规范\n\n技术栈规范、SQL 规范、安全规范、通用工程规范。\n通常作为 Git Submodule 由公司规范团队维护。\n',
  'biz-tech-docs': '# 抽屉二：团队技术设计知识库\n\n架构设计、状态机设计、技术方案、工程规范。\nGit Submodule，团队技术负责人维护。\n',
  'biz-product-docs': '# 抽屉三：产品设计知识库\n\nPRD 模板、产品规范、UI 规范、交互设计规范。\nGit Submodule，产品团队维护。\n',
  projects: '# 抽屉四：团队项目代码\n\n多个微服务/前端项目平铺于此，各自为 Git Submodule。\n使用 `agile init project <name> --type vue|react|go|java|node` 创建。\n',
  'process-docs': '# 抽屉五：过程产物\n\n按需求编号（STO-xxx）归档的过程文档，直接保存在 Workspace 根仓库。\n使用 `agile task create STO-001` 生成标准目录。\n',
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
      .action(async (opts: { name: string; defaultBranch: string }) => {
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
        console.log(ui.dim('  3. agile plugin install agile         # 安装 Claude Code 插件'));
      }),
  )
  .addCommand(
    new Command('project')
      .description('初始化项目仓库（内置模板脚手架 + 注册 registry + 纳入 submodule）')
      .argument('<name>', '项目名（将作为目录名）')
      .requiredOption('--type <type>', `项目类型：${PROJECT_TYPES.join(' | ')}`)
      .option('--group <group>', '所属分组（相对 workspace 根的父目录）', 'projects')
      .option('--branch <branch>', '初始分支名', 'main')
      .option('--remote <url>', '远端 git URL；缺省时记录占位地址，推送后用 repo set-url 更新')
      .action(async (name: string, opts: { type: string; group: string; branch: string; remote?: string }) => {
        const root = requireWorkspaceRoot();
        if (!(PROJECT_TYPES as readonly string[]).includes(opts.type)) {
          throw new AgileError(`不支持的项目类型 ${opts.type}，可选：${PROJECT_TYPES.join(' | ')}`);
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

        // 1. 脚手架生成到临时目录（.agile/.scaffold 下）
        const tmpDir = path.join(root, '.agile', '.scaffold', repoPath.replace(/\//g, '__'));
        await fs.rm(tmpDir, { recursive: true, force: true });
        await scaffoldProject(tmpDir, name, opts.type as ProjectType);

        // 2. 临时仓库：init + 初始提交
        await git(tmpDir, ['init', '-b', opts.branch]);
        await git(tmpDir, ['add', '.']);
        await git(tmpDir, ['-c', 'user.email=agile-cli@local', '-c', 'user.name=agile', 'commit', '-m', `chore: init ${name} (${opts.type})`]);

        // 3. 挂载为 submodule（从临时目录 clone 到目标位置）
        await fs.mkdir(path.dirname(abs), { recursive: true });
        const tmpUrl = tmpDir.replace(/\\/g, '/');
        await git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--name', repoPath, tmpUrl, repoPath]);

        // 4. 回写真实 URL（远端或占位）
        const finalUrl = opts.remote ?? `git@placeholder.local:${repoPath}.git`;
        await git(root, ['config', '-f', '.gitmodules', `submodule.${repoPath}.url`, finalUrl]);
        await git(root, ['add', '.gitmodules', repoPath]);

        // 5. 清理临时目录 + 注册 registry
        await fs.rm(path.join(root, '.agile', '.scaffold'), { recursive: true, force: true });
        registry.repositories[repoPath] = { url: finalUrl, branch: opts.branch };
        await saveRegistry(root, registry);

        console.log(ui.ok(`项目初始化完成：${repoPath}（type=${opts.type}）`));
        if (!opts.remote) {
          console.log(ui.warn(`registry 中记录的是占位 URL（${finalUrl}）`));
          console.log(ui.dim(`推送到远端后请执行：agile repo set-url ${repoPath} <git-url>`));
        }
      }),
  );
