import { Command } from 'commander';
import { AgileError } from '../core/errors.js';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadWorkspace, toYaml } from '../core/config.js';
import * as ui from '../ui.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/** 支持的点路径，如 name / defaultBranch / paths.projects */
function getDeep(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setDeep(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

export const configCommand = new Command('config')
  .description('workspace.yaml 配置的增删改查')
  .addCommand(
    new Command('get')
      .description('读取配置项，如 agile config get paths.projects')
      .argument('<key>', '点路径')
      .action(async (key: string) => {
        const root = requireWorkspaceRoot();
        const workspace = (await loadWorkspace(root)) as unknown as Record<string, unknown>;
        const value = getDeep(workspace, key.split('.'));
        if (value === undefined) throw new AgileError(`配置项不存在：${key}`);
        console.log(typeof value === 'object' ? toYaml(value) : String(value));
      }),
  )
  .addCommand(
    new Command('set')
      .description('写入配置项，如 agile config set defaultBranch develop')
      .argument('<key>', '点路径')
      .argument('<value>', '值（字符串）')
      .action(async (key: string, value: string) => {
        const root = requireWorkspaceRoot();
        const file = path.join(root, '.agile', 'workspace.yaml');
        const raw = await fs.readFile(file, 'utf8');
        const doc = (await import('yaml')).parse(raw) as Record<string, unknown>;
        setDeep(doc, key.split('.'), value);
        await fs.writeFile(file, toYaml(doc), 'utf8');
        console.log(ui.ok(`${key} = ${value}`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出全部 workspace 配置')
      .action(async () => {
        const root = requireWorkspaceRoot();
        const workspace = await loadWorkspace(root);
        console.log(toYaml(workspace));
      }),
  )
  .addCommand(
    new Command('unset')
      .description('删除配置项（顶层只读项除外）')
      .argument('<key>', '点路径')
      .action(async (key: string) => {
        const root = requireWorkspaceRoot();
        const file = path.join(root, '.agile', 'workspace.yaml');
        const raw = await fs.readFile(file, 'utf8');
        const doc = (await import('yaml')).parse(raw) as Record<string, unknown>;
        const keys = key.split('.');
        let cur: Record<string, unknown> = doc;
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i]!;
          if (cur[k] == null || typeof cur[k] !== 'object') throw new AgileError(`配置项不存在：${key}`);
          cur = cur[k] as Record<string, unknown>;
        }
        const last = keys[keys.length - 1]!;
        if (!(last in cur)) throw new AgileError(`配置项不存在：${key}`);
        delete cur[last];
        await fs.writeFile(file, toYaml(doc), 'utf8');
        console.log(ui.ok(`已删除 ${key}`));
      }),
  );
