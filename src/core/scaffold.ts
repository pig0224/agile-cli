import fs from 'node:fs/promises';
import path from 'node:path';
import { AgileError } from './errors.js';

/** java 包名安全段：小写字母数字，非法字符折叠 */
export function safePackageSegment(name: string): string {
  const seg = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return seg.length > 0 ? seg : 'app';
}

/** 项目名规范：小写字母开头，仅小写字母/数字/连字符。
 *  项目名同时用作 projects/ 目录名与模板 {{name}} 占位（npm name / go module / 包名等），
 *  必须在这些位置都合法；同时杜绝路径穿越（/ \ .. 等）。 */
export const PROJECT_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** 校验项目名，不合法抛出中文错误（init project 使用） */
export function assertProjectName(name: string): void {
  if (!PROJECT_NAME_RE.test(name)) {
    throw new AgileError(
      `项目名不合法（格式 ^[a-z][a-z0-9-]*$，仅小写字母/数字/连字符——项目名同时用作目录名、npm 包名与 go module）：${name}`,
    );
  }
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
