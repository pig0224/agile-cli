import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { git, gitTry } from './git.js';
import { AgileError } from './errors.js';
import { parseJson } from './config.js';
import { PROJECT_NAME_RE, copyAndSubstitute, safePackageSegment } from './scaffold.js';
import { templateCacheRoot } from './paths.js';

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
  version: z.literal(2),
  singles: z.array(SingleEntrySchema).default([]),
  /** 组合模板（多项目系统）：技术栈模板之上的声明式组合层；缺省无组合 */
  solutions: z.array(SolutionEntrySchema).default([]),
});

export type SingleEntry = z.infer<typeof SingleEntrySchema>;
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
 * 校验模板注册中心一致性（防冲突核心；目录由约定派生，无 path 字段）：
 * 1. 名字规范：单例模板名/组合名/成员项目名 ^[a-z][a-z0-9-]*$；登记名 = 目录名（一目录一身份）
 * 2. 登记唯一：singles / solutions / 同组合 projects 数组内 name 不得重复（JSON 数组无键唯一性保证，须显式校验）
 * 3. 目录存在：单例 = singles/<name>/，成员项目 = solutions/<组合>/<name>/（组合专属完整模板骨架）
 * 4. 三段全局唯一：模板名/组合名/成员项目名互不重名——init 后全部平铺落盘 projects/，同一命名空间
 * 5. 双向一致：solutions/<组合>/ 下子目录必须全部登记进该组合的 projects（防幽灵成员目录）
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

    // 反向一致性：solutions/<组合>/ 下的子目录必须全部登记进 projects（防幽灵成员目录）
    const solDir = path.join(repoDir, 'solutions', solution.name);
    if (await isDir(solDir)) {
      for (const ent of await fs.readdir(solDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
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
  const registry = parseJson(content, TemplateRegistrySchema, 'registry.json');
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

/** 从单例模板生成项目骨架到 target（占位符替换）；模板目录 = singles/<模板名>/（约定派生，无 path 字段） */
export async function scaffoldFromTemplate(
  repoDir: string,
  name: string,
  templateName: string,
  target: string,
  registry: TemplateRegistry,
): Promise<void> {
  if (!registry.singles.some((t) => t.name === templateName)) {
    throw new AgileError(`模板不存在：${templateName}（agile template list 查看可用模板）`);
  }
  if (!TEMPLATE_NAME_RE.test(templateName)) {
    throw new AgileError(`模板名不合法：${templateName}`);
  }
  const src = path.join(repoDir, 'singles', templateName);
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
  const solution = registry.solutions.find((s) => s.name === solutionName);
  if (!solution) {
    throw new AgileError(`组合模板不存在：${solutionName}（agile template list 查看可用组合）`);
  }

  // 覆盖名校验：未知成员 / 目录名不合法 / 有效目录名相互冲突
  const memberNames = new Set(solution.projects.map((p) => p.name));
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

  const created: string[] = [];
  const skipped: string[] = [];
  for (const project of solution.projects) {
    const dir = effective.get(project.name)!;
    const target = path.join(projectsRoot, dir);
    const exists = await fs.stat(target).then((s) => s.isDirectory()).catch(() => false);
    if (exists) {
      skipped.push(dir);
      continue;
    }
    // 成员骨架 = solutions/<组合>/<成员>/（组合专属完整模板）
    const src = path.join(repoDir, 'solutions', solutionName, project.name);
    if (!(await fs.stat(src).then((s) => s.isDirectory()).catch(() => false))) {
      throw new AgileError(
        `组合模板 ${solutionName} 的成员目录不存在：solutions/${solutionName}/${project.name}/`,
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
