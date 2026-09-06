import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseJson } from '../src/core/config.js';
import {
  scaffoldFromTemplate,
  scaffoldSolution,
  templateCacheDir,
  validateTemplateRepo,
  TEMPLATE_NAME_RE,
  TemplateRegistrySchema,
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
 * 造一个最小模板仓库（registry.json v2 布局）：singles/<名>/ 放单例模板，solutions/<组合>/<成员>/ 放组合专属成员模板。
 * - projects 用 Record（成员名 → 描述）书写，按插入序转数组 = registry.json 的数组顺序
 * - skipDirs 模拟成员目录缺失（登记了但目录不存在），extraDirs 模拟幽灵成员目录（目录在但未登记）
 */
async function makeRepo(
  defs: Array<{ name: string; withDir?: boolean }>,
  solutions?: Record<
    string,
    { description?: string; projects: Record<string, string>; skipDirs?: string[]; extraDirs?: string[] }
  >,
): Promise<{ repoDir: string; registry: TemplateRegistry }> {
  const repoDir = await tmp();
  const registry: TemplateRegistry = { version: 2, singles: [], solutions: [] };
  for (const def of defs) {
    registry.singles.push({ name: def.name, description: `${def.name} 模板` });
    if (def.withDir !== false) {
      await writePkgPlaceholder(path.join(repoDir, 'singles', def.name));
    }
  }
  for (const [name, s] of Object.entries(solutions ?? {})) {
    registry.solutions.push({
      name,
      description: s.description ?? `${name} 组合`,
      projects: Object.entries(s.projects).map(([n, description]) => ({ name: n, description })),
    });
    for (const m of Object.keys(s.projects)) {
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

describe('TemplateRegistrySchema（registry.json v2 解析）', () => {
  const parse = (content: string) => parseJson(content, TemplateRegistrySchema, 'registry.json');

  it('合法 v2 注册中心：singles/solutions 数组，projects 条目与 singles 同形状（language/framework 为字符串数组）', () => {
    const registry = parse(
      JSON.stringify({
        version: 2,
        singles: [
          {
            name: 'vue3-vite',
            description: 'Vue 3 + Vite + TypeScript 前端项目',
            language: ['TypeScript'],
            framework: ['Vue', 'Vite'],
          },
        ],
        solutions: [
          {
            name: 'admin-base',
            description: '通用后台基础系统',
            projects: [{ name: 'backend', description: '后端服务（Go）' }],
          },
        ],
      }),
    );
    expect(registry.version).toBe(2);
    expect(registry.singles[0]?.language).toEqual(['TypeScript']);
    expect(registry.singles[0]?.framework).toEqual(['Vue', 'Vite']);
    expect(registry.solutions[0]?.projects[0]?.description).toBe('后端服务（Go）');
  });

  it('singles/solutions 可省略（缺省空数组 = 无组合，合法）', () => {
    const registry = parse('{"version":2}');
    expect(registry.singles).toEqual([]);
    expect(registry.solutions).toEqual([]);
  });

  it('version 非 2 / description 空白 / projects 空数组 / language 空数组 / 非法 JSON → 报错', () => {
    expect(() => parse('{"version":1}')).toThrow(/校验失败/);
    expect(() =>
      parse(JSON.stringify({ version: 2, singles: [{ name: 'a', description: '   ' }] })),
    ).toThrow(/校验失败/);
    expect(() =>
      parse(JSON.stringify({ version: 2, solutions: [{ name: 'x', description: 'd', projects: [] }] })),
    ).toThrow(/校验失败/);
    expect(() =>
      parse(JSON.stringify({ version: 2, singles: [{ name: 'a', description: 'd', language: [] }] })),
    ).toThrow(/校验失败/);
    expect(() => parse('{oops')).toThrow(/不是合法的 JSON/);
  });
});

describe('validateTemplateRepo', () => {
  it('合法注册中心（singles 布局）无问题', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }]);
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('拒绝不符合命名规范的单例模板名', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'Vue_Vite' }]);
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues.join('\n')).toContain('Vue_Vite');
    expect(issues.join('\n')).toContain('规范');
  });

  it('目录缺失（登记了但 singles/<name>/ 不存在）→ 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'ghost', withDir: false }]);
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('不存在');
  });

  it('singles 数组重复登记 → 报错（数组无键唯一性保证，须显式校验）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }, { name: 'vue3-vite' }]);
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('重复登记');
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

describe('validateTemplateRepo（组合模板）', () => {
  it('合法组合（singles + solutions 布局）无问题', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { projects: { backend: '后端服务', frontend: '前端应用' } },
    });
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('组合名不符合规范 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      Admin_Base: { projects: { backend: '后端服务' } },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('组合模板名');
  });

  it('组合与单例模板重名 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'vue3-vite': { projects: { backend: '后端服务' } },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('重名');
  });

  it('solutions 数组重复登记组合 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([], {
      'admin-base': { projects: { backend: '后端服务' } },
    });
    registry.solutions.push({
      name: 'admin-base',
      description: '重复组合',
      projects: [{ name: 'frontend', description: '前端应用' }],
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('重复登记');
  });

  it('两个不同组合名合法共存', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { backend: '后端服务' } },
      'crm-base': { projects: { frontend: '前端应用' } },
    });
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
  });

  it('成员项目名不合法 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { Backend: '后端服务' } },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('不合法');
  });

  it('成员项目目录缺失（登记了成员但 solutions/<组合>/<成员>/ 不存在）→ 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': {
        projects: { backend: '后端服务', frontend: '前端应用' },
        skipDirs: ['backend'],
      },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('成员项目目录不存在');
  });

  it('幽灵成员目录（solutions/<组合>/ 下子目录未登记进 projects）→ 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { backend: '后端服务' }, extraDirs: ['ghost-member'] },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('未登记');
  });

  it('成员项目名与单例模板名冲突 → 报错（平铺落盘会抢占 projects/ 目录名）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { projects: { backend: '后端服务', 'go-service': '与模板撞名' } },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('go-service');
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('冲突');
  });

  it('跨组合成员项目名冲突 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { backend: '后端服务' } },
      'crm-base': { projects: { backend: '后端服务' } },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('冲突');
  });

  it('成员项目名与另一组合名冲突 → 报错（三段全局唯一，双向校验）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { backend: '后端服务' } },
      'crm-base': { projects: { 'admin-base': '与组合撞名' } },
    });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('冲突');

    // 反方向：组合名与另一组合的成员项目名冲突
    const rev = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { backend: '后端服务' } },
      backend: { projects: { api: 'API 服务' } },
    });
    expect((await validateTemplateRepo(rev.repoDir, rev.registry)).join('\n')).toContain('冲突');
  });

  it('同组合 projects 数组重复登记成员 → 报错', async () => {
    const { repoDir, registry } = await makeRepo([], {
      'admin-base': { projects: { backend: '后端服务' } },
    });
    // 手工注入重复成员（Record 键唯一，只能直接构造数组重复）
    registry.solutions[0]?.projects.push({ name: 'backend', description: '重复成员' });
    expect((await validateTemplateRepo(repoDir, registry)).join('\n')).toContain('重复登记');
  });
});

describe('scaffoldSolution', () => {
  function solutionRepo() {
    return makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { projects: { backend: '后端服务', frontend: '前端应用' } },
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
