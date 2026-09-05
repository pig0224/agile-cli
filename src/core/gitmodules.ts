import fs from 'node:fs/promises';
import path from 'node:path';

export interface GitmoduleEntry {
  path: string;
  url: string;
  branch?: string;
}

/**
 * git config INI 值反转义：git 写 .gitmodules 时把值中的 `\` 转义为 `\\`
 * （Windows 本地路径 URL 必现，如 C:\\Users\\...\\repo.git），读回需还原，
 * 否则与 registry 原始路径比较永远不等，sync 每次都会误判「URL 变更」拆掉重装 submodule。
 */
function unescapeIniValue(value: string): string {
  return value.replace(/\\\\/g, '\\');
}

/**
 * 解析 .gitmodules（git config INI 格式）。
 * 文件不存在时返回空数组。
 */
export async function parseGitmodules(root: string): Promise<GitmoduleEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(path.join(root, '.gitmodules'), 'utf8');
  } catch {
    return [];
  }

  const entries: GitmoduleEntry[] = [];
  let current: { path?: string; url?: string; branch?: string } | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[submodule\s+"(.+)"\]$/.exec(line);
    if (section) {
      if (current?.path && current.url) {
        entries.push({ path: current.path, url: current.url, branch: current.branch });
      }
      current = {};
      continue;
    }
    const kv = /^(\S+?)\s*=\s*(.*)$/.exec(line);
    if (kv && current) {
      const key = kv[1] ?? '';
      const value = unescapeIniValue(kv[2] ?? '');
      if (key === 'path') current.path = value;
      else if (key === 'url') current.url = value;
      else if (key === 'branch') current.branch = value || undefined;
    }
  }
  if (current?.path && current.url) {
    entries.push({ path: current.path, url: current.url, branch: current.branch });
  }
  return entries;
}
