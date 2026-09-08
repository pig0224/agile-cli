import fs from 'node:fs/promises';
import path from 'node:path';

/** java 包名安全段：小写字母数字，非法字符折叠 */
export function safePackageSegment(name: string): string {
  const seg = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return seg.length > 0 ? seg : 'app';
}

/** 项目名规范：小写字母开头，仅小写字母/数字/连字符。
 *  项目名同时用作 projects/ 目录名与模板 {{name}} 占位（npm name / go module / 包名等），
 *  必须在这些位置都合法；同时杜绝路径穿越（/ \ .. 等）。 */
export const PROJECT_NAME_RE = /^[a-z][a-z0-9-]*$/;

const TEXT_EXT = new Set([
  '.json', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue',
  '.html', '.htm', '.md', '.css', '.scss', '.less', '.ejs', '.hbs', '.pug',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.properties',
  '.mod', '.go', '.java', '.gradle', '.kt', '.kts', '.py', '.sql',
  '.sh', '.bash', '.bat', '.cmd', '.ps1', '.proto',
]);

/** 复制忽略通知：path 相对模板根（统一 / 分隔）；
 *  reason = artifact（安装/构建产物，整树跳过）| symlink（符号链接/junction，不 follow）| lockfile（锁文件） */
export interface CopyNotice {
  path: string;
  reason: 'artifact' | 'symlink' | 'lockfile';
}

export interface CopyOptions {
  /** 保留锁文件的复制语义（默认 false：三种锁文件跳过并通知——模板仓通常不随锁分发） */
  keepLockfiles?: boolean;
}

/** 复制时整树/整文件跳过的安装与构建产物（名字精确匹配，目录与文件均适用） */
export const ARTIFACT_NAMES = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo', '.vitest',
  '.DS_Store', 'Thumbs.db',
]);

/** 锁文件：默认跳过（CopyOptions.keepLockfiles 可保留复制语义） */
const LOCKFILE_NAMES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);

/** 模板复制结果：notices = 忽略通知；files = 已复制文件的相对路径清单（替换后的落地路径，/ 分隔，供生成清单记录） */
export interface CopyResult {
  notices: CopyNotice[];
  files: string[];
}

/** 将模板目录复制到 target，并做 {{name}} / {{safeName}} 占位替换（文本文件与目录名）。
 *  忽略安装/构建产物与锁文件；符号链接/junction 一律不 follow、不复制——
 *  防止把链接目标当文件 readFile（junction 指向目录时抛 EISDIR）或静默复制产物污染生成物。
 *  返回被忽略条目的通知（每个条目一条，不逐文件展开）与已复制文件清单，由命令层负责输出。 */
export async function copyAndSubstitute(
  src: string,
  dest: string,
  vars: Record<string, string>,
  opts: CopyOptions = {},
): Promise<CopyResult> {
  const notices: CopyNotice[] = [];
  const files: string[] = [];
  await walkCopy(src, dest, vars, opts, '', notices, files);
  files.sort();
  return { notices, files };
}

async function walkCopy(
  src: string,
  dest: string,
  vars: Record<string, string>,
  opts: CopyOptions,
  rel: string,
  notices: CopyNotice[],
  files: string[],
): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    // 一律 lstat 复核形态：不 follow 符号链接/junction（readdir 的 Dirent 形态跨平台不可靠）
    const st = await fs.lstat(s);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (st.isSymbolicLink()) {
      notices.push({ path: relPath, reason: 'symlink' });
      continue;
    }
    if (ARTIFACT_NAMES.has(entry.name)) {
      notices.push({ path: relPath, reason: 'artifact' });
      continue;
    }
    // 目录名中的占位符（如 java 模板的 com/example/{{safeName}}）同样替换
    let name = entry.name;
    for (const [k, v] of Object.entries(vars)) name = name.replaceAll(k, v);
    const d = path.join(dest, name);
    // 落地相对路径（替换后的名字）——生成清单记录的是实际落盘内容
    const relDest = rel ? `${rel}/${name}` : name;
    if (st.isDirectory()) {
      await walkCopy(s, d, vars, opts, relDest, notices, files);
    } else if (st.isFile()) {
      if (!opts.keepLockfiles && LOCKFILE_NAMES.has(entry.name)) {
        notices.push({ path: relPath, reason: 'lockfile' });
        continue;
      }
      const ext = path.extname(entry.name);
      const isText =
        TEXT_EXT.has(ext) || !ext || entry.name === 'Makefile' || entry.name === '.gitignore';
      if (isText) {
        const buf = await fs.readFile(s);
        // 二进制防御：文本判定清单不可能穷尽（且无扩展名文件恒按文本处理）——
        // 含 NUL 字节或 UTF-8 解码出现 U+FFFD 视为二进制，原样复制不替换，防文本重写损坏字节内容
        if (buf.includes(0) || buf.toString('utf8').includes('�')) {
          await fs.copyFile(s, d);
        } else {
          let content = buf.toString('utf8');
          for (const [k, v] of Object.entries(vars)) content = content.replaceAll(k, v);
          await fs.writeFile(d, content, 'utf8');
        }
      } else {
        await fs.copyFile(s, d);
      }
      files.push(relDest);
    } else {
      // 非 dir/file/symlink 的非常规条目（fifo 等）：跳过并通知，不中断复制
      notices.push({ path: relPath, reason: 'artifact' });
    }
  }
}

/** 空项目骨架：仅一个 README（不依赖模板注册中心，`init project` 缺省 --template 时使用） */
export async function scaffoldEmptyProject(dest: string, name: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(
    path.join(dest, 'README.md'),
    `# ${name}\n\n空项目骨架（\`agile init project\` 未指定 --template）。\n后续可用 \`agile init project\` 配合模板迁移，或直接在此按团队规范补充代码与文档。\n`,
    'utf8',
  );
}

/** workspace 根 CLAUDE.md 导航地图内容（`init workspace` 生成；纯函数便于单测）。
 *  定位是「导航」而非文档：五类目录表（按 settings.paths 实际路径）+ 配置/清单指针 + 常用命令
 *  + 根白名单与项目边界（会话层配置只认启动目录，壳层工具选型由团队自决）+ AI 会话须知，
 *  细节指向各抽屉 README 与项目级 CLAUDE.md，避免双份事实源。 */
export function workspaceClaudeMdContent(
  name: string,
  paths: {
    techSpecs: string;
    bizTechDocs: string;
    bizProductDocs: string;
    projects: string;
    processDocs: string;
  },
): string {
  return `# CLAUDE.md — ${name}（agile workspace 导航）

> 本文件由 \`agile init workspace\` 生成，作为 AI 会话的工作区导航地图，随仓库提交（团队共享）。

## 目录导航

| 目录 | 角色 | 版本管理 |
|---|---|---|
| ${paths.techSpecs}/ | 抽屉一：公司级技术规范 | 默认随仓库提交；登记为外部仓库后不入库（sync 管理） |
| ${paths.bizTechDocs}/ | 抽屉二：团队技术设计知识库 | 默认随仓库提交；登记为外部仓库后不入库（sync 管理） |
| ${paths.bizProductDocs}/ | 抽屉三：产品设计知识库（PRD / AC / 功能树） | 随仓库提交 |
| ${paths.projects}/ | 抽屉四：团队项目代码（单例与组合成员平铺） | 随仓库提交 |
| ${paths.processDocs}/ | 抽屉五：需求过程文档（STO-xxx / BUG-xxx / OPS-xxx） | 随仓库提交 |

## 配置与清单

- 唯一配置：\`.agile/settings.json\`（目录路径 / 外部仓库 / 插件依赖 / 模板源）
- 项目生成清单：\`.agile/manifests/<项目目录名>.json\`（重跑防护与出身盘点依据）
- 组合模板耦合资产快照：\`.agile/solutions/<组合名>/\`

## 常用命令

| 命令 | 用途 |
|---|---|
| \`agile sync\` | 拉取外部仓库 + 刷新模板缓存 + 按声明安装插件（幂等） |
| \`agile init project --template <模板> [--name ...]\` | 创建项目（缺省 --template 为空项目骨架） |
| \`agile worktree create / remove <分支>\` | 并行开发环境（前后自动 sync） |
| \`agile plugin install agile\` / \`agile plugin ls\` | 安装 / 查看 Claude Code 插件 |

## 根白名单与项目边界

- 会话层配置只认启动目录：\`.claude/\`（权限白名单 / hooks，人工维护）与 \`.mcp.json\` 放 **workspace 根**；\`${paths.projects}/<项目>/\` 内不创建（子目录中的不被读取）
- 项目工程配置（lint / build / test / 依赖）一律项目内自包含，不提升到根；根上不落栈专属工具配置
- 根上仅允许：本文件、\`.agile/\`、\`.gitignore\` / \`.gitattributes\`、\`.github/\`、\`PRD模板.md\`、${paths.processDocs}/、三类知识库目录（见上表）、${paths.projects}/，以及团队自选的壳层文件（钩子壳 \`.githooks/\` 或 \`.husky/\`、命令分发壳 \`Taskfile.yml\` / \`lefthook.yml\` / \`Makefile\`、配套 \`package.json\`、\`CODEOWNERS\`）——根上用什么钩子/分发工具由团队自决，AI 不预置
- 新增项目接入壳层：按团队自选的钩子与命令分发工具，在根上对应配置里为 \`${paths.projects}/<项目>/\` 各登记一条

## AI 会话须知

- 斜杠命令（/agile:init、/agile:sync-req、/agile:fix-bug 等）来自 agile 插件：\`/agile:help\` 查看全部
- 需求流程遵循 sdd-tdd-method SKILL：无 design.md 不开发；无失败测试不写实现
- 单个项目的技术栈与约定见 \`${paths.projects}/<项目>/CLAUDE.md\`（项目导航）

## FCC-Agile AI 驱动的敏捷工作流

- Agile CLI  [https://github.com/pig0224/agile-cli](https://github.com/pig0224/agile-cli)
- Agile Plugins  [https://github.com/pig0224/agile-plugins](https://github.com/pig0224/agile-plugins)
- Agile Templates  [https://github.com/pig0224/agile-templates](https://github.com/pig0224/agile-templates)
- Agile Docs  [https://github.com/pig0224/agile-docs](https://github.com/pig0224/agile-docs)
`;
}
