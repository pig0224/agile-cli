import fs from 'node:fs/promises';
import path from 'node:path';

/** java 包名安全段：小写字母数字，非法字符折叠 */
export function safePackageSegment(name: string): string {
  const seg = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return seg.length > 0 ? seg : 'app';
}

const TEXT_EXT = new Set([
  '.json', '.ts', '.tsx', '.js', '.jsx', '.vue', '.html', '.md',
  '.yml', '.yaml', '.mod', '.go', '.java', '.xml', '.properties',
  '.mjs', '.css', '.cjs',
]);

/** 将模板目录复制到 target，并做 {{name}} / {{safeName}} 占位替换（文本文件与目录名） */
export async function copyAndSubstitute(
  src: string,
  dest: string,
  vars: Record<string, string>,
): Promise<void> {
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
      const isText =
        TEXT_EXT.has(ext) || !ext || entry.name === 'Makefile' || entry.name === '.gitignore';
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

/** 空项目骨架：仅一个 README（不依赖模板注册中心，`init project` 缺省 --template 时使用） */
export async function scaffoldEmptyProject(dest: string, name: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(
    path.join(dest, 'README.md'),
    `# ${name}\n\n空项目骨架（\`agile init project\` 未指定 --template）。\n后续可用 \`agile init project\` 配合模板迁移，或直接在此按团队规范补充代码与文档。\n`,
    'utf8',
  );
}
