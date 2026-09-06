import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { git, gitTry } from './git.js';
import { AgileError } from './errors.js';
import { parseYaml } from './config.js';
import { PROJECT_NAME_RE, copyAndSubstitute, safePackageSegment } from './scaffold.js';
import { templateCacheRoot } from './paths.js';

/** 模板名规范：小写字母开头，仅小写字母/数字/连字符（防冲突的第一道防线） */
export const TEMPLATE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** 解析组合模板 members 平铺字符串（纯成员名清单，如 "backend,frontend"，顺序 = 生成顺序）；非法抛 AgileError（中文报错） */
export function parseSolutionMembers(members: string): string[] {
  const names = members
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new AgileError(
      '组合模板 members 不能为空（成员名清单，逗号分隔，如 "backend, frontend"）',
    );
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (!TEMPLATE_NAME_RE.test(name)) {
      throw new AgileError(`组合模板成员 "${name}" 不合法（成员名须满足 ^[a-z][a-z0-9-]*$）`);
    }
    if (seen.has(name)) {
      throw new AgileError(`组合模板成员名重复：${name}`);
    }
    seen.add(name);
  }
  return names;
}

export const TemplateEntrySchema = z.object({
  description: z.string().default(''),
  language: z.string().optional(),
  framework: z.string().optional(),
  /** 模板目录（相对仓库根）；缺省 ./<name> */
  path: z.string().optional(),
});

export const SolutionEntrySchema = z.object({
  description: z.string().default(''),
  /** 成员名清单平铺字符串（如 "backend,frontend"，顺序 = 生成顺序）。
   *  成员是组合专属模板目录（solutions/<组合>/<成员>/，完整项目骨架），不引用 singles；
   *  用平铺字符串而非结构化 YAML：check.mjs 的手写两层解析器与旧版 CLI（zod strip 未知键）双向兼容 */
  members: z.string(),
});

export const TemplateRegistrySchema = z.object({
  version: z.literal(1),
  templates: z.record(z.string(), TemplateEntrySchema),
  /** 组合模板（多项目系统）：技术栈模板之上的声明式组合层；缺省无组合 */
  solutions: z.record(z.string(), SolutionEntrySchema).default({}),
});

export type TemplateEntry = z.infer<typeof TemplateEntrySchema>;
export type SolutionEntry = z.infer<typeof SolutionEntrySchema>;
export type TemplateRegistry = z.infer<typeof TemplateRegistrySchema>;

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
      throw new AgileError(
        `模板仓库克隆失败（${url}）：${clone.stderr.split('\n')[0] ?? '未知错误'}`,
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
    await git(dir, ['reset', '--hard', 'FETCH_HEAD']);
    return { repoDir: dir, stale: false };
  }
  // 刷新失败：降级使用缓存
  return { repoDir: dir, stale: true };
}

/**
 * 校验模板仓库一致性（防冲突核心）：
 * 1. name 符合规范且唯一（YAML 重复键由 yaml 解析器直接抛错）
 * 2. path 解析为仓库内已存在目录（禁止绝对路径/越界）
 * 3. path 必须为与 name 同名的一级目录：./<name> 或 ./singles/<name>（singles/ 为单例模板分组目录）
 * 4. 同一目录不被多个 name 引用
 * 5. 组合模板（solutions）：组合名规范且全局唯一；members 为纯成员名清单；成员 = 组合专属模板目录
 *    （solutions/<组合>/<成员>/），登记与目录双向一致；成员名全局唯一
 *    （vs 全部单例模板名 / 其他组合成员名 / 全部组合名——组合成员平铺落盘 projects/，同命名空间）
 */
export async function validateTemplateRepo(
  repoDir: string,
  registry: TemplateRegistry,
): Promise<string[]> {
  const issues: string[] = [];
  const seenDirs = new Map<string, string>();

  for (const [name, entry] of Object.entries(registry.templates)) {
    if (!TEMPLATE_NAME_RE.test(name)) {
      issues.push(`模板名 "${name}" 不符合规范 ^[a-z][a-z0-9-]*$`);
      continue;
    }
    const rel = (entry.path ?? `./${name}`).replace(/\\/g, '/');
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) {
      issues.push(`模板 ${name} 的 path 非法（禁止绝对路径或 ..）：${entry.path}`);
      continue;
    }
    const dir = path.join(repoDir, rel);
    if (!(await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false))) {
      issues.push(`模板 ${name} 的目录不存在：${rel}`);
      continue;
    }
    // 一级同名目录：./<name> 或 ./singles/<name>；既保证目录名 === name，也拒绝嵌套在另一模板目录内的 path（防别名绕过）
    const normalized = rel.replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalized !== name && normalized !== `singles/${name}`) {
      issues.push(
        `模板 ${name} 的 path 必须为与 name 同名的一级目录（./<name> 或 ./singles/<name>）：${entry.path}`,
      );
    }
    const owner = seenDirs.get(dir);
    if (owner) {
      issues.push(`模板 ${name} 与 ${owner} 指向同一目录 ${rel}（不允许）`);
    } else {
      seenDirs.set(dir, name);
    }
  }

  // 组合模板校验（solutions 段；缺省空 = 无组合，合法）
  const solutionNames = new Set(Object.keys(registry.solutions));
  const memberOwner = new Map<string, string>(); // 成员名 → 归属组合（全局唯一命名空间）
  for (const [name, entry] of Object.entries(registry.solutions)) {
    if (!TEMPLATE_NAME_RE.test(name)) {
      issues.push(`组合模板名 "${name}" 不符合规范 ^[a-z][a-z0-9-]*$`);
      continue;
    }
    if (registry.templates[name] !== undefined) {
      issues.push(`组合模板 "${name}" 与模板重名（组合与模板必须可区分）`);
      continue;
    }
    let members: string[];
    try {
      members = parseSolutionMembers(entry.members);
    } catch (e) {
      issues.push(`组合模板 ${name}：${(e as Error).message}`);
      continue;
    }
    const declared = new Set(members);
    for (const member of members) {
      // 成员目录必须实际存在（成员 = 组合专属完整模板骨架，solutions/<组合>/<成员>/）
      const memberDir = path.join(repoDir, 'solutions', name, member);
      if (!(await fs.stat(memberDir).then((s) => s.isDirectory()).catch(() => false))) {
        issues.push(
          `组合模板 ${name} 的成员目录不存在：solutions/${name}/${member}/（成员是组合专属模板目录，须实际存在）`,
        );
      }
      // 成员名全局唯一：平铺落盘 projects/ 后成员目录名直接占用顶层命名，与模板/其他成员/组合名同空间
      if (registry.templates[member] !== undefined) {
        issues.push(
          `组合模板 ${name} 的成员名 "${member}" 与单例模板名冲突（成员平铺落盘 projects/ 会抢占目录名，成员名必须全局唯一）`,
        );
      } else if (solutionNames.has(member)) {
        issues.push(`组合模板 ${name} 的成员名 "${member}" 与组合模板名冲突（成员名必须全局唯一）`);
      } else {
        const owner = memberOwner.get(member);
        if (owner) {
          issues.push(
            `组合模板 ${name} 的成员名 "${member}" 与组合 ${owner} 的成员名冲突（成员名必须全局唯一）`,
          );
        } else {
          memberOwner.set(member, name);
        }
      }
    }
    // 反向一致性：solutions/<组合>/ 下的子目录必须全部登记进 members（防幽灵成员目录）
    const solDir = path.join(repoDir, 'solutions', name);
    if (await fs.stat(solDir).then((s) => s.isDirectory()).catch(() => false)) {
      for (const ent of await fs.readdir(solDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        if (!declared.has(ent.name)) {
          issues.push(
            `目录 solutions/${name}/${ent.name}/ 未登记进组合 ${name} 的 members（登记与成员目录须双向一致）`,
          );
        }
      }
    }
  }
  return issues;
}

/** 加载模板注册中心（ensureRepo + 解析 + 校验） */
export async function loadTemplates(
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<LoadedTemplates> {
  // 本地目录直读模式：url 是一个已存在且含 registry.yaml 的目录（如 monorepo 内
  // 的模板源、CI checkout 的仓库子目录）——直接使用，不走缓存与 clone。
  const directDir = path.resolve(url);
  const direct = await fs
    .stat(path.join(directDir, 'registry.yaml'))
    .then(() => true)
    .catch(() => false);

  const { repoDir, stale } = direct
    ? { repoDir: directDir, stale: false }
    : await ensureTemplateRepo(url, opts);

  const file = path.join(repoDir, 'registry.yaml');
  const content = await fs.readFile(file, 'utf8').catch(() => null);
  if (content == null) {
    throw new AgileError(`模板仓库 ${url} 缺少 registry.yaml${stale ? '（当前为离线缓存副本）' : ''}`);
  }
  const registry = parseYaml(content, TemplateRegistrySchema, 'registry.yaml');
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

/** 从模板生成项目骨架到 target（占位符替换） */
export async function scaffoldFromTemplate(
  repoDir: string,
  name: string,
  templateName: string,
  target: string,
  registry: TemplateRegistry,
): Promise<void> {
  const entry = registry.templates[templateName];
  if (!entry) {
    throw new AgileError(`模板不存在：${templateName}（agile template list 查看可用模板）`);
  }
  if (!TEMPLATE_NAME_RE.test(templateName)) {
    throw new AgileError(`模板名不合法：${templateName}`);
  }
  const src = path.join(repoDir, entry.path ?? `./${templateName}`);
  await copyAndSubstitute(src, target, {
    '{{name}}': name,
    '{{safeName}}': safePackageSegment(name),
  });
}

/** scaffoldSolution 的结果（core 不打印，命令层负责输出） */
export interface SolutionScaffoldResult {
  /** 本次实际生成的成员目录名（相对 projects/） */
  created: string[];
  /** 已存在而跳过的成员目录名（补缺语义：组合定义演进后再次 init 只补缺失成员） */
  skipped: string[];
}

/**
 * 从组合模板平铺生成成员项目到 projectsRoot：
 * projects/<成员目录名>/（成员目录名 = overrides[成员名] ?? 成员名，与模板/组合同命名空间、全局唯一）。
 * 成员骨架 = 仓库内 solutions/<组合名>/<成员名>/（组合专属完整模板，不引用 singles）；
 * 成员项目 {{name}} = 实际落地目录名（包名唯一性由 projects/ 平铺目录名天然保证）。
 * 已存在的成员目录跳过（补缺语义；CLI 无法区分本组合已生成成员与同名普通项目，
 * 命令层以 warn 提示人工核对）。init project 的 <name> 仅为输出标签，不落任何目录。
 */
export async function scaffoldSolution(
  repoDir: string,
  registry: TemplateRegistry,
  solutionName: string,
  projectsRoot: string,
  overrides: Record<string, string> = {},
): Promise<SolutionScaffoldResult> {
  const entry = registry.solutions[solutionName];
  if (!entry) {
    throw new AgileError(`组合模板不存在：${solutionName}（agile template list 查看可用组合）`);
  }
  const members = parseSolutionMembers(entry.members);

  // 覆盖名校验：未知成员 / 目录名不合法 / 有效目录名相互冲突
  const memberNames = new Set(members);
  for (const [from, to] of Object.entries(overrides)) {
    if (!memberNames.has(from)) {
      throw new AgileError(
        `--member 引用了组合中不存在的成员：${from}（可用成员：${[...memberNames].join('、') || '（无）'}）`,
      );
    }
    if (!PROJECT_NAME_RE.test(to)) {
      throw new AgileError(`成员 ${from} 的目录名不合法（格式 ^[a-z][a-z0-9-]*$）：${to}`);
    }
  }
  const effective = new Map(members.map((m) => [m, overrides[m] ?? m] as const));
  const dirOwner = new Map<string, string>();
  for (const [mName, dir] of effective) {
    const owner = dirOwner.get(dir);
    if (owner) {
      throw new AgileError(`成员目录名冲突：${owner} 与 ${mName} 都映射到 ${dir}`);
    }
    dirOwner.set(dir, mName);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const m of members) {
    const dir = effective.get(m)!;
    const target = path.join(projectsRoot, dir);
    const exists = await fs.stat(target).then((s) => s.isDirectory()).catch(() => false);
    if (exists) {
      skipped.push(dir);
      continue;
    }
    // 成员骨架 = solutions/<组合>/<成员>/（组合专属完整模板）
    const src = path.join(repoDir, 'solutions', solutionName, m);
    if (!(await fs.stat(src).then((s) => s.isDirectory()).catch(() => false))) {
      throw new AgileError(
        `组合模板 ${solutionName} 的成员目录不存在：solutions/${solutionName}/${m}/`,
      );
    }
    await copyAndSubstitute(src, target, {
      '{{name}}': dir,
      '{{safeName}}': safePackageSegment(dir),
    });
    created.push(dir);
  }

  return { created, skipped };
}
