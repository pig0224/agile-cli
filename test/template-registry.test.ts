import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  scaffoldFromTemplate,
  templateCacheDir,
  validateTemplateRepo,
  TEMPLATE_NAME_RE,
  type TemplateRegistry,
} from '../src/core/template-registry.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-tpl-'));
}

/** 造一个最小模板仓库：registry + 若干模板目录 */
async function makeRepo(
  defs: Array<{ name: string; dirName?: string; path?: string; withDir?: boolean }>,
): Promise<{ repoDir: string; registry: TemplateRegistry }> {
  const repoDir = await tmp();
  const registry: TemplateRegistry = { version: 1, templates: {} };
  for (const def of defs) {
    registry.templates[def.name] = {
      description: `${def.name} 模板`,
      ...(def.path ? { path: def.path } : {}),
    };
    if (def.withDir !== false) {
      const dir = path.join(repoDir, def.dirName ?? def.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: '{{name}}', pkg: '{{safeName}}' }),
        'utf8',
      );
    }
  }
  return { repoDir, registry };
}

describe('TEMPLATE_NAME_RE', () => {
  it('接受合法模板名，拒绝非法名', () => {
    expect(TEMPLATE_NAME_RE.test('vue3-vite')).toBe(true);
    expect(TEMPLATE_NAME_RE.test('go-service')).toBe(true);
    expect(TEMPLATE_NAME_RE.test('a')).toBe(true);
    expect(TEMPLATE_NAME_RE.test('Vue')).toBe(false);
    expect(TEMPLATE_NAME_RE.test('1abc')).toBe(false);
    expect(TEMPLATE_NAME_RE.test('a_b')).toBe(false);
    expect(TEMPLATE_NAME_RE.test('a b')).toBe(false);
  });
});

describe('templateCacheDir', () => {
  it('不同 URL 得到不同缓存目录', () => {
    const a = templateCacheDir('https://github.com/x/templates.git');
    const b = templateCacheDir('https://github.com/y/templates.git');
    expect(a).not.toBe(b);
    expect(a).toContain(path.join('.agile', 'templates'));
  });
});

describe('validateTemplateRepo', () => {
  it('合法注册中心无问题', async () => {
    const { repoDir, registry } = await makeRepo([
      { name: 'vue3-vite' },
      { name: 'go-service' },
    ]);
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('拒绝不符合命名规范的模板名', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'Vue_Vite' }]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('Vue_Vite');
    expect(issues.join('\n')).toContain('规范');
  });

  it('目录名与 name 不一致 → 报错（一目录一身份）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite', path: './vue', dirName: 'vue' }]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('目录名 "vue" 与 name 不一致');
  });

  it('两个 name 指向同一目录 → 冲突', async () => {
    const { repoDir, registry } = await makeRepo([
      { name: 'vue3-vite' },
      { name: 'vue3-vite-alias', path: './vue3-vite' },
    ]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('指向同一目录');
  });

  it('path 越界 / 目录缺失 → 报错', async () => {
    const escape = await makeRepo([{ name: 'evil', path: '../outside' }]);
    expect((await validateTemplateRepo(escape.repoDir, escape.registry)).join('\n')).toContain('非法');

    const missing = await makeRepo([{ name: 'ghost', withDir: false }]);
    expect((await validateTemplateRepo(missing.repoDir, missing.registry)).join('\n')).toContain('不存在');
  });
});

describe('scaffoldFromTemplate', () => {
  it('占位符替换（含目录名）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'java-springboot' }]);
    // 造含占位符的目录结构
    const pkgDir = path.join(repoDir, 'java-springboot', 'src', 'com', 'example', '{{safeName}}');
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, 'App.java'), 'package com.example.{{safeName}}; // {{name}}', 'utf8');

    const target = await tmp();
    await scaffoldFromTemplate(repoDir, 'Order-Service', 'java-springboot', target, registry);

    const generated = path.join(target, 'src', 'com', 'example', 'orderservice', 'App.java');
    const content = await fs.readFile(generated, 'utf8');
    expect(content).toBe('package com.example.orderservice; // Order-Service');
    const pkg = await fs.readFile(path.join(target, 'package.json'), 'utf8');
    expect(pkg).toContain('"name":"Order-Service"');
    expect(pkg).toContain('"pkg":"orderservice"');
  });

  it('模板不存在 → 抛错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }]);
    const target = await tmp();
    await expect(scaffoldFromTemplate(repoDir, 'x', 'nope', target, registry)).rejects.toThrow(/模板不存在/);
  });
});
