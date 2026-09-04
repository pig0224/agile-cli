import { describe, expect, it } from 'vitest';
import { parseCommits, suggestBump, buildChangelogSection } from '../scripts/lib/changelog.mjs';

const commits = [
  { sha: 'aaa1111222233334444455556666777788889999', subject: 'feat: 支持 .tmpl 模板后缀', body: '' },
  { sha: 'bbb2222333344445555666677778888999900000', subject: 'fix!: 缓存语义反转', body: 'BREAKING CHANGE: --no-refresh 已移除' },
  { sha: 'ccc3333444455556666777788889999000011111', subject: 'fix: 修复 --version 脱节', body: '' },
  { sha: 'ddd4444555666677778888999900001111222233', subject: 'docs: 更新使用说明', body: '' },
];

describe('parseCommits', () => {
  it('解析类型/scope/breaking', () => {
    const parsed = parseCommits(commits);
    expect(parsed[0]).toMatchObject({ type: 'feat', breaking: false, subject: 'feat: 支持 .tmpl 模板后缀' });
    expect(parsed[1]).toMatchObject({ type: 'fix', breaking: true });
  });

  it('scope 解析', () => {
    const parsed = parseCommits([{ sha: 'a', subject: 'fix(cli): 修复', body: '' }]);
    expect(parsed[0]).toMatchObject({ type: 'fix', scope: 'cli' });
  });

  it('非 Conventional Commits 提交被忽略', () => {
    expect(parseCommits([{ sha: 'a', subject: '随便写的一句话', body: '' }])).toEqual([]);
  });
});

describe('suggestBump', () => {
  it('breaking → major', () => {
    expect(suggestBump([commits[1]!])).toBe('major');
  });
  it('feat → minor', () => {
    expect(suggestBump([commits[0]!])).toBe('minor');
  });
  it('仅 fix/docs → patch', () => {
    expect(suggestBump([commits[2]!, commits[3]!])).toBe('patch');
  });
});

describe('buildChangelogSection', () => {
  it('按类型分组渲染，breaking 单列', () => {
    const md = buildChangelogSection('1.1.0', '2026-09-04', commits);
    expect(md).toContain('## v1.1.0 (2026-09-04)');
    expect(md).toContain('> bump: major');
    expect(md).toContain('### Breaking Changes');
    expect(md).toContain('- fix!: 缓存语义反转 (bbb2222)');
    expect(md).toContain('### Features');
    expect(md).toContain('- feat: 支持 .tmpl 模板后缀 (aaa1111)');
    expect(md).toContain('### Bug Fixes');
    expect(md).toContain('- fix: 修复 --version 脱节 (ccc3333)');
    expect(md).toContain('### Other Changes');
    expect(md).toContain('- docs: 更新使用说明 (ddd4444)');
    // 分组顺序：Breaking → Features → Fixes → Other
    expect(md.indexOf('Breaking')).toBeLessThan(md.indexOf('Features'));
    expect(md.indexOf('Features')).toBeLessThan(md.indexOf('Bug Fixes'));
  });

  it('提供 commitUrl 时 hash 渲染为可点击链接', () => {
    const md = buildChangelogSection('1.1.0', '2026-09-04', commits, {
      commitUrl: 'https://github.com/pig0224/agile-cli/commit/',
    });
    expect(md).toContain(
      '[`aaa1111`](https://github.com/pig0224/agile-cli/commit/aaa1111222233334444455556666777788889999)',
    );
  });

  it('空提交返回空串', () => {
    expect(buildChangelogSection('1.0.0', '2026-09-04', [])).toBe('');
  });
});
