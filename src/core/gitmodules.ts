import fs from 'node:fs/promises';
import path from 'node:path';

export interface GitmoduleEntry {
  path: string;
  url: string;
  branch?: string;
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
      if (key === 'path') current.path = kv[2];
      else if (key === 'url') current.url = kv[2];
      else if (key === 'branch') current.branch = kv[2] || undefined;
    }
  }
  if (current?.path && current.url) {
    entries.push({ path: current.path, url: current.url, branch: current.branch });
  }
  return entries;
}
