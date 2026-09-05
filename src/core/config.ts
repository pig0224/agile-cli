import fs from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';
import { AgileError } from './errors.js';
import { AGILE_DIR, SETTINGS_FILE } from './paths.js';
import { SettingsSchema, type Settings } from './schemas.js';

/** 解析 yaml 文本 → zod schema，失败时抛出带文件名的中文错误（模板注册中心 registry.yaml 使用） */
export function parseYaml<S extends z.ZodType>(content: string, schema: S, file: string): z.output<S> {
  let raw: unknown;
  try {
    raw = YAML.parse(content);
  } catch (e) {
    throw new AgileError(`${file} 不是合法的 YAML：${(e as Error).message}`);
  }
  if (raw == null) raw = {};
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
  return result.data;
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
