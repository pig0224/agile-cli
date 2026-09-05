import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { syncWorkspace } from '../src/core/sync.js';
import { loadSettings } from '../src/core/config.js';
import type { Settings } from '../src/core/schemas.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-sync-'));
}

/** 用本地 bare 仓库做外部源（真实 git 路径，验证 clone/拉取语义） */
function makeSource(tag: string, files: Record<string, string>): string {
  const base = fsSync.mkdtempSync(path.join(os.tmpdir(), `agile-sync-src-${tag}-`));
  const src = path.join(base, 'work');
  const bare = path.join(base, 'src.git');
  const g = (cwd: string, cmd: string) => execSync(cmd, { cwd, stdio: 'pipe' });
  g(base, `git init --bare -b main "${bare}"`);
  g(base, `git clone "${bare}" "${src}"`);
  for (const [name, content] of Object.entries(files)) {
    fsSync.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    fsSync.writeFileSync(path.join(src, name), content, 'utf8');
  }
  g(src, 'git add .');
  g(src, 'git -c user.email=t@t -c user.name=t commit -m v1');
  g(src, 'git push origin main');
  return bare;
}

/** 上游前进一个 commit（改写全部文件内容） */
function updateSource(bare: string, files: Record<string, string>): void {
  const src = path.join(path.dirname(bare), 'work');
  for (const [name, content] of Object.entries(files)) {
    fsSync.writeFileSync(path.join(src, name), content, 'utf8');
  }
  execSync('git add . && git -c user.email=t@t -c user.name=t commit -m v2 && git push origin main', { cwd: src, stdio: 'pipe' });
}

/** 模板源共享一个（ensureTemplateRepo 按源缓存，refresh 走 fetch+reset）；
 *  模板缓存根重定向到独立临时目录——避免与其他测试文件（template-cache.test 的全量清理）并发互踩 */
process.env.AGILE_TEMPLATE_CACHE_ROOT = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agile-sync-tplcache-'));

let tplUrl: string | undefined;
const templateSource = () => (tplUrl ??= makeSource('tpl', { 'registry.yaml': 'version: 1\ntemplates: {}\n' }));

async function makeWorkspace(repos: Settings['repos'] = {}): Promise<string> {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, '.agile'), { recursive: true });
  const settings = {
    version: 1,
    name: 't',
    created: '2026-01-01',
    repos,
    plugins: {},
    templates: { registry: templateSource() },
  };
  await fs.writeFile(path.join(dir, '.agile', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  return dir;
}

const stepOf = (steps: { name: string; status: string; detail: string }[], name: string) => steps.find((s) => s.name.startsWith(name));

describe('syncWorkspace：外部仓库槽位', () => {
  it('未配置仓库地址 → skipped 并提示 config set', { timeout: 60_000 }, async () => {
    const dir = await makeWorkspace();
    const steps = await syncWorkspace(dir, await loadSettings(dir));
    const step = stepOf(steps, 'tech-specs');
    expect(step?.status).toBe('skipped');
    expect(step?.detail).toContain('agile config set tech-specs');
  });

  it('骨架目录在父仓内（workspace 已 git init）→ 仍判定非仓并让位 clone', { timeout: 60_000 }, async () => {
    // 回归：rev-parse --git-dir/--show-toplevel 会向上继承父仓，
    // 若只判「是 git 仓库」会把 init workspace 的抽屉骨架误判为 dirty 仓库而跳过 clone
    const src = makeSource('nested', { 'README.md': '# spec v9\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src } });
    await fs.mkdir(path.join(dir, 'tech-specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tech-specs', 'README.md'), '# skeleton\n', 'utf8');
    // 模拟 init workspace：根目录是 git 仓库且骨架已入版本管理
    execSync('git init -b main && git add . && git -c user.email=t@t -c user.name=t commit -m init', { cwd: dir, stdio: 'pipe' });

    const steps = await syncWorkspace(dir, await loadSettings(dir));
    expect(stepOf(steps, 'tech-specs')?.status).toBe('done');
    expect(await fs.readFile(path.join(dir, 'tech-specs', 'README.md'), 'utf8')).toBe('# spec v9\n');
  });

  it('首次 sync：clone 落地（骨架目录让位）', { timeout: 60_000 }, async () => {
    const src = makeSource('clone', { 'README.md': '# spec v1\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src } });
    // init 留下的骨架目录（仅 README.md）→ 自动让位
    await fs.mkdir(path.join(dir, 'tech-specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tech-specs', 'README.md'), '# 抽屉一\n', 'utf8');

    const steps = await syncWorkspace(dir, await loadSettings(dir));
    expect(stepOf(steps, 'tech-specs')?.status).toBe('done');
    expect(await fs.readFile(path.join(dir, 'tech-specs', 'README.md'), 'utf8')).toContain('spec v1');
  });

  it('非空非 git 目录 → failed 不动', { timeout: 60_000 }, async () => {
    const src = makeSource('blocked', { 'README.md': 'x\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src } });
    await fs.mkdir(path.join(dir, 'tech-specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tech-specs', 'a.txt'), 'user content', 'utf8');

    const steps = await syncWorkspace(dir, await loadSettings(dir));
    const step = stepOf(steps, 'tech-specs');
    expect(step?.status).toBe('failed');
    expect(await fs.readFile(path.join(dir, 'tech-specs', 'a.txt'), 'utf8')).toBe('user content');
  });

  it('二次 sync：ff-only 无变化 done；上游前进后拉到最新', { timeout: 60_000 }, async () => {
    const src = makeSource('ff', { 'README.md': 'v1\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src } });
    const load = () => import('../src/core/config.js').then((m) => m.loadSettings(dir));

    await syncWorkspace(dir, await load());
    const again = await syncWorkspace(dir, await load());
    expect(stepOf(again, 'tech-specs')?.status).toBe('done');

    updateSource(src, { 'README.md': 'v2\n' });
    const third = await syncWorkspace(dir, await load());
    expect(stepOf(third, 'tech-specs')?.status).toBe('done');
    expect(await fs.readFile(path.join(dir, 'tech-specs', 'README.md'), 'utf8')).toBe('v2\n');
  });

  it('本地有未提交改动 → warn 跳过，绝不覆盖', { timeout: 60_000 }, async () => {
    const src = makeSource('dirty', { 'README.md': 'remote\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src } });
    const load = () => import('../src/core/config.js').then((m) => m.loadSettings(dir));
    await syncWorkspace(dir, await load());

    const readme = path.join(dir, 'tech-specs', 'README.md');
    await fs.writeFile(readme, 'local draft\n', 'utf8');
    updateSource(src, { 'README.md': 'remote v2\n' });

    const steps = await syncWorkspace(dir, await load());
    const step = stepOf(steps, 'tech-specs');
    expect(step?.status).toBe('warn');
    expect(await fs.readFile(readme, 'utf8')).toBe('local draft\n');
  });

  it('dryRun：只出计划不落盘', { timeout: 60_000 }, async () => {
    const src = makeSource('dry', { 'README.md': 'v1\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src } });
    const steps = await syncWorkspace(dir, await loadSettings(dir), { dryRun: true });
    const step = stepOf(steps, 'tech-specs');
    expect(step?.status).toBe('skipped');
    expect(step?.detail).toContain('dry-run');
    await expect(fs.stat(path.join(dir, 'tech-specs'))).rejects.toThrow();
  });

  it('声明 ref 版本锁定 → 追加 warn（锁定暂未实现）但不阻断拉取', { timeout: 60_000 }, async () => {
    const src = makeSource('ref', { 'README.md': 'v1\n' });
    const dir = await makeWorkspace({ techSpecs: { url: src, ref: 'v1' } });
    const steps = await syncWorkspace(dir, await loadSettings(dir));
    expect(stepOf(steps, 'tech-specs')?.status).toBe('done');
    expect(steps.filter((s) => s.name.startsWith('tech-specs') && s.status === 'warn').length).toBe(1);
    expect(await fs.stat(path.join(dir, 'tech-specs', 'README.md'))).toBeTruthy();
  });
});

describe('syncWorkspace：模板与插件步骤', () => {
  it('模板刷新走本地 bare 源；插件无声明 skipped', { timeout: 60_000 }, async () => {
    const dir = await makeWorkspace();
    const steps = await syncWorkspace(dir, await loadSettings(dir));
    expect(stepOf(steps, 'templates')?.status).toBe('done');
    expect(stepOf(steps, '插件')?.status).toBe('skipped');
  });
});
