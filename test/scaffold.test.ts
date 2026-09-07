import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyAndSubstitute } from '../src/core/scaffold.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-copy-'));
}

/** 产物目录全集（与 copyAndSubstitute 的 ARTIFACT_NAMES 目录项一致） */
const ARTIFACT_DIRS = ['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', '.turbo', '.vitest'];
const JUNK_FILES = ['.DS_Store', 'Thumbs.db'];
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

/** 创建符号链接：Windows 用 junction（无需管理员权限、只指向目录），类 Unix 用 dir symlink（CI ubuntu） */
function makeDirLink(target: string, linkPath: string): void {
  if (process.platform === 'win32') {
    fsSync.symlinkSync(target, linkPath, 'junction');
  } else {
    fsSync.symlinkSync(target, linkPath, 'dir');
  }
}

/**
 * 造一个「真实模板」目录：正常文件（文本/二进制/{{safeName}} 目录）+ 全套产物目录 +
 * node_modules 内一个指向外部目录的 junction（复现 pnpm install 后的模板仓形态）。
 */
async function makeTemplate(dir: string, external: string): Promise<void> {
  // 正常文件
  await fs.writeFile(path.join(dir, 'README.md'), '# {{name}}', 'utf8');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '{{name}}' }), 'utf8');
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.mkdir(path.join(dir, 'src', 'com', 'example', '{{safeName}}'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'com', 'example', '{{safeName}}', 'App.java'), 'package com.example.{{safeName}};', 'utf8');
  // 产物目录（各放 marker，断言不进入生成物）
  for (const d of ARTIFACT_DIRS) {
    await fs.mkdir(path.join(dir, d), { recursive: true });
    await fs.writeFile(path.join(dir, d, 'artifact-marker.txt'), 'should not be copied', 'utf8');
  }
  // node_modules 内 junction → 外部目录（pnpm 形态；当前 walker 对其 readFile 即 EISDIR）
  await fs.writeFile(path.join(external, 'real.txt'), 'external package content', 'utf8');
  makeDirLink(external, path.join(dir, 'node_modules', 'left-pad'));
  // 顶层 junction（防御名字不在清单里的链接）
  makeDirLink(external, path.join(dir, 'linked-tpl'));
  // 系统垃圾文件 + 锁文件
  for (const f of JUNK_FILES) await fs.writeFile(path.join(dir, f), 'junk', 'utf8');
  for (const f of LOCKFILES) await fs.writeFile(path.join(dir, f), 'lockfile content', 'utf8');
}

describe('copyAndSubstitute（模板复制 walker：产物忽略 + 符号链接防御）', () => {
  it('忽略安装/构建产物整树；node_modules 内 junction 不触发 EISDIR；正常文件与占位符替换不受影响', async () => {
    const [src, dest, external] = [await tmp(), await tmp(), await tmp()];
    await makeTemplate(src, external);

    const { notices, files } = await copyAndSubstitute(src, path.join(dest, 'proj'), { '{{name}}': 'Order-Service', '{{safeName}}': 'orderservice' });

    // 生成物：正常文件齐全且已替换
    expect(await fs.readFile(path.join(dest, 'proj', 'README.md'), 'utf8')).toBe('# Order-Service');
    expect(await fs.readFile(path.join(dest, 'proj', 'package.json'), 'utf8')).toContain('Order-Service');
    expect(await fs.readFile(path.join(dest, 'proj', 'assets', 'logo.png'))).toBeTruthy();
    expect(
      await fs.readFile(path.join(dest, 'proj', 'src', 'com', 'example', 'orderservice', 'App.java'), 'utf8'),
    ).toBe('package com.example.orderservice;');
    // 生成物：产物整树与链接/锁文件均未进入
    for (const d of [...ARTIFACT_DIRS, 'linked-tpl', ...LOCKFILES, ...JUNK_FILES]) {
      await expect(fs.stat(path.join(dest, 'proj', d))).rejects.toThrow();
    }
    await expect(fs.stat(path.join(dest, 'proj', 'node_modules', 'left-pad'))).rejects.toThrow();
    // 忽略通知：每个被忽略的顶层条目一条（不逐文件刷屏）
    const paths = notices.map((n) => n.path).sort();
    expect(paths).toEqual(
      [...ARTIFACT_DIRS, 'linked-tpl', ...JUNK_FILES, ...LOCKFILES].map((n) => n).sort(),
    );
    expect(notices.find((n) => n.path === 'node_modules')?.reason).toBe('artifact');
    expect(notices.find((n) => n.path === 'linked-tpl')?.reason).toBe('symlink');
    expect(notices.find((n) => n.path === 'pnpm-lock.yaml')?.reason).toBe('lockfile');
    // 已复制文件清单（替换后的落地相对路径，供生成清单记录）
    expect(files).toEqual([
      'README.md',
      'assets/logo.png',
      'package.json',
      'src/com/example/orderservice/App.java',
    ]);
  });

  it('keepLockfiles 开关：锁文件恢复复制语义且不产生通知', async () => {
    const [src, dest, external] = [await tmp(), await tmp(), await tmp()];
    await makeTemplate(src, external);

    const { notices } = await copyAndSubstitute(src, path.join(dest, 'proj'), { '{{name}}': 'x' }, { keepLockfiles: true });

    for (const f of LOCKFILES) {
      expect(await fs.readFile(path.join(dest, 'proj', f), 'utf8')).toBe('lockfile content');
    }
    expect(notices.find((n) => n.reason === 'lockfile')).toBeUndefined();
    // 产物目录与链接仍被忽略（开关只作用于锁文件）
    await expect(fs.stat(path.join(dest, 'proj', 'node_modules'))).rejects.toThrow();
  });

  it('深层次级目录的产物同样整树跳过（src/ 下的 node_modules）', async () => {
    const [src, dest] = [await tmp(), await tmp()];
    await fs.writeFile(path.join(src, 'index.js'), 'ok', 'utf8');
    await fs.mkdir(path.join(src, 'src', 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(src, 'src', 'node_modules', 'dep', 'm.js'), 'no', 'utf8');

    const { notices } = await copyAndSubstitute(src, path.join(dest, 'proj'), {});

    expect(await fs.readFile(path.join(dest, 'proj', 'index.js'), 'utf8')).toBe('ok');
    await expect(fs.stat(path.join(dest, 'proj', 'src', 'node_modules'))).rejects.toThrow();
    expect(notices.map((n) => n.path)).toEqual(['src/node_modules']);
  });
});
