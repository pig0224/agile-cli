import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { git, gitTry } from './git.js';
import { AgileError } from './errors.js';
import { parseYaml } from './config.js';
import { copyAndSubstitute, safePackageSegment } from './scaffold.js';
import { templateCacheRoot } from './paths.js';

/** 模板名规范：小写字母开头，仅小写字母/数字/连字符（防冲突的第一道防线） */
export const TEMPLATE_NAME_RE = /^[a-z][a-z0-9-]*$/;

export const TemplateEntrySchema = z.object({
  description: z.string().default(''),
  language: z.string().optional(),
  framework: z.string().optional(),
  /** 模板目录（相对仓库根）；缺省 ./<name> */
  path: z.string().optional(),
});

export const TemplateRegistrySchema = z.object({
  version: z.literal(1),
  templates: z.record(z.string(), TemplateEntrySchema),
});

export type TemplateEntry = z.infer<typeof TemplateEntrySchema>;
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
 * - 有缓存 → git fetch + reset --hard origin/HEAD（缓存是纯只读副本，强重置安全）
 * - 同步失败且已有缓存 → 降级用缓存（stale=true）
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

  if (opts.refresh === false) {
    // 不要求刷新：直接用现有缓存
    return { repoDir: dir, stale: false };
  }

  const pull = await gitTry(dir, ['-c', 'protocol.file.allow=always', 'fetch', 'origin']);
  if (pull.ok) {
    await git(dir, ['reset', '--hard', 'FETCH_HEAD']);
    return { repoDir: dir, stale: false };
  }
  // 失联：降级使用缓存（首次 clone 不会走到这里）
  return { repoDir: dir, stale: true };
}

/**
 * 校验模板仓库一致性（防冲突核心）：
 * 1. name 符合规范且唯一（YAML 重复键由 yaml 解析器直接抛错）
 * 2. path 解析为仓库内已存在目录（禁止绝对路径/越界）
 * 3. 目录 basename === name（一个目录一个身份，杜绝别名指向同一模板）
 * 4. 同一目录不被多个 name 引用
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
    const base = path.basename(dir);
    if (base !== name) {
      issues.push(`模板 ${name} 的目录名 "${base}" 与 name 不一致（必须同名）`);
    }
    const owner = seenDirs.get(dir);
    if (owner) {
      issues.push(`模板 ${name} 与 ${owner} 指向同一目录 ${rel}（不允许）`);
    } else {
      seenDirs.set(dir, name);
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
