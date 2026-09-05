import fs from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgileError } from './errors.js';

export const AGILE_DIR = '.agile';
export const SETTINGS_FILE = 'settings.json';

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
 * settings.json 可覆盖（plugins.marketplace / templates.registry），
 * 新增插件或模板只需更新这两个仓库，CLI 无需发版。
 */
export const DEFAULT_PLUGIN_MARKETPLACE = 'https://github.com/pig0224/agile-plugins.git';
export const DEFAULT_TEMPLATE_REGISTRY = 'https://github.com/pig0224/agile-templates.git';

/** 模板仓库的用户级缓存根目录（跨 workspace 共享；测试可用 AGILE_TEMPLATE_CACHE_ROOT 覆盖隔离） */
export function templateCacheRoot(): string {
  const override = process.env.AGILE_TEMPLATE_CACHE_ROOT;
  if (override) return override;
  return path.join(os.homedir(), '.agile', 'templates');
}

/**
 * npm 包根目录（兼容 esbuild 单文件打包与 tsc 多文件两种产物布局）：
 * - 打包后：dist/index.js → 上两级 = 包根
 * - tsc 多文件：dist/core/xxx.js → 上三级 = 包根（按最深路径计算）
 * 以"运行入口文件位置"为准，统一向上查找包含 package.json 的目录。
 */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * 从 start（默认 cwd）逐级向上查找 workspace 根目录。
 * workspace 根 = 存在 .agile/settings.json 的目录。
 */
export function findWorkspaceRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, AGILE_DIR, SETTINGS_FILE))) return dir;
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
      '未找到 workspace：当前目录及其父级均不存在 .agile/settings.json。\n' +
        '请先在目标目录运行：agile init workspace',
    );
  }
  return root;
}
