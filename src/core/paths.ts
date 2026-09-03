import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgileError } from './errors.js';

export const AGILE_DIR = '.agile';
export const WORKSPACE_FILE = 'workspace.yaml';
export const REGISTRY_FILE = 'registry.yaml';
export const PLUGIN_FILE = 'plugin.yaml';

export const DEFAULT_PATHS = {
  techSpecs: 'tech-specs',
  bizTechDocs: 'biz-tech-docs',
  bizProductDocs: 'biz-product-docs',
  projects: 'projects',
  processDocs: 'process-docs',
} as const;

export const DRAWER_PATHS = Object.values(DEFAULT_PATHS);

/**
 * 默认插件市场 / 模板注册中心的 git 地址（占位，发布前替换为实际仓库）。
 * workspace.yaml 可覆盖（plugin.marketplace / templates.registry），
 * 新增插件或模板只需更新这两个仓库，CLI 无需发版。
 */
export const DEFAULT_PLUGIN_MARKETPLACE = 'https://github.com/pig0224/agile-plugins.git';
export const DEFAULT_TEMPLATE_REGISTRY = 'https://github.com/pig0224/agile-templates.git';

/** 模板仓库的用户级缓存根目录（跨 workspace 共享） */
export function templateCacheRoot(): string {
  return path.join(os.homedir(), '.agile', 'templates');
}

/**
 * 从 start（默认 cwd）逐级向上查找 workspace 根目录。
 * workspace 根 = 存在 .agile/workspace.yaml 的目录。
 */
export function findWorkspaceRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, AGILE_DIR, WORKSPACE_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 同 findWorkspaceRoot，但找不到时抛错（供需要 workspace 上下文的命令使用） */
export function requireWorkspaceRoot(start: string = process.cwd()): string {
  const root = findWorkspaceRoot(start);
  if (!root) {
    throw new AgileError(
      '未找到 workspace：当前目录及其父级均不存在 .agile/workspace.yaml。\n' +
        '请先在目标目录运行：agile init workspace',
    );
  }
  return root;
}

export const workspaceFilePath = (root: string) => path.join(root, AGILE_DIR, WORKSPACE_FILE);
export const registryFilePath = (root: string) => path.join(root, AGILE_DIR, REGISTRY_FILE);
export const pluginFilePath = (root: string) => path.join(root, AGILE_DIR, PLUGIN_FILE);
export const gitmodulesFilePath = (root: string) => path.join(root, '.gitmodules');

/** 校验 registry key（相对路径）合法性：不允许绝对路径、越界、以 .agile 为前缀 */
export function assertValidRepoPath(repoPath: string): void {
  const p = repoPath.replace(/\\/g, '/');
  if (path.isAbsolute(repoPath)) {
    throw new AgileError(`仓库路径不允许使用绝对路径：${repoPath}`);
  }
  if (p.split('/').includes('..')) {
    throw new AgileError(`仓库路径不允许包含 ".."：${repoPath}`);
  }
  if (p === AGILE_DIR || p.startsWith(`${AGILE_DIR}/`)) {
    throw new AgileError(`仓库路径不允许位于 ${AGILE_DIR}/ 内：${repoPath}`);
  }
  if (!/^[A-Za-z0-9_.\-/]+$/.test(p)) {
    throw new AgileError(`仓库路径包含非法字符（仅允许字母、数字、_ . - /）：${repoPath}`);
  }
}
