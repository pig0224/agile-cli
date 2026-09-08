import fs from 'node:fs/promises';
import { z } from 'zod';
import { AgileError } from './errors.js';
import { AGILE_DIR, SETTINGS_FILE } from './paths.js';
import { SettingsSchema, type Settings } from './schemas.js';

/** 解析 JSON 文本 → zod schema，失败时抛出带文件名的中文错误（模板注册中心 registry.json 使用） */
export function parseJson<S extends z.ZodType>(content: string, schema: S, file: string): z.output<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new AgileError(`${file} 不是合法的 JSON：${(e as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new AgileError(`${file} 格式校验失败：\n${issues}`);
  }
  return result.data;
}

const settingsFilePath = (root: string) => `${root}/${AGILE_DIR}/${SETTINGS_FILE}`;

/** 读取并校验 .agile/settings.json；文件缺失或非法时抛出中文错误 */
export async function loadSettings(root: string): Promise<Settings> {
  const file = settingsFilePath(root);
  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch {
    throw new AgileError(`未找到 ${AGILE_DIR}/${SETTINGS_FILE}。请先运行：agile init workspace`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new AgileError(`${AGILE_DIR}/${SETTINGS_FILE} 不是合法的 JSON：${(e as Error).message}`);
  }
  const result = SettingsSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new AgileError(`${AGILE_DIR}/${SETTINGS_FILE} 格式校验失败：\n${issues}`);
  }
  // 配置版本迁移：v1（2.0.x 存量）兼容读取，内存归一为 v2——后续任意写入自然落盘升级。
  // structuredClone 隔离 zod 共享默认对象：.default({...}) 每次解析返回同一引用，
  // 调用方原地改 settings.plugins.dependencies / settings.paths 会污染进程内后续所有解析
  return structuredClone({ ...result.data, version: 2 });
}

export async function saveSettings(root: string, settings: Settings): Promise<void> {
  await fs.writeFile(settingsFilePath(root), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export async function settingsFileExists(root: string): Promise<boolean> {
  return fs
    .stat(settingsFilePath(root))
    .then(() => true)
    .catch(() => false);
}
