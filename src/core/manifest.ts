import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * 项目生成清单：`agile init project --template` 每次生成（新建/强制重建）成功后写入
 * `.agile/manifests/<落地目录名>.json`，重跑补缺时据此做完整性校验——
 * 清单存在但目录内容不符 = 上次生成残留或事后改动（硬错误提示处理），
 * 无清单 = 陌生目录（用户手写项目或旧版生成，维持跳过，向后兼容）。
 */
export const ProjectManifestSchema = z.object({
  version: z.literal(1),
  /** 来源：单例模板名或组合模板名 */
  source: z.string().min(1),
  /** 成员原名（组合模板成员；单例模板省略） */
  member: z.string().min(1).optional(),
  /** 实际落地目录名（含 --member 覆盖；即清单文件名） */
  dirName: z.string().min(1),
  /** 生成文件的相对路径数组（/ 分隔，与实际落地内容一致） */
  files: z.array(z.string()),
  /** 生成时间（ISO 8601） */
  generatedAt: z.string().min(1),
  /** 生成时的模板仓 commit（非 git 仓 / 取不到时为 null） */
  templateCommit: z.string().nullable().optional(),
});

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export function manifestsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.agile', 'manifests');
}

export function manifestPath(workspaceRoot: string, dirName: string): string {
  return path.join(manifestsRoot(workspaceRoot), `${dirName}.json`);
}

export async function writeProjectManifest(
  workspaceRoot: string,
  manifest: ProjectManifest,
): Promise<void> {
  const file = manifestPath(workspaceRoot, manifest.dirName);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** 读清单：文件缺失 / 损坏 JSON / 结构不合法一律返回 null（按陌生目录处理，不因清单本身异常阻断） */
export async function readProjectManifest(
  workspaceRoot: string,
  dirName: string,
): Promise<ProjectManifest | null> {
  const raw = await fs.readFile(manifestPath(workspaceRoot, dirName), 'utf8').catch(() => null);
  if (raw == null) return null;
  try {
    const parsed = ProjectManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 删除清单（回滚本次生成时同步清理，防止「目录已回滚、清单仍指向」的脏状态） */
export async function deleteProjectManifest(workspaceRoot: string, dirName: string): Promise<void> {
  await fs.rm(manifestPath(workspaceRoot, dirName), { force: true });
}

/** 递归列出目录下实际文件（/ 分隔相对路径；非常规条目也计入，参与多余项比对） */
export async function listActualFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, relPath);
      } else {
        // 常规文件与非常规条目（符号链接/fifo 等）都算「存在项」——清单比对以路径全集为准
        files.push(relPath);
      }
    }
  }
  await walk(dir, '');
  return files.sort();
}

/** 清单比对：missing = 清单有而目录缺（生成残留被删/复制中断），extra = 目录有而清单无（事后添加/垃圾混入） */
export function compareFiles(
  expected: string[],
  actual: string[],
): { missing: string[]; extra: string[] } {
  const want = new Set(expected);
  const have = new Set(actual);
  const missing = expected.filter((f) => !have.has(f)).sort();
  const extra = actual.filter((f) => !want.has(f)).sort();
  return { missing, extra };
}
