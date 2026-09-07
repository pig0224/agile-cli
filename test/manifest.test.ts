import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ProjectManifestSchema,
  compareFiles,
  deleteProjectManifest,
  listActualFiles,
  manifestPath,
  readProjectManifest,
  writeProjectManifest,
} from '../src/core/manifest.js';

function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agile-manifest-'));
}

const sample = {
  version: 1 as const,
  source: 'admin-base',
  member: 'backend',
  dirName: 'backend',
  files: ['README.md', 'src/index.ts'],
  generatedAt: '2026-09-07T00:00:00.000Z',
  templateCommit: null,
};

describe('项目生成清单（manifest）', () => {
  it('写入后可读回，字段一致；路径 = .agile/manifests/<目录名>.json', async () => {
    const ws = await tmp();
    await writeProjectManifest(ws, sample);
    expect(manifestPath(ws, 'backend')).toBe(path.join(ws, '.agile', 'manifests', 'backend.json'));
    expect(await readProjectManifest(ws, 'backend')).toEqual(sample);
  });

  it('缺失 / 损坏 JSON / 结构不合法 → null（按陌生目录处理，向后兼容既有 workspace）', async () => {
    const ws = await tmp();
    expect(await readProjectManifest(ws, 'ghost')).toBeNull();
    await writeProjectManifest(ws, sample);
    await fs.writeFile(manifestPath(ws, 'backend'), '{not json', 'utf8');
    expect(await readProjectManifest(ws, 'backend')).toBeNull();
    await fs.writeFile(manifestPath(ws, 'backend'), JSON.stringify({ version: 1, source: 'x' }), 'utf8');
    expect(await readProjectManifest(ws, 'backend')).toBeNull();
  });

  it('未知字段被剥离（向前兼容）；templateCommit 可为字符串', async () => {
    const ws = await tmp();
    await writeProjectManifest(ws, { ...sample, templateCommit: 'abc1234', extra: 'future' } as never);
    const m = await readProjectManifest(ws, 'backend');
    expect(m?.templateCommit).toBe('abc1234');
    expect(m !== null && 'extra' in m).toBe(false);
  });

  it('deleteProjectManifest 删除清单（回滚用），可重复调用', async () => {
    const ws = await tmp();
    await writeProjectManifest(ws, sample);
    await deleteProjectManifest(ws, 'backend');
    expect(await readProjectManifest(ws, 'backend')).toBeNull();
    await expect(deleteProjectManifest(ws, 'backend')).resolves.toBeUndefined();
  });
});

describe('listActualFiles / compareFiles（完整性三态比对）', () => {
  it('递归列出目标目录文件（/ 分隔相对路径）', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'src', 'deep'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), 'x', 'utf8');
    await fs.writeFile(path.join(dir, 'src', 'deep', 'a.ts'), 'x', 'utf8');
    expect(await listActualFiles(dir)).toEqual(['README.md', 'src/deep/a.ts']);
  });

  it('比对：一致 / 缺失 / 多余 / 混合三态', () => {
    expect(compareFiles(['a', 'b'], ['b', 'a'])).toEqual({ missing: [], extra: [] });
    expect(compareFiles(['a', 'b', 'c'], ['a', 'b'])).toEqual({ missing: ['c'], extra: [] });
    expect(compareFiles(['a'], ['a', 'x', 'y'])).toEqual({ missing: [], extra: ['x', 'y'] });
    expect(compareFiles(['a', 'b', 'c'], ['b', 'x'])).toEqual({ missing: ['a', 'c'], extra: ['x'] });
  });

  it('ProjectManifestSchema：缺 files / version 非 1 → 不合法', () => {
    expect(ProjectManifestSchema.safeParse({ ...sample, files: undefined }).success).toBe(false);
    expect(ProjectManifestSchema.safeParse({ ...sample, version: 2 }).success).toBe(false);
  });
});
