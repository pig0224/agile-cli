import fs from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';
import { AgileError } from './errors.js';
import { AGILE_DIR, PLUGIN_FILE, REGISTRY_FILE, WORKSPACE_FILE } from './paths.js';
import {
  PluginFileSchema,
  RegistrySchema,
  WorkspaceSchema,
  type PluginFileConfig,
  type RegistryConfig,
  type WorkspaceConfig,
} from './schemas.js';

/** 解析 yaml 文本 → zod schema，失败时抛出带文件名的中文错误 */
export function parseYaml<T>(content: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, file: string): T {
  let raw: unknown;
  try {
    raw = YAML.parse(content);
  } catch (e) {
    throw new AgileError(`${file} 不是合法的 YAML：${(e as Error).message}`);
  }
  if (raw == null) raw = {};
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new AgileError(`${file} 格式校验失败：\n${issues}`);
  }
  return result.data;
}

export function toYaml(data: unknown): string {
  return YAML.stringify(data, { lineWidth: 120 });
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export async function loadWorkspace(root: string): Promise<WorkspaceConfig> {
  const file = `${AGILE_DIR}/${WORKSPACE_FILE}`;
  const content = await readIfExists(`${root}/${file}`);
  if (content == null) {
    throw new AgileError(`未找到 ${file}。请先运行：agile init workspace`);
  }
  return parseYaml(content, WorkspaceSchema, file);
}

export async function loadRegistry(root: string): Promise<RegistryConfig> {
  const file = `${AGILE_DIR}/${REGISTRY_FILE}`;
  const content = await readIfExists(`${root}/${file}`);
  if (content == null) {
    throw new AgileError(`未找到 ${file}。请先运行：agile init workspace`);
  }
  return parseYaml(content, RegistrySchema, file);
}

export async function saveRegistry(root: string, registry: RegistryConfig): Promise<void> {
  await fs.writeFile(`${root}/${AGILE_DIR}/${REGISTRY_FILE}`, toYaml(registry), 'utf8');
}

export async function loadPluginFile(root: string): Promise<PluginFileConfig | null> {
  const file = `${AGILE_DIR}/${PLUGIN_FILE}`;
  const content = await readIfExists(`${root}/${file}`);
  if (content == null) return null;
  return parseYaml(content, PluginFileSchema, file);
}

export async function savePluginFile(root: string, data: PluginFileConfig): Promise<void> {
  await fs.writeFile(`${root}/${AGILE_DIR}/${PLUGIN_FILE}`, toYaml(data), 'utf8');
}
