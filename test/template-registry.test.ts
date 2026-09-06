import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseSolutionMembers,
  scaffoldFromTemplate,
  scaffoldSolution,
  templateCacheDir,
  validateTemplateRepo,
  TEMPLATE_NAME_RE,
  type TemplateRegistry,
} from '../src/core/template-registry.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-tpl-'));
}

/** 模板/成员目录内放一个含占位符的 package.json（校验 {{name}}/{{safeName}} 替换） */
async function writePkgPlaceholder(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '{{name}}', pkg: '{{safeName}}' }),
    'utf8',
  );
}

/**
 * 造一个最小模板仓库（v2 布局）：singles/ 放单例模板，solutions/<组合>/<成员>/ 放组合专属成员模板。
 * - 模板缺省登记 path = ./singles/<name>；legacyRoot = true 时模拟旧布局（无 path，根一级目录）
 * - 组合成员目录按 members 清单物理创建；skipDirs 模拟成员目录缺失，extraDirs 模拟幽灵成员目录
 */
async function makeRepo(
  defs: Array<{ name: string; path?: string; dirName?: string; withDir?: boolean; legacyRoot?: boolean }>,
  solutions?: Record<
    string,
    { description?: string; members: string; skipDirs?: string[]; extraDirs?: string[] }
  >,
): Promise<{ repoDir: string; registry: TemplateRegistry }> {
  const repoDir = await tmp();
  const registry: TemplateRegistry = { version: 1, templates: {}, solutions: {} };
  for (const def of defs) {
    const rel = def.path ?? (def.legacyRoot ? undefined : `./singles/${def.name}`);
    registry.templates[def.name] = {
      description: `${def.name} 模板`,
      ...(rel ? { path: rel } : {}),
    };
    if (def.withDir !== false) {
      const dirRel = def.dirName ?? (rel ? rel.replace(/^\.\//, '') : def.name);
      await writePkgPlaceholder(path.join(repoDir, dirRel));
    }
  }
  for (const [name, s] of Object.entries(solutions ?? {})) {
    registry.solutions[name] = {
      description: s.description ?? `${name} 组合`,
      members: s.members,
    };
    const members = s.members
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    for (const m of members) {
      if (s.skipDirs?.includes(m)) continue;
      await writePkgPlaceholder(path.join(repoDir, 'solutions', name, m));
    }
    for (const extra of s.extraDirs ?? []) {
      await writePkgPlaceholder(path.join(repoDir, 'solutions', name, extra));
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
  it('合法注册中心（singles/ 布局）无问题', async () => {
    const { repoDir, registry } = await makeRepo([
      { name: 'vue3-vite' },
      { name: 'go-service' },
    ]);
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('旧布局兼容：根一级目录（无 path）合法', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'go-service', legacyRoot: true }]);
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('拒绝不符合命名规范的模板名', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'Vue_Vite' }]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('Vue_Vite');
    expect(issues.join('\n')).toContain('规范');
  });

  it('path 与 name 不一致 → 报错（一级同名目录）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite', path: './vue', dirName: 'vue' }]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('一级目录');
  });

  it('path 嵌套在另一模板目录内 → 报错（防别名绕过）', async () => {
    const { repoDir, registry } = await makeRepo([
      { name: 'vue3-vite' },
      { name: 'vue3-sub', path: './singles/vue3-vite/sub', dirName: 'singles/vue3-vite/sub' },
    ]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('一级目录');
  });

  it('两个 name 指向同一目录 → 冲突', async () => {
    const { repoDir, registry } = await makeRepo([
      { name: 'vue3-vite' },
      { name: 'vue3-vite-alias', path: './singles/vue3-vite' },
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
    const pkgDir = path.join(repoDir, 'singles', 'java-springboot', 'src', 'com', 'example', '{{safeName}}');
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

describe('parseSolutionMembers', () => {
  it('解析合法成员清单（逗号分隔 + 容忍空白 + 保留顺序）', () => {
    expect(parseSolutionMembers('backend,frontend')).toEqual(['backend', 'frontend']);
    expect(parseSolutionMembers('frontend, backend')).toEqual(['frontend', 'backend']);
    expect(parseSolutionMembers('backend')).toEqual(['backend']);
  });

  it('空串 / 非法格式 / 重复成员名 → 抛错', () => {
    expect(() => parseSolutionMembers('')).toThrow(/不能为空/);
    expect(() => parseSolutionMembers('   ')).toThrow(/不能为空/);
    expect(() => parseSolutionMembers('backend=x')).toThrow(/不合法/);
    expect(() => parseSolutionMembers('Backend')).toThrow(/不合法/);
    expect(() => parseSolutionMembers('backend, frontend, backend')).toThrow(/重复/);
  });
});

describe('validateTemplateRepo（组合模板）', () => {
  it('合法组合（singles + solutions 布局）无问题', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { members: 'backend,frontend' },
    });
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('组合名不符合规范 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      Admin_Base: { members: 'backend' },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('组合模板名');
  });

  it('组合与模板重名 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'vue3-vite': { members: 'backend' },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('重名');
  });

  it('两个不同组合名合法共存（重名由 YAML 重复键检测拦截）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { members: 'backend' },
      'crm-base': { members: 'frontend' },
    });
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('members 非法格式 → 报错', async () => {
    const bad = await makeRepo([{ name: 'vue3-vite' }], { 'admin-base': { members: 'Backend=x' } });
    expect((await validateTemplateRepo(bad.repoDir, bad.registry)).join('\n')).toContain('不合法');
  });

  it('成员目录缺失（登记了成员但 solutions/<组合>/<成员>/ 不存在）→ 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { members: 'backend,frontend', skipDirs: ['backend'] },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('成员目录不存在');
  });

  it('幽灵成员目录（solutions/<组合>/ 下子目录未登记进 members）→ 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { members: 'backend', extraDirs: ['ghost-member'] },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('未登记');
  });

  it('成员名与单例模板名冲突 → 报错（平铺落盘会抢占 projects/ 目录名）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { members: 'backend,go-service' },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('go-service');
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('冲突');
  });

  it('跨组合成员名冲突 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { members: 'backend' },
      'crm-base': { members: 'backend' },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('冲突');
  });

  it('成员名与另一组合名冲突 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { members: 'backend' },
      'crm-base': { members: 'admin-base' },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('冲突');
  });
});

describe('scaffoldSolution', () => {
  function solutionRepo() {
    return makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { members: 'backend,frontend' },
    });
  }

  it('平铺落盘：projects/<成员名>/，{{name}} = 实际目录名，无系统 README', async () => {
    const { repoDir, registry } = await solutionRepo();
    const projectsRoot = await tmp();
    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot);

    expect(result.created).toEqual(['backend', 'frontend']);
    expect(result.skipped).toEqual([]);
    const backendPkg = await fs.readFile(path.join(projectsRoot, 'backend', 'package.json'), 'utf8');
    expect(backendPkg).toContain('"name":"backend"');
    expect(backendPkg).toContain('"pkg":"backend"');
    const frontendPkg = await fs.readFile(path.join(projectsRoot, 'frontend', 'package.json'), 'utf8');
    expect(frontendPkg).toContain('"name":"frontend"');
    // 平铺模式：无系统目录、无系统 README
    await expect(fs.stat(path.join(projectsRoot, 'README.md'))).rejects.toThrow();
  });

  it('overrides 覆盖成员目录名（{{name}} 跟随实际目录名）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const projectsRoot = await tmp();
    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {
      backend: 'admin-backend',
    });
    expect(result.created).toEqual(['admin-backend', 'frontend']);
    const pkg = await fs.readFile(path.join(projectsRoot, 'admin-backend', 'package.json'), 'utf8');
    expect(pkg).toContain('"name":"admin-backend"');
    await expect(fs.stat(path.join(projectsRoot, 'backend'))).rejects.toThrow();
  });

  it('重复执行：已存在成员跳过（补缺语义）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const projectsRoot = await tmp();
    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot);
    const second = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot);
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(['backend', 'frontend']);
  });

  it('overrides 非法：未知成员 / 目录名不合法 / 目录冲突 → 抛错', async () => {
    const { repoDir, registry } = await solutionRepo();
    const projectsRoot = await tmp();
    await expect(
      scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, { mobile: 'app' }),
    ).rejects.toThrow(/不存在的成员/);
    await expect(
      scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, { backend: 'Admin_X' }),
    ).rejects.toThrow(/目录名不合法/);
    await expect(
      scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, { backend: 'frontend' }),
    ).rejects.toThrow(/冲突/);
  });

  it('组合不存在 → 抛错', async () => {
    const { repoDir, registry } = await solutionRepo();
    const projectsRoot = await tmp();
    await expect(
      scaffoldSolution(repoDir, registry, 'nope', projectsRoot),
    ).rejects.toThrow(/组合模板不存在/);
  });
});
