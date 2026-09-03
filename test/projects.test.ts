import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listProjects } from '../src/core/projects.js';
import { toYaml } from '../src/core/config.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-proj-'));
}

async function makeWorkspace(): Promise<string> {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.agile', 'workspace.yaml'),
    toYaml({ version: 1, name: 't', created: '2026-01-01' }),
    'utf8',
  );
  return dir;
}

async function mkProject(root: string, name: string, marker: string): Promise<void> {
  const dir = path.join(root, 'projects', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, marker), '{}', 'utf8');
}

describe('listProjects', () => {
  it('按构建特征文件识别项目', async () => {
    const root = await makeWorkspace();
    await mkProject(root, 'frontend-web', 'package.json');
    await mkProject(root, 'order-service', 'go.mod');
    await mkProject(root, 'user-service', 'pom.xml');

    const projects = await listProjects(root);
    expect(projects.map((p) => p.name)).toEqual(['frontend-web', 'order-service', 'user-service']);
    expect(projects[0]?.path).toBe('projects/frontend-web');
  });

  it('无特征文件的目录不算项目（如纯文档目录）', async () => {
    const root = await makeWorkspace();
    await mkProject(root, 'real-app', 'tsconfig.json');
    const docs = path.join(root, 'projects', 'notes-only');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'NOTES.md'), 'x', 'utf8');

    const projects = await listProjects(root);
    expect(projects.map((p) => p.name)).toEqual(['real-app']);
  });

  it('projects 目录不存在返回空', async () => {
    const root = await makeWorkspace();
    expect(await listProjects(root)).toEqual([]);
  });

  it('遵循 workspace.yaml 自定义 projects 路径', async () => {
    const root = await makeWorkspace();
    await fs.writeFile(
      path.join(root, '.agile', 'workspace.yaml'),
      toYaml({
        version: 1,
        name: 't',
        created: '2026-01-01',
        paths: {
          techSpecs: 'tech-specs',
          bizTechDocs: 'biz-tech-docs',
          bizProductDocs: 'biz-product-docs',
          projects: 'apps',
          processDocs: 'process-docs',
        },
      }),
      'utf8',
    );
    const dir = path.join(root, 'apps', 'svc');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'go.mod'), 'module x', 'utf8');

    const projects = await listProjects(root);
    expect(projects[0]).toEqual({ name: 'svc', path: 'apps/svc' });
  });
});
