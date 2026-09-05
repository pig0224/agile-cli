import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { cleanAllTemplateCaches, cleanTemplateCache, ensureTemplateRepo, templateCacheDir } from '../src/core/template-registry.js';

/** 用本地 bare repo 做模板源（真实 git 路径，验证缓存/刷新语义） */
function makeSource(tag: string): string {
  const base = fsSync.mkdtempSync(path.join(os.tmpdir(), `agile-tpl-src-${tag}-`));
  const src = path.join(base, 'work');
  const bare = path.join(base, 'tpl.git');
  const g = (cwd: string, cmd: string) => execSync(cmd, { cwd, stdio: 'pipe' });
  g(base, `git init --bare -b main "${bare}"`);
  g(base, `git clone "${bare}" "${src}"`);
  fsSync.writeFileSync(path.join(src, 'registry.yaml'), 'version: 1\ntemplates: {}\n', 'utf8');
  g(src, 'git add .');
  g(src, 'git -c user.email=t@t -c user.name=t commit -m v1');
  g(src, 'git push origin main');
  return bare.replace(/\\/g, '/');
}

function updateSource(bareUrl: string): void {
  const base = path.dirname(bareUrl);
  const src = path.join(base, 'work');
  fsSync.writeFileSync(path.join(src, 'registry.yaml'), 'version: 1\ntemplates: {}\n# updated\n', 'utf8');
  execSync('git add . && git -c user.email=t@t -c user.name=t commit -m v2 && git push origin main', { cwd: src, stdio: 'pipe' });
}

async function cacheHead(url: string): Promise<string> {
  return execSync('git rev-parse HEAD', { cwd: templateCacheDir(url), encoding: 'utf8' }).trim();
}

describe('ensureTemplateRepo 缓存/刷新语义', () => {
  it('默认走缓存：上游更新后不 fetch，拿到旧内容', { timeout: 60_000 }, async () => {
    const url = makeSource('a');
    await ensureTemplateRepo(url); // 首次：clone
    const headV1 = await cacheHead(url);

    updateSource(url); // 上游前进
    await ensureTemplateRepo(url); // 默认：不联网
    expect(await cacheHead(url)).toBe(headV1);
  });

  it('refresh=true：强制 fetch，缓存更新到上游最新', { timeout: 60_000 }, async () => {
    const url = makeSource('b');
    await ensureTemplateRepo(url);
    const headV1 = await cacheHead(url);

    updateSource(url);
    const r = await ensureTemplateRepo(url, { refresh: true });
    expect(r.stale).toBe(false);
    expect(await cacheHead(url)).not.toBe(headV1);
  });

  it('refresh=true 但上游不可达 → 降级用缓存（stale=true）', { timeout: 60_000 }, async () => {
    const url = makeSource('c');
    await ensureTemplateRepo(url);
    // 破坏上游（把 bare 目录移走）
    await fs.rm(path.dirname(url), { recursive: true, force: true });
    const r = await ensureTemplateRepo(url, { refresh: true });
    expect(r.stale).toBe(true);
    // 缓存仍可用
    await expect(fs.readFile(path.join(templateCacheDir(url), 'registry.yaml'), 'utf8')).resolves.toContain('version: 1');
  });

  it('无缓存且上游不可达 → 报错', { timeout: 60_000 }, async () => {
    const url = path.join(os.tmpdir(), `agile-nope-${Date.now()}`, 'tpl.git').replace(/\\/g, '/');
    await expect(ensureTemplateRepo(url)).rejects.toThrow(/克隆失败/);
  });
});

describe('模板缓存清理', () => {
  it('cleanTemplateCache：有缓存 → 删除；再 clean → false；清理后可重新 clone', { timeout: 60_000 }, async () => {
    const url = makeSource('clean-a');
    await ensureTemplateRepo(url); // 产生缓存
    expect(await cleanTemplateCache(url)).toBe(true);
    await expect(fs.stat(path.join(templateCacheDir(url), '.git'))).rejects.toThrow();
    expect(await cleanTemplateCache(url)).toBe(false); // 无缓存
    await ensureTemplateRepo(url); // 清理后自动重新克隆
    await expect(fs.readFile(path.join(templateCacheDir(url), 'registry.yaml'), 'utf8')).resolves.toContain('version: 1');
    await cleanTemplateCache(url); // 收尾清理
  });

  it('cleanAllTemplateCaches：清理全部源副本并返回数量', { timeout: 60_000 }, async () => {
    const url1 = makeSource('clean-b1');
    const url2 = makeSource('clean-b2');
    await ensureTemplateRepo(url1);
    await ensureTemplateRepo(url2);
    const cleaned = await cleanAllTemplateCaches();
    expect(cleaned).toBeGreaterThanOrEqual(2);
    await expect(fs.stat(templateCacheDir(url1))).rejects.toThrow();
    await expect(fs.stat(templateCacheDir(url2))).rejects.toThrow();
  });
});
