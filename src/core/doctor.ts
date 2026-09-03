import fs from 'node:fs/promises';
import path from 'node:path';
import { checkRemote, isDirty, currentCommit } from './git.js';
import { AgileError } from './errors.js';
import { parseGitmodules } from './gitmodules.js';
import { loadRegistry, loadWorkspace } from './config.js';
import { assertValidRepoPath } from './paths.js';
import type { RegistryConfig } from './schemas.js';

export interface DoctorIssue {
  level: 'error' | 'warn';
  repoPath?: string;
  code: string;
  message: string;
  /** --fix 可自动修复 */
  fixable: boolean;
}

export interface DoctorResult {
  issues: DoctorIssue[];
  checked: {
    repos: number;
    remotes: number;
  };
  fixes: string[];
}

export interface DoctorOptions {
  fix?: boolean;
  /** 联网检查远端可达性（默认开启，--offline 关闭） */
  offline?: boolean;
}

export async function runDoctor(root: string, opts: DoctorOptions = {}): Promise<DoctorResult> {
  const issues: DoctorIssue[] = [];

  // 1. workspace.yaml / registry.yaml 可读且 schema 合法（loadXxx 失败直接抛错）
  const workspace = await loadWorkspace(root);
  const registry = await loadRegistry(root);

  // 2. registry key（路径）合法性
  for (const repoPath of Object.keys(registry.repositories)) {
    try {
      assertValidRepoPath(repoPath);
    } catch (e) {
      issues.push({ level: 'error', repoPath, code: 'invalid-path', message: (e as Error).message, fixable: true });
    }
  }

  // 3. registry ↔ .gitmodules ↔ 磁盘 漂移
  const gitmodules = await parseGitmodules(root);
  const gmPaths = new Set(gitmodules.map((g) => g.path));
  const regPaths = new Set(Object.keys(registry.repositories));

  for (const repoPath of regPaths) {
    if (!gmPaths.has(repoPath)) {
      issues.push({
        level: 'warn',
        repoPath,
        code: 'not-registered-in-gitmodules',
        message: `${repoPath} 在 registry 中，但不在 .gitmodules 中（运行 agile sync 收敛）`,
        fixable: true,
      });
    }
  }
  for (const gm of gitmodules) {
    if (!regPaths.has(gm.path)) {
      issues.push({
        level: 'warn',
        repoPath: gm.path,
        code: 'orphan-submodule',
        message: `${gm.path} 在 .gitmodules 中，但不在 registry 中（运行 agile sync 移除，或 agile repo add 重新登记）`,
        fixable: true,
      });
    }
  }

  // 4. 逐仓库磁盘状态 + pin 漂移 + dirty
  let remoteChecked = 0;
  for (const [repoPath, entry] of Object.entries(registry.repositories)) {
    const repoDir = path.join(root, repoPath);
    const hasDotGit = await fs
      .stat(path.join(repoDir, '.git'))
      .then(() => true)
      .catch(() => false);

    if (!hasDotGit) {
      if (gmPaths.has(repoPath)) {
        issues.push({
          level: 'warn',
          repoPath,
          code: 'not-checked-out',
          message: `${repoPath} 未检出（运行 agile sync）`,
          fixable: true,
        });
      }
    } else {
      if (entry.pin) {
        try {
          const head = await currentCommit(repoDir);
          if (head !== entry.pin) {
            issues.push({
              level: 'warn',
              repoPath,
              code: 'pin-drift',
              message: `${repoPath} 当前 ${head.slice(0, 8)} 与 pin ${entry.pin.slice(0, 8)} 不一致`,
              fixable: true,
            });
          }
        } catch {
          issues.push({ level: 'error', repoPath, code: 'git-broken', message: `${repoPath} git 状态异常`, fixable: false });
        }
      }
      if (await isDirty(repoDir).catch(() => false)) {
        issues.push({
          level: 'warn',
          repoPath,
          code: 'dirty',
          message: `${repoPath} 存在未提交改动`,
          fixable: false,
        });
      }
    }

    // 5. 远端可达性 / 权限
    if (!opts.offline) {
      const r = await checkRemote(entry.url);
      remoteChecked++;
      if (!r.ok) {
        issues.push({
          level: 'error',
          repoPath,
          code: 'remote-unreachable',
          message: `${repoPath} 远端不可达或无权限（${entry.url}）：${r.stderr.split('\n')[0] ?? '未知错误'}`,
          fixable: true,
        });
      }
    }
  }

  // --fix：无权限/不可达的仓库从 registry 移除（gitmodules 随下次 sync 收敛）
  const fixes: string[] = [];
  if (opts.fix) {
    const broken = issues.filter((i) => i.code === 'remote-unreachable');
    if (broken.length > 0) {
      const newRegistry: RegistryConfig = { version: 1, repositories: {} };
      const brokenPaths = new Set(broken.map((b) => b.repoPath));
      for (const [repoPath, entry] of Object.entries(registry.repositories)) {
        if (repoPath && !brokenPaths.has(repoPath)) {
          newRegistry.repositories[repoPath] = entry;
        }
      }
      const { saveRegistry } = await import('./config.js');
      await saveRegistry(root, newRegistry);
      for (const b of broken) {
        fixes.push(`已从 registry 移除 ${b.repoPath}（后续请运行 agile sync 清理 .gitmodules 与磁盘）`);
      }
    }

    // 配置参数错误（非法路径）同样移除
    const invalid = issues.filter((i) => i.code === 'invalid-path');
    if (invalid.length > 0) {
      const invalidPaths = new Set(invalid.map((b) => b.repoPath));
      const newRegistry: RegistryConfig = {
        version: 1,
        repositories: Object.fromEntries(
          Object.entries(registry.repositories).filter(([p]) => !invalidPaths.has(p)),
        ),
      };
      const { saveRegistry } = await import('./config.js');
      await saveRegistry(root, newRegistry);
      for (const b of invalid) fixes.push(`已从 registry 移除非法路径 ${b.repoPath}`);
    }
  }

  if (workspace.paths.projects.startsWith('/') || workspace.paths.projects.includes('..')) {
    throw new AgileError('workspace.yaml 中 paths 配置非法（不允许绝对路径或 ..）');
  }

  return { issues, checked: { repos: regPaths.size, remotes: remoteChecked }, fixes };
}
