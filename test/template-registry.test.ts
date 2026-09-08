import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseJson } from '../src/core/config.js';
import {
  loadTemplates,
  scaffoldFromTemplate,
  scaffoldSolution,
  solutionListRows,
  templateCacheDir,
  validateTemplateRepo,
  TEMPLATE_NAME_RE,
  TemplateRegistrySchema,
  type SolutionEntry,
  type TemplateRegistry,
} from '../src/core/template-registry.js';
import { cliVersion } from '../src/version.js';
import {
  deleteProjectManifest,
  listActualFiles,
  readProjectManifest,
} from '../src/core/manifest.js';

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

describe('loadTemplates registry 版本门禁与升级提示（旧版布局/未来 v3 的通用出路）', () => {
  /** 最小 fixture：本地直读目录（含 registry.json + 一个成员目录） */
  async function registryRepo(content: string): Promise<string> {
    const repoDir = await tmp();
    await fs.writeFile(path.join(repoDir, 'registry.json'), content, 'utf8');
    await writePkgPlaceholder(path.join(repoDir, 'singles', 'vue3-vite'));
    return repoDir;
  }
  const v2Body = { singles: [{ name: 'vue3-vite', description: 'Vue 3 前端' }] };

  it('version 高于支持（v3）→ 门禁文案：registry 为 v3 布局 + 当前 CLI 版本 + 升级命令，退出路径为 AgileError', async () => {
    const repoDir = await registryRepo(JSON.stringify({ version: 3, ...v2Body }));
    await expect(loadTemplates(repoDir)).rejects.toThrow(
      new RegExp(`注册中心为 v3 布局.*当前 CLI ${cliVersion}.*npm i -g fcc-agile-cli`, 's'),
    );
  });

  it('version 低于支持 → 同一门禁（统一文案，指明仅支持 v2）', async () => {
    const repoDir = await registryRepo(JSON.stringify({ version: 1, ...v2Body }));
    await expect(loadTemplates(repoDir)).rejects.toThrow(/注册中心为 v1 布局.*仅支持 v2/s);
  });

  it('解析失败（坏 JSON）→ 错误信息附当前 CLI 版本与升级命令', async () => {
    const repoDir = await registryRepo('{ not json');
    await expect(loadTemplates(repoDir)).rejects.toThrow(
      new RegExp(`不是合法的 JSON[\\s\\S]*当前 CLI ${cliVersion}.*npm i -g fcc-agile-cli`),
    );
  });

  it('schema 校验失败（singles 缺 description）→ 同样附当前 CLI 版本与升级命令', async () => {
    const repoDir = await registryRepo(JSON.stringify({ version: 2, singles: [{ name: 'vue3-vite' }] }));
    await expect(loadTemplates(repoDir)).rejects.toThrow(
      new RegExp(`格式校验失败[\\s\\S]*当前 CLI ${cliVersion}.*npm i -g fcc-agile-cli`),
    );
  });

  it('回归：合法 v2 registry 加载行为不变（issues 为空、registry 内容透传）', async () => {
    const repoDir = await registryRepo(JSON.stringify({ version: 2, ...v2Body }));
    const { registry, issues } = await loadTemplates(repoDir);
    expect(registry.version).toBe(2);
    expect(registry.singles).toHaveLength(1);
    expect(issues).toEqual([]);
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

  it('description 空白 / projects 空数组 / language 空数组 / 非法 JSON → 报错；version 非 2 由 loadTemplates 门禁处理（schema 只要求整数）', () => {
    // version 1/3 在 loadTemplates 层给出「升级出路」门禁（见 loadTemplates describe），schema 层宽进只拦非法形态
    expect(() => parse('{"version":1}')).not.toThrow();
    expect(() => parse('{"version":2.5}')).toThrow(/校验失败/);
    expect(() => parse('{"version":"2"}')).toThrow(/校验失败/);
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

  it('幽灵单例目录（singles/ 下目录未登记）→ 报错；点开头目录豁免', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }]);
    await writePkgPlaceholder(path.join(repoDir, 'singles', 'ghost-single'));
    await fs.mkdir(path.join(repoDir, 'singles', '.staging'), { recursive: true });
    const issues = await validateTemplateRepo(repoDir, registry);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('singles/ghost-single/ 未登记');
  });
});

describe('scaffoldFromTemplate', () => {
  it('占位符替换（{{name}}/{{safeName}} = 实际落地目录名 basename(target)）', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'java-springboot' }]);
    // 造含占位符的目录结构
    const pkgDir = path.join(repoDir, 'singles', 'java-springboot', 'src', 'com', 'example', '{{safeName}}');
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, 'App.java'), 'package com.example.{{safeName}}; // {{name}}', 'utf8');

    // target ≠ 模板名：{{name}} 跟随实际落地目录名（--name 覆盖形态）
    const target = path.join(await tmp(), 'projects', 'order-service');
    await scaffoldFromTemplate(repoDir, 'java-springboot', target, registry);

    const generated = path.join(target, 'src', 'com', 'example', 'orderservice', 'App.java');
    const content = await fs.readFile(generated, 'utf8');
    expect(content).toBe('package com.example.orderservice; // order-service');
    const pkg = await fs.readFile(path.join(target, 'package.json'), 'utf8');
    expect(pkg).toContain('"name":"order-service"');
    expect(pkg).toContain('"pkg":"orderservice"');
  });

  it('模板不存在 → 抛错', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }]);
    const target = path.join(await tmp(), 'projects', 'app');
    await expect(scaffoldFromTemplate(repoDir, 'nope', target, registry)).rejects.toThrow(/模板不存在/);
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

  it('组合根 docs/（耦合资产目录）+ CLAUDE.md 不算幽灵成员——反向一致校验豁免', async () => {
    const { repoDir, registry } = await makeRepo([{ name: 'vue3-vite' }], {
      'admin-base': { projects: { backend: '后端服务' } },
    });
    const docsDir = path.join(repoDir, 'solutions', 'admin-base', 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'api-conventions.md'), '# API 约定', 'utf8');
    await fs.writeFile(path.join(repoDir, 'solutions', 'admin-base', 'CLAUDE.md'), '# 组合导航', 'utf8');
    expect(await validateTemplateRepo(repoDir, registry)).toEqual([]);
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

describe('scaffoldSolution 生成清单（断点续建防护）', () => {
  function solutionRepo() {
    return makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { projects: { backend: '后端服务', frontend: '前端应用' } },
    });
  }

  async function workspace() {
    const ws = await tmp();
    return { ws, projectsRoot: path.join(ws, 'projects') };
  }

  it('首次生成写 manifest：来源/成员原名/落地目录/文件清单/生成时间，文件清单与实际一致', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    // 上次崩溃可能残留的临时目录 → 生成前清扫
    await fs.mkdir(path.join(projectsRoot, '.tmp-backend-stale'), { recursive: true });
    await fs.writeFile(path.join(projectsRoot, '.tmp-backend-stale', 'junk.txt'), 'x', 'utf8');

    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });

    expect(result.created).toEqual(['backend', 'frontend']);
    const m = await readProjectManifest(ws, 'backend');
    expect(m).toMatchObject({ version: 1, source: 'admin-base', member: 'backend', dirName: 'backend' });
    expect(m?.files).toEqual(await listActualFiles(path.join(projectsRoot, 'backend')));
    expect(m?.files).toContain('package.json');
    expect(m?.templateCommit).toBeNull(); // fixture 非 git 仓，取不到 commit 置空
    expect(Number.isNaN(new Date(m!.generatedAt).getTime())).toBe(false);
    // 残留临时目录已被清扫
    expect((await fs.readdir(projectsRoot)).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
  });

  it('完整重跑 → 清单比对一致 → 跳过（补缺语义不抛错）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    const second = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(['backend', 'frontend']);
  });

  it('生成物缺文件后重跑 → 硬错误（缺 N 文件，提示删除目录后重跑）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    // 模板多放一个文件：删 package.json 后目录仍非空（否则命中空目录放行语义，重跑=重新生成而非报错）
    await fs.writeFile(path.join(repoDir, 'solutions', 'admin-base', 'backend', 'README.md'), '# backend', 'utf8');
    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    await fs.rm(path.join(projectsRoot, 'backend', 'package.json'));
    await expect(
      scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws }),
    ).rejects.toThrow(/projects\/backend 与生成清单不符（缺 1 文件 \/ 多 0 项）.*删除该目录后重跑/s);
  });

  it('生成物多出文件后重跑 → 硬错误（多 N 项）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    await fs.writeFile(path.join(projectsRoot, 'backend', 'extra.txt'), 'x', 'utf8');
    await expect(
      scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws }),
    ).rejects.toThrow(/projects\/backend 与生成清单不符（缺 0 文件 \/ 多 1 项）/);
  });

  it('无 manifest 陌生目录重跑 → 维持跳过 + warn（向后兼容，不升级为错误）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    await deleteProjectManifest(ws, 'backend');
    const second = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(['backend', 'frontend']);
  });

  it('空目录占位（手工 mkdir）→ 放行生成（created 含该成员，目录被模板填充）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    await fs.mkdir(path.join(projectsRoot, 'backend'), { recursive: true }); // 空目录，无内容损失

    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });

    expect(result.created).toEqual(['backend', 'frontend']);
    expect(await fs.readFile(path.join(projectsRoot, 'backend', 'package.json'), 'utf8')).toContain('"name":"backend"');
    expect((await readProjectManifest(ws, 'backend'))?.files).toEqual(
      await listActualFiles(path.join(projectsRoot, 'backend')),
    );
  });

  it('事务性：后一成员目标被文件占用 → 报错且回滚本次新建成员（无残缺、无 .tmp 残留）；排除障碍后重跑成功', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    await fs.mkdir(projectsRoot, { recursive: true });
    await fs.writeFile(path.join(projectsRoot, 'frontend'), 'occupied', 'utf8'); // 非目录占用目标路径

    await expect(
      scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws }),
    ).rejects.toThrow(/不是目录/);
    // 本次运行已生成的 backend 被回滚，不留残缺
    await expect(fs.stat(path.join(projectsRoot, 'backend'))).rejects.toThrow();
    await expect(fs.stat(path.join(ws, '.agile', 'manifests', 'backend.json'))).rejects.toThrow();
    expect(await fs.readFile(path.join(projectsRoot, 'frontend'), 'utf8')).toBe('occupied');
    expect((await fs.readdir(projectsRoot)).filter((n) => n.startsWith('.tmp-'))).toEqual([]);

    await fs.rm(path.join(projectsRoot, 'frontend'));
    const second = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    expect(second.created).toEqual(['backend', 'frontend']);
  });

  it('未传 workspaceRoot → 不写 manifest（清单能力显式启用）', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();
    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot);
    expect(result.created).toEqual(['backend', 'frontend']);
    await expect(fs.stat(path.join(ws, '.agile'))).rejects.toThrow();
  });
});

describe('scaffoldSolution 组合根耦合资产带出（.agile/solutions/<组合>/）', () => {
  function solutionRepo() {
    return makeRepo([{ name: 'vue3-vite' }, { name: 'go-service' }], {
      'admin-base': { projects: { backend: '后端服务', frontend: '前端应用' } },
    });
  }

  /** 给组合根写耦合资产：CLAUDE.md + docs/（tech/product 各一篇，frontmatter 类型决定知识同步去向） */
  async function writeComboAssets(repoDir: string): Promise<void> {
    const docsDir = path.join(repoDir, 'solutions', 'admin-base', 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(repoDir, 'solutions', 'admin-base', 'CLAUDE.md'),
      '# admin-base 组合导航\n\n成员：backend / frontend。耦合约定见 docs/。\n',
      'utf8',
    );
    await fs.writeFile(path.join(docsDir, 'api-conventions.md'), '---\n类型: tech\n---\n\n# API 约定\n', 'utf8');
    await fs.writeFile(path.join(docsDir, 'ui-spec.md'), '---\n类型: product\n---\n\n# UI 规范\n', 'utf8');
  }

  async function workspace() {
    const ws = await tmp();
    return { ws, projectsRoot: path.join(ws, 'projects') };
  }

  it('首次生成带出到 .agile/solutions/<组合>/（CLAUDE.md + docs/，不替换占位符，不混入成员目录）', async () => {
    const { repoDir, registry } = await solutionRepo();
    await writeComboAssets(repoDir);
    const { ws, projectsRoot } = await workspace();

    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });

    expect(result.comboAssets).toEqual({ present: true, copied: true, files: 3 });
    const cm = await fs.readFile(path.join(ws, '.agile', 'solutions', 'admin-base', 'CLAUDE.md'), 'utf8');
    expect(cm).toContain('admin-base 组合导航');
    const tech = await fs.readFile(
      path.join(ws, '.agile', 'solutions', 'admin-base', 'docs', 'api-conventions.md'),
      'utf8',
    );
    expect(tech).toContain('类型: tech');
    // 快照只含组合根两个耦合路径，成员目录不混入
    expect(await fs.readdir(path.join(ws, '.agile', 'solutions', 'admin-base'))).toEqual(['CLAUDE.md', 'docs']);
  });

  it('重跑（补缺）快照已存在 → present=true / copied=false，人工改动不被覆盖', async () => {
    const { repoDir, registry } = await solutionRepo();
    await writeComboAssets(repoDir);
    const { ws, projectsRoot } = await workspace();
    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });

    const manual = path.join(ws, '.agile', 'solutions', 'admin-base', 'docs', 'api-conventions.md');
    await fs.writeFile(manual, '---\n类型: tech\n---\n\n# 本地演进版\n', 'utf8');

    const second = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });
    expect(second.comboAssets).toEqual({ present: true, copied: false, files: 0 });
    expect(await fs.readFile(manual, 'utf8')).toContain('本地演进版');
  });

  it('无耦合资产的组合（旧版模板）→ present=false，不创建 .agile/solutions', async () => {
    const { repoDir, registry } = await solutionRepo();
    const { ws, projectsRoot } = await workspace();

    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, {}, { workspaceRoot: ws });

    expect(result.comboAssets).toEqual({ present: false, copied: false, files: 0 });
    await expect(fs.stat(path.join(ws, '.agile', 'solutions'))).rejects.toThrow();
  });

  it('未传 workspaceRoot → comboAssets=null（带出能力随清单能力显式启用）', async () => {
    const { repoDir, registry } = await solutionRepo();
    await writeComboAssets(repoDir);
    const projectsRoot = await tmp();

    const result = await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot);
    expect(result.comboAssets).toBeNull();
  });

  it('overrides 覆盖目录名不影响快照路径（快照按组合名落盘，与成员目录名无关）', async () => {
    const { repoDir, registry } = await solutionRepo();
    await writeComboAssets(repoDir);
    const { ws, projectsRoot } = await workspace();

    await scaffoldSolution(repoDir, registry, 'admin-base', projectsRoot, { backend: 'admin-backend' }, { workspaceRoot: ws });

    expect(
      await fs.stat(path.join(ws, '.agile', 'solutions', 'admin-base', 'CLAUDE.md')),
    ).toBeTruthy();
    await expect(fs.stat(path.join(ws, '.agile', 'solutions', 'admin-backend'))).rejects.toThrow();
  });
});

describe('scaffoldFromTemplate 生成清单（单例模板重跑防护）', () => {
  async function javaRepo() {
    const repo = await makeRepo([{ name: 'java-springboot' }]);
    const pkgDir = path.join(repo.repoDir, 'singles', 'java-springboot', 'src', 'com', 'example', '{{safeName}}');
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, 'App.java'), 'package com.example.{{safeName}};', 'utf8');
    return repo;
  }

  it('首次生成写 manifest（source=member=模板名，清单文件按 basename(target) 命名）；完整重跑报目录已存在；缺文件重跑报清单不符（唯一出路 = 删除目录重跑）', async () => {
    const { repoDir, registry } = await javaRepo();
    const ws = await tmp();
    const target = path.join(ws, 'projects', 'order-service'); // 目录名 ≠ 模板名（--name 覆盖形态）
    const opts = { workspaceRoot: ws };

    await scaffoldFromTemplate(repoDir, 'java-springboot', target, registry, opts);
    const m = await readProjectManifest(ws, 'order-service'); // 清单文件名 = basename(target)
    expect(m?.source).toBe('java-springboot');
    expect(m?.member).toBe('java-springboot'); // 单例 member = 模板名
    expect(m?.dirName).toBe('order-service');
    expect(m?.files).toEqual(await listActualFiles(target));

    await expect(
      scaffoldFromTemplate(repoDir, 'java-springboot', target, registry, opts),
    ).rejects.toThrow(/目录已存在/);

    await fs.rm(path.join(target, 'package.json'));
    await expect(
      scaffoldFromTemplate(repoDir, 'java-springboot', target, registry, opts),
    ).rejects.toThrow(/与生成清单不符.*删除该目录后重跑/s);
  });

  it('空目录占位 → 放行生成；非空陌生目录（无清单）重跑报目录已存在且内容保留', async () => {
    const { repoDir, registry } = await javaRepo();
    const ws = await tmp();
    const target = path.join(ws, 'projects', 'order-service');

    await fs.mkdir(target, { recursive: true }); // 空目录占位
    await scaffoldFromTemplate(repoDir, 'java-springboot', target, registry, { workspaceRoot: ws });
    expect(await fs.readFile(path.join(target, 'package.json'), 'utf8')).toContain('"name":"order-service"');

    // 非空陌生目录（手工文件、无清单）：报目录已存在，内容不被改动
    const stranger = path.join(ws, 'projects', 'handwritten');
    await fs.mkdir(stranger, { recursive: true });
    await fs.writeFile(path.join(stranger, 'handwritten.txt'), 'user code', 'utf8');
    await expect(
      scaffoldFromTemplate(repoDir, 'java-springboot', stranger, registry, { workspaceRoot: ws }),
    ).rejects.toThrow(/目录已存在/);
    expect(await fs.readFile(path.join(stranger, 'handwritten.txt'), 'utf8')).toBe('user code');
  });
});

describe('solutionListRows（template list 组合段行布局：树形多行 + ASCII 装饰）', () => {
  it('solution 行 padEnd(18)；成员行按段内成员名最大宽对齐；顺序 = projects 数组顺序（不排序）', () => {
    const solutions: SolutionEntry[] = [
      {
        name: 'pig-saas',
        description: 'SaaS 底座',
        projects: [
          { name: 'mock', description: '共享 Mock 接口（Next.js API Routes），中英双语 description 混排 English words' },
          { name: 'landing', description: '营销站' },
          { name: 'console', description: '控制台' },
        ],
      },
      {
        name: 'admin-base',
        description: '通用后台',
        projects: [
          { name: 'backend-admin-service', description: '后端（最长成员名，决定对齐宽）' },
          { name: 'frontend', description: '前端' },
        ],
      },
    ];
    const rows = solutionListRows(solutions);
    // 结构与顺序：solution 行 → 依 projects 数组顺序的成员行，组合之间不重排
    expect(rows.map((r) => r.kind)).toEqual(['solution', 'member', 'member', 'member', 'solution', 'member', 'member']);
    // solution 行：padEnd(18)（与单例段同列宽起头）
    expect(rows[0]).toEqual({ kind: 'solution', name: 'pig-saas'.padEnd(18), description: 'SaaS 底座' });
    // 成员行对齐宽 = 段内成员名最大长度（backend-admin-service = 21）+ 4 间距；与 description 长度/中英混排无关
    expect(rows[1]?.name).toBe('mock'.padEnd(25));
    expect(rows[4]).toEqual({ kind: 'solution', name: 'admin-base'.padEnd(18), description: '通用后台' });
    expect(rows[5]?.name).toBe('backend-admin-service'.padEnd(25));
    expect(rows[6]?.name).toBe('frontend'.padEnd(25));
  });

  it('输出快照（树形多行）：缩进 + ASCII 装饰（无 box-drawing 字符），description 长度不影响列对齐', () => {
    const pig: SolutionEntry = {
      name: 'pig-saas',
      description: 'SaaS 双面应用前端底座：营销站 + 控制台 + 共享 Mock 接口（Next.js，中英双语 SSR）',
      projects: [
        { name: 'pig-saas-mock', description: '共享 Mock 接口服务（Next.js API Routes + /themes 主题包目录），可整体移除换真实接口' },
        { name: 'pig-saas-landing', description: 'SaaS 营销站（Next.js SSR + shadcn/ui + next-intl 双语路径前缀路由）' },
        { name: 'pig-saas-console', description: 'SaaS 控制台（Next.js SSR + shadcn/ui + next-intl 双语路径前缀路由）' },
      ],
    };
    // 渲染形态 = 命令层着色前的纯文本（缩进/装饰前缀由命令层拼接，此处锁定版式契约）
    const rendered = solutionListRows([pig]).map((r) =>
      r.kind === 'solution' ? `  ${r.name}${r.description}` : `    - ${r.name}${r.description}`,
    );
    expect(rendered).toEqual([
      '  pig-saas          SaaS 双面应用前端底座：营销站 + 控制台 + 共享 Mock 接口（Next.js，中英双语 SSR）',
      '    - pig-saas-mock       共享 Mock 接口服务（Next.js API Routes + /themes 主题包目录），可整体移除换真实接口',
      '    - pig-saas-landing    SaaS 营销站（Next.js SSR + shadcn/ui + next-intl 双语路径前缀路由）',
      '    - pig-saas-console    SaaS 控制台（Next.js SSR + shadcn/ui + next-intl 双语路径前缀路由）',
    ]);
  });
});
