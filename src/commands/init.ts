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
  type SolutionScaffoldResult,
} from '../core/template-registry.js';
import { PROJECT_NAME_RE, scaffoldEmptyProject, workspaceClaudeMdContent, type CopyNotice } from '../core/scaffold.js';
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
  techSpecs: '# 抽屉一：公司级技术规范\n\n技术栈规范、SQL 规范、安全规范、通用工程规范。\n',
  bizTechDocs: '# 抽屉二：团队技术设计知识库\n\n架构设计、状态机设计、技术方案、工程规范。\n',
  bizProductDocs: '# 抽屉三：产品设计知识库\n\nPRD 模板、产品规范、UI 规范、交互设计规范。\n需求文档放 `requirements/<编号>/`（PRD.md、AC.md、feature-tree.md、menu-tree.md）。\n需求输入提示词放 `prompts/`（/agile:prd 的描述源，一需求一稿，可选流程；约定见 `prompts/README.md`）。\n',
  projects: '# 抽屉四：团队项目代码\n\n单项目与组合模板的成员项目均平铺于此。\n',
  processDocs: '# 抽屉五：过程产物\n\n按需求编号（STO-xxx / BUG-xxx / OPS-xxx）归档的过程文档。\n',
};

async function exists(p: string): Promise<boolean> {
  // lstat：不跟随符号链接——悬空 symlink 也算「存在」，避免误判不存在后在后续步骤抛原始 ENOENT/EEXIST 堆栈
  return fs.lstat(p).then(() => true).catch(() => false);
}

/** --name 收集器（可重复）：只收集原始字符串；形态（裸值 / 键值）与合法性在 action 内按场景校验 */
function collectName(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

/** --name 裸目录名校验：同时用作 projects/ 目录名与 {{name}} 占位（npm name / go module 等），
 *  且杜绝 ../ 路径穿越出 projects/ */
function assertDirName(value: string): string {
  if (!PROJECT_NAME_RE.test(value)) {
    throw new AgileError(`--name 目录名不合法（格式 ^[a-z][a-z0-9-]*$，仅小写字母/数字/连字符）：${value}`);
  }
  return value;
}

/** 解析单例模板 / 空项目骨架场景的 --name：裸目录名，至多 1 个（空项目骨架必填，单例缺省由调用方回落模板名）。
 *  键值形态 / 多值 / 不合法目录名报错并说明该场景的正确形态。 */
function parseBareName(raw: string[], scene: '空项目骨架' | '单例模板', required: true): string;
function parseBareName(raw: string[], scene: '空项目骨架' | '单例模板', required: false): string | undefined;
function parseBareName(raw: string[], scene: '空项目骨架' | '单例模板', required: boolean): string | undefined {
  if (raw.length === 0) {
    if (required) {
      throw new AgileError(`${scene}需要 --name <目录名> 指定项目目录名（2.4.0 起不再接受位置参数）`);
    }
    return undefined;
  }
  if (raw.length > 1) {
    throw new AgileError(`--name 只能指定一次（${scene}的 --name 为单个裸目录名，如 --name my-app）`);
  }
  const value = raw[0]!;
  if (value.includes('=')) {
    throw new AgileError(
      `--name 格式不合法：${scene}的 --name 为裸目录名（如 --name my-app）；「组合项目名称=目录名」形态仅组合模板可用`,
    );
  }
  return assertDirName(value);
}

/** 解析组合模板场景的 --name：组合项目名称=目录名 键值（可重复）；裸值 / 格式错误 / 重复成员报错。
 *  缺省（空数组）= 各成员用组合项目名称（core 按登记成员名落盘）；未知成员由 core 校验拒绝。 */
function parseSolutionNameOverrides(raw: string[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const item of raw) {
    const m = /^([a-z][a-z0-9-]*)=([a-z][a-z0-9-]*)$/.exec(item);
    if (!m || !m[1] || !m[2]) {
      throw new AgileError(
        `--name 格式不合法：组合模板的 --name 为 组合项目名称=目录名（两端满足 ^[a-z][a-z0-9-]*$）：${item}`,
      );
    }
    const member = m[1];
    if (overrides[member] !== undefined) {
      throw new AgileError(`--name 重复指定组合项目名称：${member}`);
    }
    overrides[member] = m[2];
  }
  return overrides;
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

/** 需求输入提示词目录约定（prompts/README.md 预建内容）——提示词是「源」，PRD 是编译产物 */
const PROMPTS_README = `# 需求输入提示词

\`/agile:prd <编号>\` 的需求描述源。**提示词是「源」，PRD 是编译产物**——需求变更（范围 / 规则调整）优先改这里、重跑 \`/agile:prd <编号>\` 再生成；细节修订（补一条 AC、勾选状态、文字勘误）直接改 PRD/AC 即可，重跑时人工修订会被检测采纳、不会覆盖。

## 使用约定

- **一需求一稿**：文件名 = 需求编号（\`STO-001.md\`、\`BUG-003.md\`），平铺本目录，不建子目录。
- **首行 H1**：\`# <编号> <主题>\`，如 \`# STO-001 订单导出三个月流水\`——编号排序天然时序，首行主题可 grep，不需要另建索引。
- **读取方式**：\`/agile:prd <编号>\` 时本目录同名稿存在则自动作为需求描述（命令参数文字可叠加补充）；自由命名稿用 \`--prompt <路径>\` 显式指定。
- **多轮调整**：会话中直接说「把刚才的调整收敛进 prompts/<编号>.md」，或自行编辑（VS Code / GitHub Web）后重跑 prd。
- **配套材料**（截图、纪要、外部文档要点）放 \`requirements/<编号>/\`，稿内以相对链接引用；本目录只放提示词本体。
- **交付后保留原地**：即需求理解的历史记录，不归档、不移位（续作感知按编号定位）。
- **轻量通道**（BUG / OPS 一句话需求）无需提示词稿；确需时按同约定放置即可。

## 推荐骨架

自由 markdown，仅推荐不强制：

\`\`\`markdown
# STO-001 订单导出三个月流水

## 一句话
（做什么、给谁用、解决什么问题）

## 细节与约束
- 业务规则 / 边界 / 异常路径
- 非功能点（性能、权限、数据量…）

## 明确不做
- 排除项

## 参考
- 外部文档链接、旧版行为、会话纪要要点
\`\`\`

## 导航与登记

- **不逐条登记库根导航、不设归档分组、无 frontmatter**：本目录是需求工作材料（与 \`requirements/\`、\`prototypes/\` 同族），不是知识文档——编号即索引，git 即历史。
- 库根导航仅保留固定入口一行（指向本 README），新增提示词不登记。
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
    name: raw.name ?? (path.basename(process.cwd()) || 'workspace'),
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
      .option('--name <name>', 'workspace 名称', path.basename(process.cwd()) || 'workspace')
      .option('--marketplace <url>', '插件市场 git 地址', DEFAULT_PLUGIN_MARKETPLACE)
      .option('--template-registry <url>', '项目模板注册中心 git 地址', DEFAULT_TEMPLATE_REGISTRY)
      .option('--tech-specs <url>', '公司级规范外部仓库 git 地址（可选；也可之后 agile config set tech-specs）')
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

          // 需求输入提示词目录约定（幂等）——prompts/README.md 即 /agile:prd 描述源的使用说明
          const promptsReadme = path.join(root, settings.paths.bizProductDocs, 'prompts', 'README.md');
          if (!(await exists(promptsReadme))) {
            await fs.mkdir(path.dirname(promptsReadme), { recursive: true });
            await fs.writeFile(promptsReadme, PROMPTS_README, 'utf8');
          }

          // git init（幂等；初始分支固定 main——改名用 git branch -m）
          if (!(await exists(path.join(root, '.git')))) {
            await git(root, ['init', '-b', 'main']);
          }

          // 根 .gitignore：幂等补缺——worktree 开发目录 + 项目生成事务临时目录（.tmp-*）+
          // 过程档案本机留存目录（process-docs/<编号>/assets/ 截图与 scripts/ 一次性验证脚本——
          // 均不入库；有长期价值的复现/回归走项目测试套件与 e2e/）+
          // 已登记的外部仓库抽屉（tech-specs / biz-tech-docs 同一规则：登记为外部仓库才忽略——
          // 默认 workspace 内普通目录，随仓库提交获得版本管理；后补登记由 agile sync 拉取成功后自动补写该行）
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
            '.tmp-*/',
            `${settings.paths.processDocs}/*/assets/`,
            `${settings.paths.processDocs}/*/scripts/`,
            ...(settings.repos.techSpecs?.url ? [`${settings.paths.techSpecs}/`] : []),
            ...(settings.repos.bizTechDocs?.url ? [`${settings.paths.bizTechDocs}/`] : []),
          ].filter((l) => !have.has(l));
          if (missing.length > 0) {
            // 追加行跟随既有文件换行风格（CRLF 文件不产生混合换行）
            const eol = gi.includes('\r\n') ? '\r\n' : '\n';
            const additions = missing.join(eol);
            gi = gi === '' ? `${additions}${eol}` : `${gi.replace(/\r?\n*$/, eol)}${additions}${eol}`;
            await fs.writeFile(gitignore, gi, 'utf8');
          }

          // 根 .gitattributes：统一换行符为 LF（防跨平台合并假冲突），Windows 脚本保持 CRLF
          const gitattributes = path.join(root, '.gitattributes');
          if (!(await exists(gitattributes))) {
            await fs.writeFile(gitattributes, '* text=auto eol=lf\n*.bat text eol=crlf\n*.cmd text eol=crlf\n', 'utf8');
          }

          // workspace 根 CLAUDE.md 导航地图（幂等；AI 会话不依赖 README 导航）
          // 已存在即跳过——人工会持续增补（团队约定/项目指针），CLI 永不覆盖
          const claudeMd = path.join(root, 'CLAUDE.md');
          if (!(await exists(claudeMd))) {
            await fs.writeFile(claudeMd, workspaceClaudeMdContent(settings.name, settings.paths), 'utf8');
            console.log(ui.dim('已生成 CLAUDE.md（workspace 导航地图）：按团队实际增补后随仓库提交。'));
          }

          console.log(ui.ok(`workspace 初始化完成：${root}`));
          console.log(ui.dim('下一步：'));
          let n = 1;
          if (!settings.repos.techSpecs?.url) {
            console.log(ui.dim(`  ${n++}. agile config set tech-specs <公司规范仓库 git-url>       # 可选：公司规范集中维护（登记后目录改为外部仓库、不入库；未登记则随 workspace 仓库提交）`));
          }
          if (!settings.repos.bizTechDocs?.url) {
            console.log(ui.dim(`  ${n++}. agile config set biz-tech-docs <团队知识库仓库 git-url>  # 可选：多 workspace 团队共享知识库（登记后目录改为外部仓库、不入库；未登记则随 workspace 仓库提交）`));
          }
          console.log(ui.dim(`  ${n++}. agile sync            # 拉取外部仓库 + 模板缓存 + 插件`));
          console.log(ui.dim(`  ${n++}. agile template list   # 查看项目模板`));
          console.log(ui.dim(`  ${n++}. agile plugin install agile  # 安装 Claude Code 插件`));
        },
      ),
  )
  .addCommand(
    new Command('project')
      .description('初始化项目到 projects/ 下（workspace 单仓内普通目录）：--template 从单例模板或组合模板脚手架（组合模板一次生成多个平铺成员项目），缺省为空项目骨架')
      .argument('[name...]', '（已废弃）原项目名位置参数——2.4.0 起目录命名统一用 --name')
      .option('--template <template>', '单例模板名或组合模板名（agile template list 查看；缺省创建空项目骨架，不访问模板注册中心）')
      .option(
        '--name <name>',
        '项目目录名（可重复）。单例模板 / 空项目骨架：--name <目录名>；组合模板：--name <组合项目名称>=<目录名>。缺省：单例用单例项目名称（模板名），组合用各成员的组合项目名称',
        collectName,
        [] as string[],
      )
      .action(async (legacy: string[], opts: { template?: string; name: string[] }) => {
        // 位置参数已废弃（2.4.0）：显式给迁移指引而非 commander 语法错误
        if (legacy.length > 0) {
          throw new AgileError(
            `init project 的位置参数已废弃（2.4.0）：${legacy.join(' ')}。目录命名统一用 --name：\n` +
              '  空项目骨架：agile init project --name <目录名>\n' +
              '  单例模板：  agile init project --template <模板名> [--name <目录名>]\n' +
              '  组合模板：  agile init project --template <组合名> [--name <组合项目名称>=<目录名>]...',
          );
        }
        const root = requireWorkspaceRoot();
        const settings = await loadSettings(root);

        if (opts.template === undefined) {
          // 空项目骨架：--name 裸值必填；不依赖模板注册中心（不联网、不读缓存）
          const dirName = parseBareName(opts.name, '空项目骨架', true);
          const repoPath = `${settings.paths.projects}/${dirName}`;
          const abs = path.join(root, repoPath);
          if (await exists(abs)) {
            // 已存在的空目录放行生成（与模板路径的空目录语义一致）；非空才拒绝
            if ((await fs.readdir(abs)).length > 0) {
              throw new AgileError(`目录已存在：${repoPath}`);
            }
          }
          await scaffoldEmptyProject(abs, dirName);
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

        // 2a. 单例模板：生成到 projects/<目录名>/（目录名 = --name 裸值 ?? 单例项目名称；
        //     {{name}} = 实际落地目录名，生成清单 member = 单例项目名称；重跑防护在 core，按生成清单判定）
        if (tplRegistry.singles.some((t) => t.name === opts.template)) {
          const dirName = parseBareName(opts.name, '单例模板', false) ?? opts.template;
          const targetRel = `${settings.paths.projects}/${dirName}`;
          const targetAbs = path.join(root, targetRel);
          await fs.mkdir(path.dirname(targetAbs), { recursive: true });
          const result = await scaffoldFromTemplate(repoDir, opts.template, targetAbs, tplRegistry, {
            workspaceRoot: root,
          });
          printCopyNotices(result.notices);
          await git(root, ['add', targetRel]);
          // 生成清单入库：重跑的完整性校验依赖它，随项目一起走 PR（清单文件名 = 实际落地目录名）
          const manifestFile = `.agile/manifests/${dirName}.json`;
          if (await exists(path.join(root, manifestFile))) {
            await git(root, ['add', manifestFile]);
          }
          console.log(ui.ok(`项目初始化完成：${targetRel}（template=${opts.template}）`));
          console.log(ui.dim('已 git add，commit 时机由你决定；提交后与 workspace 其余变更一起走一个 PR。'));
          return;
        }

        // 2b. 组合模板：--name 键值（组合项目名称=目录名，可重复）覆盖成员目录名；缺省 = 各成员用组合项目名称。
        //     成员项目平铺落盘 projects/<成员目录名>/（成员 = 组合专属模板目录 solutions/<组合>/<成员>/；{{name}} = 实际目录名）
        const solutionEntry = tplRegistry.solutions.find((s) => s.name === opts.template);
        if (solutionEntry === undefined) {
          const templates = tplRegistry.singles.map((t) => t.name).join('、') || '（无）';
          const solutions = tplRegistry.solutions.map((s) => s.name);
          throw new AgileError(
            `模板不存在：${opts.template}。可用单例模板：${templates}${
              solutions.length > 0 ? `\n可用组合模板：${solutions.join('、')}` : ''
            }`,
          );
        }
        const overrides = parseSolutionNameOverrides(opts.name);
        const result: SolutionScaffoldResult = await scaffoldSolution(
          repoDir,
          tplRegistry,
          opts.template,
          path.join(root, settings.paths.projects),
          overrides,
          { workspaceRoot: root },
        );

        // 3. 纳入 workspace 仓库版本管理（只 add，不自动 commit；逐成员 add 生成的目录与对应生成清单）
        for (const d of result.created) {
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

        console.log(ui.ok(`组合 ${opts.template} 初始化完成（成员平铺于 ${settings.paths.projects}/）：`));
        for (const d of result.created) console.log(ui.ok(`  + ${settings.paths.projects}/${d}`));
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
