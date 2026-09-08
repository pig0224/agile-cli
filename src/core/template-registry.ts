import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { git, gitTry } from './git.js';
import { AgileError } from './errors.js';
import { parseJson } from './config.js';
import {
  PROJECT_NAME_RE,
  copyAndSubstitute,
  safePackageSegment,
  type CopyNotice,
  type CopyResult,
} from './scaffold.js';
import {
  compareFiles,
  deleteProjectManifest,
  listActualFiles,
  readProjectManifest,
  writeProjectManifest,
} from './manifest.js';
import { templateCacheRoot } from './paths.js';
import { cliVersion } from '../version.js';

/** 名字规范（单例模板名/组合名/成员项目名通用）：小写字母开头，仅小写字母/数字/连字符（防冲突的第一道防线） */
export const TEMPLATE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** 标签数组（language/framework）：字符串数组（如 ["TypeScript"]、["Vue","Vite"]）；给出时不得为空 */
const TagsSchema = z.array(z.string().trim().min(1)).min(1).optional();

/** 单例模板条目（registry.json 的 singles 数组项）；组合的成员项目（projects）复用同一形状。
 *  目录由约定派生（单例 = singles/<name>/，成员 = solutions/<组合>/<name>/），没有 path 字段 */
export const SingleEntrySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  language: TagsSchema,
  framework: TagsSchema,
});

/** 组合模板条目（registry.json 的 solutions 数组项）：projects = 成员项目数组，数组顺序 = 生成/展示顺序 */
export const SolutionEntrySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  projects: z.array(SingleEntrySchema).min(1),
});

export const TemplateRegistrySchema = z.object({
  /** 显式格式版本：宽进（number.int）以支持 loadTemplates 的友好版本门禁（仅支持 v2，高于/低于均给升级出路） */
  version: z.number().int(),
  singles: z.array(SingleEntrySchema).default([]),
  /** 组合模板（多项目系统）：技术栈模板之上的声明式组合层；缺省无组合 */
  solutions: z.array(SolutionEntrySchema).default([]),
});

export type SingleEntry = z.infer<typeof SingleEntrySchema>;
export type SolutionEntry = z.infer<typeof SolutionEntrySchema>;
export type TemplateRegistry = z.infer<typeof TemplateRegistrySchema>;

/** template list 组合段的展示行（core 返回结构化数据；缩进/装饰前缀与着色由命令层拼接） */
export interface SolutionListRow {
  kind: 'solution' | 'member';
  /** 已按列宽 padEnd 的纯文本名（solution 行 = 18 列与单例段同宽起头；member 行 = 段内成员名最大宽 + 4 间距） */
  name: string;
  description: string;
}

/**
 * 组合段行布局：每个组合展开为一行 solution + 依 projects 数组顺序的成员行（= 生成顺序，不排序）。
 * 成员行对齐宽 = 段内全部成员名的最大长度 + 4 间距（对齐只看 name 段，不受 description 长度/中英混排影响）；
 * 装饰一律 ASCII（命令层用 "    - " 前缀），不用 box-drawing 字符（Windows GBK 控制台会乱码）。
 */
export function solutionListRows(solutions: SolutionEntry[]): SolutionListRow[] {
  const width =
    Math.max(0, ...solutions.flatMap((s) => s.projects.map((p) => p.name.length))) + 4;
  const rows: SolutionListRow[] = [];
  for (const s of solutions) {
    rows.push({ kind: 'solution', name: s.name.padEnd(18), description: s.description });
    for (const p of s.projects) {
      rows.push({ kind: 'member', name: p.name.padEnd(width), description: p.description });
    }
  }
  return rows;
}

export interface LoadedTemplates {
  registry: TemplateRegistry;
  repoDir: string;
  /** 校验发现的问题（name/目录不一致等），list 命令展示，init project 视为致命 */
  issues: string[];
  /** 失联时降级使用的陈旧缓存 */
  stale: boolean;
}

/** 模板仓库缓存目录：~/.agile/templates/<url 哈希>（跨 workspace 共享） */
export function templateCacheDir(url: string): string {
  const slug = url
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-40)
    .toLowerCase();
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
  return path.join(templateCacheRoot(), `${slug}-${hash}`);
}

/**
 * 确保模板仓库在本地缓存可用：
 * - 无缓存 → git clone --depth 1
 * - 有缓存且 refresh=true → git fetch + reset --hard origin/HEAD（缓存是纯只读副本，强重置安全）
 * - 有缓存且未要求刷新 → 直接用缓存（默认行为：不联网）
 * - refresh=true 但 fetch 失败 → 降级用缓存（stale=true）
 */
export async function ensureTemplateRepo(
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<{ repoDir: string; stale: boolean }> {
  const dir = templateCacheDir(url);
  const hasCache = await fs
    .stat(path.join(dir, '.git'))
    .then(() => true)
    .catch(() => false);

  if (!hasCache) {
    await fs.mkdir(dir, { recursive: true });
    const clone = await gitTry(dir, ['-c', 'protocol.file.allow=always', 'clone', '--depth', '1', url, '.']);
    if (!clone.ok) {
      // 半成品缓存目录必须清掉：残留的非空内容会让该源此后 clone 进非空目录，永远失败且无出路
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw new AgileError(
        `模板仓库克隆失败（${url}）：${clone.stderr.split('\n')[0] ?? '未知错误'}（已清理半成品缓存，可重试）`,
      );
    }
    return { repoDir: dir, stale: false };
  }

  if (opts.refresh !== true) {
    // 默认走缓存：不联网
    return { repoDir: dir, stale: false };
  }

  const pull = await gitTry(dir, ['-c', 'protocol.file.allow=always', 'fetch', 'origin']);
  if (pull.ok) {
    // reset 到 origin/<当前分支> 而非 FETCH_HEAD：远端默认分支改名/切换时 FETCH_HEAD 会把缓存内容换成别的分支
    const br = await gitTry(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = br.ok && br.stdout && br.stdout !== 'HEAD' ? br.stdout : null;
    await git(dir, ['reset', '--hard', branch ? `origin/${branch}` : 'FETCH_HEAD']);
    return { repoDir: dir, stale: false };
  }
  // 刷新失败：降级使用缓存
  return { repoDir: dir, stale: true };
}

/**
 * 校验模板注册中心一致性（防冲突核心；目录由约定派生，无 path 字段）：
 * 1. 名字规范：单例模板名/组合名/成员项目名 ^[a-z][a-z0-9-]*$；登记名 = 目录名（一目录一身份）
 * 2. 登记唯一：singles / solutions / 同组合 projects 数组内 name 不得重复（JSON 数组无键唯一性保证，须显式校验）
 * 3. 目录存在：单例 = singles/<name>/，成员项目 = solutions/<组合>/<name>/（组合专属完整模板骨架）
 * 4. 三段全局唯一：模板名/组合名/成员项目名互不重名——init 后全部平铺落盘 projects/，同一命名空间
 * 5. 双向一致：singles/ 下实际目录必须全部登记进 registry 的 singles（防幽灵单例目录）；
 *    solutions/<组合>/ 下子目录必须全部登记进该组合的 projects（防幽灵成员目录）；
 *    docs/ 豁免（组合根耦合资产目录：CLAUDE.md + docs/ 归总跨成员约定与规范，init 时带出到 .agile/solutions/<组合>/）
 */
export async function validateTemplateRepo(
  repoDir: string,
  registry: TemplateRegistry,
): Promise<string[]> {
  const issues: string[] = [];
  const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory()).catch(() => false);

  // 单例模板：名字规范 + 数组内唯一 + 目录存在（singles/<name>/）
  const singleNames = new Set<string>();
  for (const entry of registry.singles) {
    if (!TEMPLATE_NAME_RE.test(entry.name)) {
      issues.push(`单例模板名 "${entry.name}" 不符合规范 ^[a-z][a-z0-9-]*$`);
      continue;
    }
    if (singleNames.has(entry.name)) {
      issues.push(`单例模板 "${entry.name}" 重复登记（singles 数组内 name 必须唯一）`);
      continue;
    }
    singleNames.add(entry.name);
    if (!(await isDir(path.join(repoDir, 'singles', entry.name)))) {
      issues.push(`单例模板 ${entry.name} 的目录不存在：singles/${entry.name}/`);
    }
  }

  // 反向一致性：singles/ 下的目录必须全部登记（防幽灵单例目录——目录存在但未登记时
  // 会被静默忽略：template list 看不见、init 用不了，维护者还以为模板已生效）。
  // 反向比对用「全部登记名」（含不合法名）：不合法名已有专属 issue，不在这里重复报
  const declaredSingles = new Set(registry.singles.map((e) => e.name));
  const singlesDir = path.join(repoDir, 'singles');
  if (await isDir(singlesDir)) {
    for (const ent of await fs.readdir(singlesDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      if (!declaredSingles.has(ent.name)) {
        issues.push(`目录 singles/${ent.name}/ 未登记进 registry.json 的 singles（登记与目录须双向一致）`);
      }
    }
  }

  // 组合名全集（成员项目 vs 全部组合名的冲突校验需要全集，先收集）
  const solutionNames = new Set<string>();
  for (const solution of registry.solutions) {
    if (TEMPLATE_NAME_RE.test(solution.name)) solutionNames.add(solution.name);
  }

  // 组合模板：名字规范/唯一 + 成员项目校验 + 三段全局唯一
  const seenSolutions = new Set<string>();
  const projectOwner = new Map<string, string>(); // 成员项目名 → 归属组合（全局唯一命名空间）
  for (const solution of registry.solutions) {
    if (!TEMPLATE_NAME_RE.test(solution.name)) {
      issues.push(`组合模板名 "${solution.name}" 不符合规范 ^[a-z][a-z0-9-]*$`);
      continue;
    }
    if (seenSolutions.has(solution.name)) {
      issues.push(`组合模板 "${solution.name}" 重复登记（solutions 数组内 name 必须唯一）`);
      continue;
    }
    seenSolutions.add(solution.name);
    if (singleNames.has(solution.name)) {
      issues.push(`组合模板 "${solution.name}" 与单例模板重名（组合与模板必须可区分）`);
    }
    const projOwner = projectOwner.get(solution.name);
    if (projOwner) {
      issues.push(`组合模板名 "${solution.name}" 与组合 ${projOwner} 的成员项目名冲突（三段全局唯一）`);
    }

    const declared = new Set<string>();
    for (const project of solution.projects) {
      if (!TEMPLATE_NAME_RE.test(project.name)) {
        issues.push(
          `组合模板 ${solution.name} 的成员项目名 "${project.name}" 不合法（须满足 ^[a-z][a-z0-9-]*$）`,
        );
        continue;
      }
      if (declared.has(project.name)) {
        issues.push(
          `组合模板 ${solution.name} 的成员项目 "${project.name}" 重复登记（projects 数组内 name 必须唯一）`,
        );
        continue;
      }
      declared.add(project.name);

      // 成员项目目录必须实际存在（成员 = 组合专属完整模板骨架，solutions/<组合>/<成员>/）
      if (!(await isDir(path.join(repoDir, 'solutions', solution.name, project.name)))) {
        issues.push(
          `组合模板 ${solution.name} 的成员项目目录不存在：solutions/${solution.name}/${project.name}/（成员是组合专属模板目录，须实际存在）`,
        );
      }

      // 三段全局唯一：成员项目平铺落盘 projects/ 后直接占用顶层命名，与模板/组合/其他成员同空间
      if (singleNames.has(project.name)) {
        issues.push(
          `组合模板 ${solution.name} 的成员项目名 "${project.name}" 与单例模板名冲突（成员平铺落盘 projects/ 会抢占目录名，必须全局唯一）`,
        );
      } else if (solutionNames.has(project.name)) {
        issues.push(
          `组合模板 ${solution.name} 的成员项目名 "${project.name}" 与组合模板名冲突（必须全局唯一）`,
        );
      } else {
        const owner = projectOwner.get(project.name);
        if (owner) {
          issues.push(
            `组合模板 ${solution.name} 的成员项目名 "${project.name}" 与组合 ${owner} 的成员项目名冲突（必须全局唯一）`,
          );
        } else {
          projectOwner.set(project.name, solution.name);
        }
      }
    }

    // 反向一致性：solutions/<组合>/ 下的子目录必须全部登记进 projects（防幽灵成员目录）；
    // docs/ 豁免——组合根耦合资产目录（CLAUDE.md + docs/ 归总跨成员约定与规范），不是成员项目
    const solDir = path.join(repoDir, 'solutions', solution.name);
    if (await isDir(solDir)) {
      for (const ent of await fs.readdir(solDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name === 'docs') continue;
        if (!declared.has(ent.name)) {
          issues.push(
            `目录 solutions/${solution.name}/${ent.name}/ 未登记进组合 ${solution.name} 的 projects（登记与成员目录须双向一致）`,
          );
        }
      }
    }
  }
  return issues;
}

/** registry 版本不符的门禁文案（给未来 v3 一条通用出路：明确最低版本 + 升级命令） */
function registryVersionError(actual: number): AgileError {
  return new AgileError(
    `模板注册中心为 v${actual} 布局，当前 CLI ${cliVersion} 仅支持 v2。请升级：npm i -g fcc-agile-cli`,
  );
}

/** 加载模板注册中心（ensureRepo + 解析 + 校验） */
export async function loadTemplates(
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<LoadedTemplates> {
  // 本地目录直读模式：url 是一个已存在且含 registry.json 的目录（如 monorepo 内
  // 的模板源、CI checkout 的仓库子目录）——直接使用，不走缓存与 clone。
  const directDir = path.resolve(url);
  const direct = await fs
    .stat(path.join(directDir, 'registry.json'))
    .then(() => true)
    .catch(() => false);

  const { repoDir, stale } = direct
    ? { repoDir: directDir, stale: false }
    : await ensureTemplateRepo(url, opts);

  const file = path.join(repoDir, 'registry.json');
  const content = await fs.readFile(file, 'utf8').catch(() => null);
  if (content == null) {
    throw new AgileError(`模板仓库 ${url} 缺少 registry.json${stale ? '（当前为离线缓存副本）' : ''}`);
  }
  let registry: TemplateRegistry;
  try {
    registry = parseJson(content, TemplateRegistrySchema, 'registry.json');
  } catch (e) {
    // 解析/校验失败统一附当前版本与升级命令——registry 若来自更新布局的模板源，旧 CLI 不再只报难懂的校验噪音
    throw new AgileError(
      `${(e as Error).message}\n（当前 CLI ${cliVersion}；若模板源为更新布局，请升级：npm i -g fcc-agile-cli）`,
    );
  }
  if (registry.version !== 2) {
    throw registryVersionError(registry.version);
  }
  const issues = await validateTemplateRepo(repoDir, registry);
  return { registry, repoDir, issues, stale };
}

/**
 * 删除模板仓库的本地缓存副本（下次使用自动重新克隆）。
 * 返回是否实际删除（无缓存时 false）。本地目录直读模式无缓存，恒返回 false。
 */
export async function cleanTemplateCache(url: string): Promise<boolean> {
  const dir = templateCacheDir(url);
  const hasCache = await fs
    .stat(path.join(dir, '.git'))
    .then(() => true)
    .catch(() => false);
  if (!hasCache) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

/** 清理全部模板缓存（~/.agile/templates 下所有源副本），返回清理的缓存数 */
export async function cleanAllTemplateCaches(): Promise<number> {
  const root = templateCacheRoot();
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  let cleaned = 0;
  for (const entry of entries) {
    const p = path.join(root, entry);
    if (await fs.stat(p).then((s) => s.isDirectory()).catch(() => false)) {
      await fs.rm(p, { recursive: true, force: true });
      cleaned++;
    }
  }
  return cleaned;
}

/** 生成清单行为选项。workspaceRoot 提供时启用生成清单能力
 *  （.agile/manifests/ 写入与重跑完整性校验）；缺省只保留事务性生成（不留残缺）。 */
export interface ScaffoldManifestOptions {
  workspaceRoot?: string;
}

/** scaffoldFromTemplate 的结果（core 不打印，命令层负责输出） */
export interface ScaffoldFromTemplateResult {
  /** 复制忽略通知（产物/符号链接/锁文件） */
  notices: CopyNotice[];
}

function templateCommitOf(repoDir: string): Promise<string | null> {
  return gitTry(repoDir, ['rev-parse', 'HEAD']).then((r) => (r.ok ? r.stdout : null));
}

/** 清单比对不一致：硬错误（疑似上次生成残留），提示删除重跑 */
function mismatchError(displayPath: string, missing: string[], extra: string[]): AgileError {
  return new AgileError(
    `${displayPath} 与生成清单不符（缺 ${missing.length} 文件 / 多 ${extra.length} 项），疑似上次生成残留；请删除该目录后重跑`,
  );
}

/**
 * 事务性生成：先复制到同卷临时目录 projects/.tmp-<目录名>-<rand>，成功后原子替换目标。
 * 任一步失败（含清单写盘）→ 回滚本次替换的目标与清单、清除临时目录——目标目录永不残留半成品。
 * 开始前清扫上次硬崩溃可能残留的 .tmp-<目录名>-* 目录。
 */
async function generateWithTransaction(
  repoDir: string,
  src: string,
  target: string,
  vars: Record<string, string>,
  opts: {
    workspaceRoot?: string;
    dirName: string;
    manifestBase: { source: string; member?: string };
    rebuild: boolean;
  },
): Promise<CopyResult> {
  const projectsRoot = path.dirname(target);
  for (const ent of await fs.readdir(projectsRoot).catch(() => [] as string[])) {
    if (ent.startsWith(`.tmp-${opts.dirName}-`)) {
      await fs.rm(path.join(projectsRoot, ent), { recursive: true, force: true }).catch(() => {});
    }
  }
  const tmp = path.join(projectsRoot, `.tmp-${opts.dirName}-${crypto.randomBytes(4).toString('hex')}`);
  let renamed = false;
  try {
    const result = await copyAndSubstitute(src, tmp, vars);
    if (opts.rebuild) await fs.rm(target, { recursive: true, force: true });
    await fs.rename(tmp, target);
    renamed = true;
    if (opts.workspaceRoot) {
      await writeProjectManifest(opts.workspaceRoot, {
        version: 1,
        source: opts.manifestBase.source,
        ...(opts.manifestBase.member !== undefined ? { member: opts.manifestBase.member } : {}),
        dirName: opts.dirName,
        files: result.files,
        generatedAt: new Date().toISOString(),
        templateCommit: await templateCommitOf(repoDir),
      });
    }
    return result;
  } catch (e) {
    if (renamed) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      if (opts.workspaceRoot) {
        await deleteProjectManifest(opts.workspaceRoot, opts.dirName).catch(() => {});
      }
    }
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** 从单例模板生成项目骨架到 target（占位符替换）；模板目录 = singles/<模板名>/（约定派生，无 path 字段）。
 *  templateName = 单例项目名称（写入生成清单 member）；target = 实际落盘目录
 *  （缺省 projects/<模板名>/，命令层可经 --name <目录名> 覆盖）。{{name}} 恒等于实际落地目录名。
 *  target 已存在且非空 → 「目录已存在」（有本 CLI 生成清单时先做完整性校验，不符硬错误提示删除重跑）；
 *  空目录放行（2.1.0 兼容）。提供 workspaceRoot 时写生成清单，供重跑校验。 */
export async function scaffoldFromTemplate(
  repoDir: string,
  templateName: string,
  target: string,
  registry: TemplateRegistry,
  opts: ScaffoldManifestOptions = {},
): Promise<ScaffoldFromTemplateResult> {
  if (!registry.singles.some((t) => t.name === templateName)) {
    throw new AgileError(`模板不存在：${templateName}（agile template list 查看可用模板）`);
  }
  if (!TEMPLATE_NAME_RE.test(templateName)) {
    throw new AgileError(`模板名不合法：${templateName}`);
  }
  const show = (t: string) =>
    path.relative(path.dirname(path.dirname(target)), t).split(path.sep).join('/');
  const st = await fs.stat(target).catch(() => null);
  let replaceEmpty = false; // 已存在的空目录：放行生成（2.1.0 兼容），落盘前先移除（Windows 不能 rename 覆盖已有目录）
  if (st) {
    if (!st.isDirectory()) {
      throw new AgileError(`路径已存在且不是目录：${show(target)}`);
    }
    if ((await fs.readdir(target)).length > 0) {
      // 清单按实际落地目录名读写（与写入端 dirName 一致）；不得用项目名参数——大小写敏感平台会读不到
      const manifest = opts.workspaceRoot
        ? await readProjectManifest(opts.workspaceRoot, path.basename(target))
        : null;
      if (manifest) {
        const { missing, extra } = compareFiles(manifest.files, await listActualFiles(target));
        if (missing.length > 0 || extra.length > 0) {
          throw mismatchError(show(target), missing, extra);
        }
      }
      throw new AgileError(`目录已存在：${show(target)}`);
    }
    replaceEmpty = true;
  }
  const src = path.join(repoDir, 'singles', templateName);
  const result = await generateWithTransaction(repoDir, src, target, {
    '{{name}}': path.basename(target),
    '{{safeName}}': safePackageSegment(path.basename(target)),
  }, {
    workspaceRoot: opts.workspaceRoot,
    dirName: path.basename(target),
    manifestBase: { source: templateName, member: templateName },
    rebuild: replaceEmpty,
  });
  return { notices: result.notices };
}

/** scaffoldSolution 的结果（core 不打印，命令层负责输出） */
export interface SolutionScaffoldResult {
  /** 本次实际生成的成员目录名（相对 projects/） */
  created: string[];
  /** 已存在而跳过的成员目录名（补缺语义：组合定义演进后再次 init 只补缺失成员） */
  skipped: string[];
  /** 复制忽略通知（path 带 <成员目录名>/ 前缀，跨成员聚合），由命令层负责输出 */
  notices: CopyNotice[];
  /** 组合根耦合资产带出结果；null = 未启用清单能力（无 workspaceRoot）。
   *  present = 模板组合根带有实际可复制的耦合资产内容（非符号链接；本次复制或既有快照 ≥1 文件）；
   *  copied = 本次是否实际复制了内容（files > 0；快照已存在或组合根无实内容均 false）。 */
  comboAssets: { present: boolean; copied: boolean; files: number } | null;
}

/**
 * 组合根耦合资产带出：把 solutions/<组合>/CLAUDE.md 与 docs/（归总的跨成员约定与规范）复制到
 * workspace 的 .agile/solutions/<组合>/，供 /agile:knowledge 按资产类型同步到
 * biz-tech-docs / biz-product-docs。组合平铺生成不落系统目录，workspace 需要一份可定位的耦合资产快照。
 * 快照语义：目标已存在则整体跳过不覆盖（补缺/重跑不冲掉人工改动，含知识同步后的本地演进）；
 * 无耦合资产的组合（旧版模板）静默跳过。vars 为空 = 不做 {{name}} 占位替换（组合级资产与具体落盘目录名无关）。
 * 复制中途失败清除目标目录（调用方的事务回滚随后回滚成员，不留残缺）。
 */
async function syncComboAssets(
  repoDir: string,
  solutionName: string,
  workspaceRoot: string,
): Promise<{ present: boolean; copied: boolean; files: number; notices: CopyNotice[] }> {
  const solDir = path.join(repoDir, 'solutions', solutionName);
  const dest = path.join(workspaceRoot, '.agile', 'solutions', solutionName);
  const lstat = (p: string) => fs.lstat(p).catch(() => null);

  // 只认组合根的 CLAUDE.md 与 docs/ 两个路径；符号链接一律不复制并通知（与成员复制同语义）
  const notices: CopyNotice[] = [];
  const pieces: Array<{ kind: 'file' | 'dir'; src: string; dest: string; rel: string }> = [];
  const cm = await lstat(path.join(solDir, 'CLAUDE.md'));
  if (cm?.isSymbolicLink()) {
    notices.push({ path: `solutions/${solutionName}/CLAUDE.md`, reason: 'symlink' });
  } else if (cm?.isFile()) {
    pieces.push({ kind: 'file', src: path.join(solDir, 'CLAUDE.md'), dest: path.join(dest, 'CLAUDE.md'), rel: `solutions/${solutionName}/CLAUDE.md` });
  }
  const docs = await lstat(path.join(solDir, 'docs'));
  if (docs?.isSymbolicLink()) {
    notices.push({ path: `solutions/${solutionName}/docs/`, reason: 'symlink' });
  } else if (docs?.isDirectory()) {
    pieces.push({ kind: 'dir', src: path.join(solDir, 'docs'), dest: path.join(dest, 'docs'), rel: `solutions/${solutionName}/docs/` });
  }
  if (pieces.length === 0) return { present: false, copied: false, files: 0, notices };
  if (await lstat(dest)) return { present: true, copied: false, files: 0, notices }; // 快照已存在：跳过不覆盖

  let files = 0;
  await fs.mkdir(dest, { recursive: true });
  try {
    for (const p of pieces) {
      if (p.kind === 'file') {
        // CLAUDE.md 单文件直复制（copyAndSubstitute 只收目录）
        await fs.copyFile(p.src, p.dest);
        files++;
      } else {
        const r = await copyAndSubstitute(p.src, p.dest, {});
        files += r.files.length;
        for (const n of r.notices) notices.push({ ...n, path: `${p.rel}${n.path}` });
      }
    }
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
  if (files === 0) {
    // 组合根资产实际无内容（如 docs/ 只有空子目录）：清掉刚建的空快照目录，不视为已带出——
    // 否则命令层会输出「快照已存在」而磁盘上什么都没有
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    return { present: false, copied: false, files: 0, notices };
  }
  return { present: true, copied: true, files, notices };
}

/**
 * 从组合模板平铺生成成员项目到 projectsRoot：
 * projects/<成员目录名>/（成员目录名 = overrides[成员名] ?? 成员名，与模板/组合同命名空间、全局唯一）。
 * 成员骨架 = 仓库内 solutions/<组合名>/<成员名>/（组合专属完整模板，不引用 singles）；
 * 成员项目 {{name}} = 实际落地目录名（包名唯一性由 projects/ 平铺目录名天然保证）。
 * 已存在的成员目录：非空一律跳过 + warn——有本 CLI 生成清单时先做完整性校验（不符硬错误，
 * 疑似上次生成残留，须删除重跑；一致 = 补缺语义，组合定义演进后可后补成员）；
 * 无清单（陌生目录，含用户手写项目）→ 向后兼容跳过。空目录放行生成（与单例 2.1.0 兼容语义一致）。
 * 生成走同卷临时目录 + 原子替换；任一成员失败回滚本次运行新建的成员，不留残缺。
 * 全部成员成功后把组合根耦合资产（CLAUDE.md + docs/）快照到 .agile/solutions/<组合名>/（带出失败随整体回滚）。
 */
export async function scaffoldSolution(
  repoDir: string,
  registry: TemplateRegistry,
  solutionName: string,
  projectsRoot: string,
  overrides: Record<string, string> = {},
  opts: ScaffoldManifestOptions = {},
): Promise<SolutionScaffoldResult> {
  const solution = registry.solutions.find((s) => s.name === solutionName);
  if (!solution) {
    throw new AgileError(`组合模板不存在：${solutionName}（agile template list 查看可用组合）`);
  }

  // 覆盖名校验：未知成员 / 目录名不合法 / 有效目录名相互冲突
  const memberNames = new Set(solution.projects.map((p) => p.name));
  for (const [from, to] of Object.entries(overrides)) {
    if (!memberNames.has(from)) {
      throw new AgileError(
        `--name 引用了组合中不存在的成员：${from}（可用成员：${[...memberNames].join('、') || '（无）'}）`,
      );
    }
    if (!PROJECT_NAME_RE.test(to)) {
      throw new AgileError(`成员 ${from} 的目录名不合法（格式 ^[a-z][a-z0-9-]*$）：${to}`);
    }
  }
  const effective = new Map(
    solution.projects.map((p) => [p.name, overrides[p.name] ?? p.name] as const),
  );
  const dirOwner = new Map<string, string>();
  for (const [mName, dir] of effective) {
    const owner = dirOwner.get(dir);
    if (owner) {
      throw new AgileError(`成员目录名冲突：${owner} 与 ${mName} 都映射到 ${dir}`);
    }
    dirOwner.set(dir, mName);
  }

  const displayBase = path.dirname(projectsRoot);
  const show = (t: string) => path.relative(displayBase, t).split(path.sep).join('/');

  const created: string[] = [];
  const skipped: string[] = [];
  const notices: CopyNotice[] = [];
  const createdThisRun: string[] = []; // 回滚登记：仅本次运行替换落盘的成员
  let comboAssets: SolutionScaffoldResult['comboAssets'] = null;
  try {
    for (const project of solution.projects) {
      const dir = effective.get(project.name)!;
      const target = path.join(projectsRoot, dir);
      const st = await fs.stat(target).catch(() => null);
      let replaceEmpty = false;
      if (st) {
        if (!st.isDirectory()) {
          throw new AgileError(`路径已存在且不是目录：${show(target)}（请人工处理后重跑）`);
        }
        if ((await fs.readdir(target)).length === 0) {
          // 空目录：放行生成（与单例 2.1.0 兼容语义一致），落盘前先移除（Windows 不能 rename 覆盖已有目录）
          replaceEmpty = true;
        } else {
          // 非空目录：有本 CLI 清单先校验完整性（不符硬错误）；一致（补缺跳过）或无清单（陌生目录）均维持跳过
          const manifest = opts.workspaceRoot ? await readProjectManifest(opts.workspaceRoot, dir) : null;
          if (manifest) {
            const { missing, extra } = compareFiles(manifest.files, await listActualFiles(target));
            if (missing.length > 0 || extra.length > 0) {
              throw mismatchError(show(target), missing, extra);
            }
          }
          skipped.push(dir);
          continue;
        }
      }
      // 成员骨架 = solutions/<组合>/<成员>/（组合专属完整模板）
      const src = path.join(repoDir, 'solutions', solutionName, project.name);
      if (!(await fs.stat(src).then((s) => s.isDirectory()).catch(() => false))) {
        throw new AgileError(
          `组合模板 ${solutionName} 的成员目录不存在：solutions/${solutionName}/${project.name}/`,
        );
      }
      const memberResult = await generateWithTransaction(repoDir, src, target, {
        '{{name}}': dir,
        '{{safeName}}': safePackageSegment(dir),
      }, {
        workspaceRoot: opts.workspaceRoot,
        dirName: dir,
        manifestBase: { source: solutionName, member: project.name },
        rebuild: replaceEmpty,
      });
      // 通知 path 加成员目录前缀（组合平铺生成，warn 需定位到成员）
      for (const n of memberResult.notices) notices.push({ ...n, path: `${dir}/${n.path}` });
      createdThisRun.push(dir);
      created.push(dir);
    }

    // 组合根耦合资产带出（全部成员成功后；失败抛错随上面的回滚一起不留残缺）
    if (opts.workspaceRoot) {
      const combo = await syncComboAssets(repoDir, solutionName, opts.workspaceRoot);
      comboAssets = { present: combo.present, copied: combo.copied, files: combo.files };
      for (const n of combo.notices) notices.push(n);
    }
  } catch (e) {
    // 事务回滚：本次运行新建的成员连同清单一并移除，之前已存在被跳过的不动，不留残缺
    for (const d of createdThisRun) {
      await fs.rm(path.join(projectsRoot, d), { recursive: true, force: true }).catch(() => {});
      if (opts.workspaceRoot) await deleteProjectManifest(opts.workspaceRoot, d).catch(() => {});
    }
    throw e;
  }

  return { created, skipped, notices, comboAssets };
}
