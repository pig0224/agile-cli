import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgileError } from './errors.js';

export const PROJECT_TYPES = ['vue', 'react', 'go', 'java', 'node'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

const TEMPLATE_ROOT = fileURLToPath(new URL('../../templates', import.meta.url));

/** java 包名安全段：小写字母数字，非法字符折叠 */
function safePackageSegment(name: string): string {
  const seg = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return seg.length > 0 ? seg : 'app';
}

/** 将模板目录复制到 target，并做 {{name}} / {{safeName}} 占位替换（仅文本文件） */
export async function scaffoldProject(target: string, name: string, type: string): Promise<void> {
  if (!PROJECT_TYPES.includes(type as ProjectType)) {
    throw new AgileError(`不支持的项目类型：${type}（可选：${PROJECT_TYPES.join(' | ')}）`);
  }
  const src = path.join(TEMPLATE_ROOT, type);
  await copyAndSubstitute(src, target, {
    '{{name}}': name,
    '{{safeName}}': safePackageSegment(name),
  });
}

const TEXT_EXT = new Set(['.json', '.ts', '.tsx', '.js', '.jsx', '.vue', '.html', '.md', '.yml', '.yaml', '.mod', '.go', '.java', '.xml', '.properties', 'Makefile', '.gitignore', '.mjs', '.css']);

async function copyAndSubstitute(src: string, dest: string, vars: Record<string, string>): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    // 目录名中的占位符（如 java 模板的 com/example/{{safeName}}）同样替换
    let name = entry.name;
    for (const [k, v] of Object.entries(vars)) name = name.replaceAll(k, v);
    const d = path.join(dest, name);
    if (entry.isDirectory()) {
      await copyAndSubstitute(s, d, vars);
    } else {
      const ext = path.extname(entry.name);
      const isText = TEXT_EXT.has(ext) || !ext || entry.name === 'Makefile' || entry.name === '.gitignore';
      if (isText) {
        let content = await fs.readFile(s, 'utf8');
        for (const [k, v] of Object.entries(vars)) content = content.replaceAll(k, v);
        await fs.writeFile(d, content, 'utf8');
      } else {
        await fs.copyFile(s, d);
      }
    }
  }
}
