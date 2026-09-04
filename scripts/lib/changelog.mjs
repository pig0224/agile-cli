/**
 * CHANGELOG 生成（零依赖纯逻辑，供 scripts/release.mjs 与单测共用）。
 * 解析 Conventional Commits，按类型分组渲染版本段落，并推导建议版本号。
 */

const TYPE_RE = /^(feat|fix|perf|revert|docs|test|chore|style|refactor|build|ci)(\(([^)]+)\))?(!)?:\s+(.+)$/;
const BREAKING_RE = /BREAKING CHANGE[:：]/;

/**
 * @param {Array<{sha: string, subject: string, body: string}>} commits
 * @returns {Array<{sha: string, type: string, scope?: string, breaking: boolean, subject: string}>}
 */
export function parseCommits(commits) {
  const parsed = [];
  for (const { sha, subject = '', body = '' } of commits) {
    const m = TYPE_RE.exec(subject.trim());
    if (!m) continue; // 非 Conventional Commits 提交不计入分组
    const type = m[1];
    const scope = m[3];
    // Dependabot 的依赖升级提交（chore(deps)/chore(deps-dev): bump …）是维护噪音，
    // 不进入 CHANGELOG（其变更由 lockfile 与 npm 页面体现）
    if (type === 'chore' && (scope ?? '').startsWith('deps')) continue;
    const breaking = Boolean(m[4]) || BREAKING_RE.test(body);
    parsed.push({ sha: sha.trim(), type, scope, breaking, subject: subject.trim().replace(/\s+/g, ' ') });
  }
  return parsed;
}

/** 依据提交类型推导建议版本号：breaking → major，feat → minor，其余 → patch */
export function suggestBump(commits) {
  const parsed = parseCommits(commits);
  if (parsed.some((c) => c.breaking)) return 'major';
  if (parsed.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

function bump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** 依据提交推导目标版本（manifest/当前版本 + 建议类型） */
export function nextVersion(version, commits) {
  return bump(version, suggestBump(commits));
}

const GROUP_ORDER = [
  { key: 'breaking', title: 'Breaking Changes' },
  { key: 'feat', title: 'Features' },
  { key: 'fix', title: 'Fixes' },
  { key: 'perf', title: 'Performance' },
  { key: 'other', title: 'Other Changes' },
];

function groupOf(c) {
  if (c.breaking) return 'breaking';
  if (c.type === 'feat') return 'feat';
  if (c.type === 'fix') return 'fix';
  if (c.type === 'perf') return 'perf';
  return 'other';
}

function bumpTypeOfSection(commits) {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

/**
 * 渲染一个版本的 CHANGELOG 段落（Markdown）。
 * @param {object} opts
 * @param {string} [opts.commitUrl] commit 链接前缀（如 https://github.com/owner/repo/commit/），
 *        提供时 hash 渲染为可点击链接（npmjs.com 渲染 CHANGELOG 不会自动链接裸 SHA）
 * @returns {string} 形如 "## v1.1.0 (2026-09-04)\n\n### ..." 的段落（以空行结尾）
 */
export function buildChangelogSection(version, date, commits, opts = {}) {
  const parsed = parseCommits(commits);
  if (parsed.length === 0) return '';
  const bumpType = bumpTypeOfSection(parsed);
  const commitUrl = opts.commitUrl;
  const item = (c) => {
    const short = c.sha.slice(0, 7);
    return commitUrl ? `${c.subject} ([\`${short}\`](${commitUrl}${c.sha}))` : `${c.subject} (${short})`;
  };
  const lines = [`## v${version} (${date})`, '', `> bump: ${bumpType}`, ''];
  for (const g of GROUP_ORDER) {
    const items = parsed.filter((c) => groupOf(c) === g.key);
    if (items.length === 0) continue;
    lines.push(`### ${g.title}`, '');
    for (const c of items) {
      lines.push(`- ${item(c)}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}
