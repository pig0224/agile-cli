import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import {
  DEFAULT_PATHS,
  DEFAULT_PLUGIN_MARKETPLACE,
  DEFAULT_TEMPLATE_REGISTRY,
  requireWorkspaceRoot,
} from '../core/paths.js';
import { loadSettings } from '../core/config.js';
import { git } from '../core/git.js';
import {
  loadTemplates,
  scaffoldFromTemplate,
  scaffoldSolution,
  TEMPLATE_NAME_RE,
  type ForceSpec,
  type SolutionScaffoldResult,
} from '../core/template-registry.js';
import { assertProjectName, scaffoldEmptyProject, type CopyNotice } from '../core/scaffold.js';
import * as ui from '../ui.js';

/** 模板复制忽略通知的说明文字（reason → 中文标签） */
const NOTICE_LABELS: Record<CopyNotice['reason'], string> = {
  artifact: '安装/构建产物',
  symlink: '符号链接/junction，不随模板复制',
  lockfile: '锁文件',
};

/** 输出模板复制忽略通知（core 不打印；ui.warn 自带 ⚠ 前缀，此处不再加） */
function printCopyNotices(notices: CopyNotice[]): void {
  for (const n of notices) {
    console.log(ui.warn(`已忽略模板产物：${n.path}（${NOTICE_LABELS[n.reason]}）`));
  }
}

/** 抽屉骨架说明（README 放进各抽屉；key 与 settings.paths 的键一致） */
const DRAWER_READMES: Record<keyof typeof DEFAULT_PATHS, string> = {
  techSpecs: '# 抽屉一：公司级技术规范\n\n技术栈规范、SQL 规范、安全规范、通用工程规范。\n外部 git 仓库（公司规范团队维护），目录不入 workspace 仓库（.gitignore 忽略）：`agile config set tech-specs <git-url>` 登记后 `agile sync` 自动 clone/拉取。\n',
  bizTechDocs: '# 抽屉二：团队技术设计知识库\n\n架构设计、状态机设计、技术方案、工程规范（workspace 仓库内普通目录，随仓库提交获得版本管理）。\n多 workspace 团队可登记为外部 git 仓库共享（单一事实源）：`agile config set biz-tech-docs <git-url>` 后 `agile sync`——登记后目录改为 .gitignore 忽略、不入 workspace 仓库（sync 自动补写忽略行），骨架目录自动让位。\n',
  bizProductDocs: '# 抽屉三：产品设计知识库\n\nPRD 模板、产品规范、UI 规范、交互设计规范（workspace 仓库内目录）。\n需求文档放 `requirements/<编号>/`（PRD.md、AC.md、feature-tree.md、menu-tree.md）；产品通过 GitHub Web / VS Code 直接编辑（走 PR）。\nPRD 写作模板见 `templates/PRD模板.md`。\n',
  projects: '# 抽屉四：团队项目代码\n\n单项目与组合模板的成员项目均平铺于此（workspace 仓库内目录；组合模板一次生成多个平铺成员项目，成员名与模板名同命名空间、全局唯一）。\n使用 `agile init project <name> [--template <模板或组合模板名>]` 创建（--template 缺省为空项目骨架；agile template list 查看模板与组合模板）。\n',
  processDocs: '# 抽屉五：过程产物\n\n按需求编号（STO-xxx / BUG-xxx / OPS-xxx）归档的过程文档（workspace 仓库内目录）。\n标准目录由 Claude Code 插件命令 /agile:sync-req、/agile:fix-bug 等按 sdd-tdd-method SKILL 附录模板直接创建。\n',
};

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true).catch(() => false);
}

/** --member 收集器（可重复）：只收集原始字符串，格式与冲突校验统一在 action 内做（AgileError 路径） */
function collectMember(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

/** 解析 --member 原始串（成员名=目录名）为覆盖表；格式错误 / 重复成员抛中文报错 */
function parseMemberOverrides(raw: string[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const item of raw) {
    const m = /^([a-z][a-z0-9-]*)=([a-z][a-z0-9-]*)$/.exec(item);
    if (!m || !m[1] || !m[2]) {
      throw new AgileError(
        `--member 格式不合法（须为 成员名=目录名，两端满足 ^[a-z][a-z0-9-]*$）：${item}`,
      );
    }
    const member = m[1];
    const dir = m[2];
    if (overrides[member] !== undefined) {
      throw new AgileError(`--member 重复指定成员：${member}`);
    }
    overrides[member] = dir;
  }
  return overrides;
}

/** --force 收集器（可重复）。commander 15 对裸标志不走 collector 直接置 true，
 *  裸标志后再带值时会以 true 作为 previous 传入——两种形态都归一成数组。 */
function collectForce(
  value: string | true,
  previous: Array<string | true> | true | undefined,
): Array<string | true> {
  if (previous === true) return [true, value];
  const base = Array.isArray(previous) ? [...previous] : [];
  base.push(value);
  return base;
}

/** 解析 --force：无值 = 全部已存在成员；--force <成员名> = 重建指定成员（可重复）；两者混用报错 */
function parseForce(raw: Array<string | true> | string | boolean | undefined): ForceSpec {
  const list: Array<string | true> =
    raw === undefined || raw === false
      ? []
      : Array.isArray(raw)
        ? raw
        : [raw as string | true];
  const all = list.includes(true);
  const members = list.filter((v): v is string => v !== true);
  if (all && members.length > 0) {
    throw new AgileError(
      '--force 不能同时无值与指定成员名（--force = 全部已存在成员；--force <成员名> = 重建指定成员，可重复）',
    );
  }
  return { all, members };
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
    version: 2,
    name: raw.name ?? path.basename(process.cwd()),
    created: raw.created ?? new Date().toISOString().slice(0, 10),
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
      .option('--marketplace <url>', '插件市场 git 地址', DEFAULT_PLUGIN_MARKETPLACE)
      .option('--template-registry <url>', '项目模板注册中心 git 地址', DEFAULT_TEMPLATE_REGISTRY)
      .option('--tech-specs <url>', '公司级规范外部仓库 git 地址（也可之后 agile config set tech-specs）')
      .option('--biz-tech-docs <url>', '团队知识库外部仓库 git 地址（可选；也可之后 agile config set biz-tech-docs）')
      .action(
        async (opts: {
          name: string;
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
              console.log(ui.dim('注意：已登记的 tech-specs / biz-tech-docs 现由 agile sync 管理（目录不入库、走 .gitignore）；若此前登记为 submodule，请先人工执行 git submodule deinit --all 再 agile sync。'));
            } else {
              const settings = {
                version: 2,
                name: opts.name,
                created: new Date().toISOString().slice(0, 10),
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

          // 抽屉骨架：目录与 README 一律按 settings.paths 落地（含迁移/手改过的自定义路径）
          const settings = await loadSettings(root);
          for (const [key, drawer] of Object.entries(settings.paths)) {
            const dir = path.join(root, drawer);
            await fs.mkdir(dir, { recursive: true });
            const readme = path.join(dir, 'README.md');
            const content = DRAWER_READMES[key as keyof typeof DEFAULT_PATHS];
            if (!(await exists(readme)) && content) {
              await fs.writeFile(readme, content, 'utf8');
            }
          }

          // 产品 PRD 写作模板（幂等）
          const prdTemplate = path.join(root, settings.paths.bizProductDocs, 'templates', 'PRD模板.md');
          if (!(await exists(prdTemplate))) {
            await fs.mkdir(path.dirname(prdTemplate), { recursive: true });
            await fs.writeFile(prdTemplate, PRD_TEMPLATE, 'utf8');
          }

          // git init（幂等；初始分支固定 main——改名用 git branch -m）
          if (!(await exists(path.join(root, '.git')))) {
            await git(root, ['init', '-b', 'main']);
          }

          // 根 .gitignore：幂等补缺——worktree 开发目录 + tech-specs（公司级规范，天然外部仓库，始终忽略）；
          // biz-tech-docs 仅在登记为外部仓库时忽略（默认 workspace 内普通目录，随仓库提交获得版本管理），
          // 后补登记由 agile sync 拉取成功后自动补写该行
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
          const missing = [
            '.worktrees/',
            `${settings.paths.techSpecs}/`,
            ...(settings.repos.bizTechDocs?.url ? [`${settings.paths.bizTechDocs}/`] : []),
          ].filter((l) => !have.has(l));
          if (missing.length > 0) {
            gi = gi === '' ? `${missing.join('\n')}\n` : `${gi.replace(/\n*$/, '\n')}${missing.join('\n')}\n`;
            await fs.writeFile(gitignore, gi, 'utf8');
          }

          // 根 .gitattributes：统一换行符为 LF（防跨平台合并假冲突），Windows 脚本保持 CRLF
          const gitattributes = path.join(root, '.gitattributes');
          if (!(await exists(gitattributes))) {
            await fs.writeFile(gitattributes, '* text=auto eol=lf\n*.bat text eol=crlf\n*.cmd text eol=crlf\n', 'utf8');
          }

          console.log(ui.ok(`workspace 初始化完成：${root}`));
          console.log(ui.dim('下一步：'));
          let n = 1;
          if (!settings.repos.techSpecs?.url) {
            console.log(ui.dim(`  ${n++}. agile config set tech-specs <公司规范仓库 git-url>       # 登记公司级规范（不入库，agile sync 拉取）`));
          }
          if (!settings.repos.bizTechDocs?.url) {
            console.log(ui.dim(`  ${n++}. agile config set biz-tech-docs <团队知识库仓库 git-url>  # 可选：多 workspace 团队共享知识库（登记后目录改为外部仓库、不入库）`));
          }
          console.log(ui.dim(`  ${n++}. agile sync            # 拉取外部仓库 + 模板缓存 + 插件`));
          console.log(ui.dim(`  ${n++}. agile template list   # 查看项目模板`));
          console.log(ui.dim(`  ${n++}. agile plugin install agile  # 安装 Claude Code 插件`));
        },
      ),
  )
  .addCommand(
    new Command('project')
      .description('初始化项目到 projects/ 下（workspace 单仓内普通目录）：--template 从模板或组合模板脚手架（组合模板一次生成多个平铺成员项目），缺省为空项目骨架')
      .argument('<name>', '项目名（作为 projects/ 下的目录名；--template 为组合模板时仅为输出标签，不落目录）')
      .option('--template <template>', '模板名或组合模板名（agile template list 查看；缺省创建空项目骨架，不访问模板注册中心）')
      .option(
        '--member <mapping>',
        '组合模板成员目录名覆盖（格式：成员名=目录名，可重复；仅 --template 为组合模板时可用）',
        collectMember,
        [] as string[],
      )
      .option(
        '--force [member]',
        '强制重建已存在成员（无值 = 全部已存在成员；--force <成员名> = 指定成员，可重复；仅对有本 CLI 生成清单的目录生效——陌生目录拒绝重建以防误删手写项目）',
        collectForce,
        [] as Array<string | true>,
      )
      .action(async (name: string, opts: { template?: string; member: string[]; force: Array<string | true> | boolean }) => {
        const root = requireWorkspaceRoot();
        // 项目名校验：同时用作 projects/ 目录名与模板 {{name}} 占位（npm name / go module 等），
        // 且杜绝 ../ 路径穿越出 projects/
        assertProjectName(name);
        // --force 归一化（commander 15 裸标志直接置 true，不走 collector）并提前校验混用
        const force = parseForce(opts.force);
        const settings = await loadSettings(root);
        const repoPath = `${settings.paths.projects}/${name}`;
        const abs = path.join(root, repoPath);

        if (opts.template === undefined) {
          if (opts.member.length > 0) {
            throw new AgileError('--member 仅在 --template 为组合模板时可用');
          }
          if (force.all || force.members.length > 0) {
            throw new AgileError('--force 仅在 --template 时可用（空项目骨架无模板可重建）');
          }
          // 空项目骨架：不依赖模板注册中心（不联网、不读缓存）
          if (await exists(abs)) {
            throw new AgileError(`目录已存在：${repoPath}`);
          }
          await scaffoldEmptyProject(abs, name);
          await git(root, ['add', repoPath]);
          console.log(ui.ok(`项目初始化完成：${repoPath}（空项目骨架）`));
          console.log(ui.dim('已 git add，commit 时机由你决定；提交后与 workspace 其余变更一起走一个 PR。'));
          return;
        }

        if (!TEMPLATE_NAME_RE.test(opts.template)) {
          throw new AgileError(`模板名不合法（格式 ^[a-z][a-z0-9-]*$）：${opts.template}`);
        }

        // 1. 加载模板注册中心（源 = settings.json templates.registry；默认走本地缓存）
        const { registry: tplRegistry, repoDir, issues } = await loadTemplates(settings.templates.registry);
        if (issues.length > 0) {
          throw new AgileError(`模板注册中心存在一致性问题，拒绝生成：\n${issues.map((i) => `  - ${i}`).join('\n')}`);
        }

        // 2a. 单例模板：平铺生成到 projects/<name>（重跑校验/重建语义在 core，按生成清单判定）
        if (tplRegistry.singles.some((t) => t.name === opts.template)) {
          if (opts.member.length > 0) {
            throw new AgileError('--member 仅在 --template 为组合模板时可用');
          }
          if (force.members.length > 0) {
            throw new AgileError('--force <成员名> 仅组合模板支持；单例模板使用无值 --force');
          }
          await fs.mkdir(path.dirname(abs), { recursive: true });
          const result = await scaffoldFromTemplate(repoDir, name, opts.template, abs, tplRegistry, {
            workspaceRoot: root,
            force,
          });
          printCopyNotices(result.notices);
          if (result.rebuilt) {
            console.log(ui.warn(`已强制重建：${repoPath}（原目录内容已按模板重生成）`));
          }
          await git(root, ['add', repoPath]);
          // 生成清单入库：成员重跑的完整性校验依赖它，随项目一起走 PR
          const manifestFile = `.agile/manifests/${name}.json`;
          if (await exists(path.join(root, manifestFile))) {
            await git(root, ['add', manifestFile]);
          }
          console.log(ui.ok(`项目初始化完成：${repoPath}（template=${opts.template}）`));
          console.log(ui.dim('已 git add，commit 时机由你决定；提交后与 workspace 其余变更一起走一个 PR。'));
          return;
        }

        // 2b. 组合模板：成员项目平铺落盘 projects/<成员目录名>/（成员 = 组合专属模板目录
        //     solutions/<组合>/<成员>/；{{name}} = 实际目录名；<name> 仅为输出标签，不落目录）
        const solutionEntry = tplRegistry.solutions.find((s) => s.name === opts.template);
        if (solutionEntry === undefined) {
          const templates = tplRegistry.singles.map((t) => t.name).join('、') || '（无）';
          const solutions = tplRegistry.solutions.map((s) => s.name);
          throw new AgileError(
            `模板不存在：${opts.template}。可用模板：${templates}${
              solutions.length > 0 ? `\n可用组合模板：${solutions.join('、')}` : ''
            }`,
          );
        }
        const overrides = parseMemberOverrides(opts.member);
        const result: SolutionScaffoldResult = await scaffoldSolution(
          repoDir,
          tplRegistry,
          opts.template,
          path.join(root, settings.paths.projects),
          overrides,
          { workspaceRoot: root, force },
        );

        // 3. 纳入 workspace 仓库版本管理（只 add，不自动 commit；逐成员 add 生成/重建的目录与对应生成清单）
        for (const d of [...result.created, ...result.rebuilt]) {
          await git(root, ['add', `${settings.paths.projects}/${d}`]);
          const manifestFile = `.agile/manifests/${d}.json`;
          if (await exists(path.join(root, manifestFile))) {
            await git(root, ['add', manifestFile]);
          }
        }
        // 组合根耦合资产快照随成员一起入库（知识同步的源，与生成清单同为 workspace 版本管理资产）
        if (result.comboAssets?.copied && result.comboAssets.files > 0) {
          await git(root, ['add', `.agile/solutions/${opts.template}`]);
        }

        console.log(ui.ok(`系统 ${name} 初始化完成（template=${opts.template}，成员平铺于 projects/）：`));
        for (const d of result.created) console.log(ui.ok(`  + ${settings.paths.projects}/${d}`));
        for (const d of result.rebuilt) {
          console.log(ui.warn(`  ! 已强制重建：${settings.paths.projects}/${d}（原目录内容已按模板重生成）`));
        }
        for (const d of result.skipped) {
          console.log(ui.warn(`  = 已存在，跳过：${settings.paths.projects}/${d}（若为同名非组合项目请人工核对）`));
        }
        if (result.comboAssets?.copied && result.comboAssets.files > 0) {
          console.log(ui.ok(`  + .agile/solutions/${opts.template}（组合根耦合资产，${result.comboAssets.files} 文件）`));
        } else if (result.comboAssets?.present) {
          console.log(ui.dim(`  = 组合耦合资产快照已存在：.agile/solutions/${opts.template}（跳过，不覆盖）`));
        }
        printCopyNotices(result.notices);
        if (result.comboAssets?.present) {
          console.log(ui.dim(`组合耦合约定与规范在 .agile/solutions/${opts.template}/（CLAUDE.md + docs/）：可用 /agile:knowledge 按资产类型同步到 biz-tech-docs / biz-product-docs。`));
        }
        console.log(ui.dim('已 git add，commit 时机由你决定；提交后与 workspace 其余变更一起走一个 PR。'));
      }),
  );
