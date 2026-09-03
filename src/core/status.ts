import fs from 'node:fs/promises';
import path from 'node:path';
import { currentBranch, currentCommit, isDirty } from './git.js';
import type { RegistryConfig } from './schemas.js';

export interface RepoStatus {
  repoPath: string;
  exists: boolean;
  branch?: string;
  commit?: string;
  dirty?: boolean;
  pin?: string;
  /** 当前 commit 与 pin 不一致时为 true */
  drifted?: boolean;
  error?: string;
}

export async function collectStatus(root: string, registry: RegistryConfig): Promise<RepoStatus[]> {
  const result: RepoStatus[] = [];
  for (const [repoPath, entry] of Object.entries(registry.repositories)) {
    const status: RepoStatus = { repoPath, exists: false, pin: entry.pin };
    result.push(status);

    const repoDir = path.join(root, repoPath);
    const hasDotGit = await fs
      .stat(path.join(repoDir, '.git'))
      .then(() => true)
      .catch(() => false);
    if (!hasDotGit) {
      status.exists = false;
      status.error = '未检出（未初始化）';
      continue;
    }
    status.exists = true;
    try {
      status.branch = await currentBranch(repoDir);
      status.commit = (await currentCommit(repoDir)).slice(0, 12);
      status.dirty = await isDirty(repoDir);
      if (entry.pin) status.drifted = (await currentCommit(repoDir)) !== entry.pin;
    } catch (e) {
      status.error = (e as Error).message;
    }
  }
  return result;
}
