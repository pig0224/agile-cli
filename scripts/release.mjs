#!/usr/bin/env node
/**
 * agile-cli 发版脚本（npm run release）
 *
 * 本地只负责：质量门 → 收集提交生成 CHANGELOG → bump 版本 → commit + tag → push。
 * 真正的 npm publish 由 GitHub Actions release workflow 执行（tag 触发），
 * 本地不需要也不应该再执行 npm publish。
 *
 * 用法：
 *   npm run release                      # 交互式（版本号依据提交类型自动建议）
 *   npm run release -- patch|minor|major # 指定 bump 类型
 *   npm run release -- 0.2.0             # 指定确切版本
 *   npm run release -- patch --dry-run   # 只演练不执行
 *   npm run release -- patch --yes       # 跳过确认
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { execa } from 'execa';
import { buildChangelogSection, suggestBump } from './lib/changelog.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PKG_FILE = path.join(ROOT, 'package.json');
const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const YES = args.includes('--yes');
const positional = args.find((a) => !a.startsWith('--'));

const BUMP_TYPES = ['patch', 'minor', 'major'];
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function log(msg) {
  console.log(msg);
}

async function sh(cmd, cmdArgs) {
  const r = await execa(cmd, cmdArgs, { cwd: ROOT, reject: false, windowsHide: true });
  if (r.exitCode !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')} 失败：${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

async function trySh(cmd, cmdArgs) {
  const r = await execa(cmd, cmdArgs, { cwd: ROOT, reject: false, windowsHide: true });
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

function bump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function ask(question, fallback) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question}${fallback ? `（回车=${fallback}）` : ''}: `)).trim();
  rl.close();
  return answer || fallback || '';
}

function parseGithubRepo(remoteUrl) {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.#?]+)(?:\.git)?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** 收集自上个 tag 以来的提交（无 tag 则收集全部提交） */
async function collectCommitsSinceLastTag() {
  const lastTag = await trySh('git', ['describe', '--tags', '--abbrev=0']);
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const raw = await sh('git', ['log', '--pretty=format:%H%x1f%s%x1f%b%x00', range]);
  const recordSep = String.fromCharCode(0);
  const unitSep = String.fromCharCode(31);
  return raw
    .split(recordSep)
    .filter((e) => e.trim())
    .map((entry) => {
      const [sha, subject, ...body] = entry.split(unitSep);
      return { sha, subject: subject ?? '', body: body.join(unitSep) ?? '' };
    });
}

/** 在 CHANGELOG.md 顶部插入新版本段落（文件不存在则创建；文件内容仅由版本段落组成） */
async function writeChangelog(section) {
  let content = '';
  try {
    content = await fs.readFile(CHANGELOG_FILE, 'utf8');
  } catch {
    /* 首次创建 */
  }
  await fs.writeFile(CHANGELOG_FILE, section + content, 'utf8');
}

/** 轮询 GitHub Actions Release workflow 的结论 */
async function waitForRelease(repo, tag, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  const api = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs?event=push&per_page=20`;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${api}&created=>${new Date(started - 60_000).toISOString()}`, {
        headers: { 'User-Agent': 'agile-cli-release' },
      });
      if (res.ok) {
        const data = await res.json();
        const run = (data.workflow_runs ?? []).find(
          (r) => r.name === 'Release' && r.head_branch === tag,
        );
        if (run && run.status === 'completed') return run.conclusion;
      }
    } catch {
      // 网络抖动，继续轮询
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return 'timeout';
}

/**
 * 发布失败后的自动回退：revert 发版提交并推送 main，删除远端与本地 tag。
 * - npm 上已存在该版本时（publish 成功但 workflow 后续步骤失败）拒绝回退，
 *   否则 npm 与 git 状态脱节（tag 没了版本还在），必须人工处置。
 * - HEAD 不是本次发版提交时（说明发版后又有新提交）跳过 revert，交人工处理。
 */
async function rollbackRelease(pkgName, tag) {
  const version = tag.slice(1);
  log(`▶ 自动回退：revert 发版提交 → 推送 main → 删除 tag ${tag}`);

  let published = null;
  try {
    published = await trySh('npm', ['view', `${pkgName}@${version}`, 'version']);
  } catch {
    // 查询失败（网络等）按"未发布"处理，继续回退；tag 删除是可恢复操作
  }
  if (published) {
    log(`⚠ npm 上已存在 ${pkgName}@${version}（publish 成功但后续步骤失败），不自动回退。`);
    log(`  请人工处置：保留 tag 修复 workflow 后重跑，或按 docs/release.md「回退」规范操作。`);
    return;
  }

  const headSubject = await trySh('git', ['log', '-1', '--pretty=%s']);
  if (headSubject !== `chore(release): ${tag}`) {
    log(`⚠ HEAD 不是本次发版提交（当前：${headSubject ?? '未知'}），跳过 revert，请人工回退。`);
    return;
  }

  try {
    await sh('git', ['-c', 'user.name=release', '-c', 'user.email=release@local', 'revert', '--no-edit', 'HEAD']);
    await sh('git', ['push', 'origin', 'main']);
    await sh('git', ['push', 'origin', `:refs/tags/${tag}`]);
    await trySh('git', ['tag', '-d', tag]);
    log(`✔ 回退完成：CHANGELOG 与版本号已还原并推送 main，tag ${tag}（远端+本地）已删除。`);
    log(`  修复问题后重新执行 npm run release 即可（CHANGELOG 段落会重新生成）。`);
  } catch (e) {
    log(`⚠ 自动回退中途失败：${e.message}`);
    log(`  已完成的步骤保持不变，请按上方输出人工完成剩余步骤。`);
  }
}

async function main() {
  // ---------- 1. 前置检查 ----------
  const pkg = JSON.parse(await fs.readFile(PKG_FILE, 'utf8'));
  const current = pkg.version;

  const gitStatus = await sh('git', ['status', '--porcelain']);
  if (gitStatus) {
    throw new Error(`工作区不干净，先提交或暂存：\n${gitStatus}`);
  }
  const branch = await sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`当前分支是 ${branch}，发版请在 main 上进行`);
  }
  const remoteUrl = await trySh('git', ['remote', 'get-url', 'origin']);
  if (!remoteUrl) throw new Error('未配置 origin 远端仓库');
  const repo = parseGithubRepo(remoteUrl);
  if (!repo) throw new Error(`无法从 origin 解析 GitHub 仓库：${remoteUrl}`);

  await sh('git', ['fetch', 'origin', 'main', '--tags']);
  const ahead = Number((await trySh('git', ['rev-list', '--count', 'origin/main..main'])) ?? 0);
  const behind = Number((await trySh('git', ['rev-list', '--count', 'main..origin/main'])) ?? 0);
  if (behind > 0) throw new Error(`本地落后 origin/main ${behind} 个提交，先 git pull`);
  if (ahead > 0) throw new Error(`本地领先 origin/main ${ahead} 个提交，先 git push`);

  // ---------- 2. 收集提交，解析目标版本 ----------
  const commits = await collectCommitsSinceLastTag();
  if (commits.length === 0) {
    throw new Error('上个 tag 以来没有任何提交，无需发版');
  }
  const suggested = suggestBump(commits);

  let next;
  if (positional && SEMVER_RE.test(positional)) {
    next = positional;
  } else if (positional && BUMP_TYPES.includes(positional)) {
    next = bump(current, positional);
  } else if (!positional) {
    const type = await ask(`当前 ${current}，bump 类型 ${BUMP_TYPES.join('/')}（依据提交建议：${suggested}）`, suggested);
    if (!BUMP_TYPES.includes(type)) throw new Error(`非法 bump 类型：${type}`);
    next = bump(current, type);
  } else {
    throw new Error(`无法识别的参数：${positional}（可用：patch | minor | major | x.y.z）`);
  }

  const tag = `v${next}`;
  const tagExists = await trySh('git', ['rev-parse', tag]);
  if (tagExists) throw new Error(`tag ${tag} 已存在`);
  if (next === current) throw new Error(`新版本与当前版本相同：${next}`);

  // ---------- 3. 质量门（与 CI 同款）----------
  log(`▶ 质量门：typecheck + test + build`);
  if (DRY_RUN) {
    log('（dry-run 跳过）');
  } else {
    await sh('pnpm', ['typecheck']);
    await sh('pnpm', ['test']);
    await sh('pnpm', ['build']);
  }

  // ---------- 4. CHANGELOG 段落预览 ----------
  const commitUrl = `https://github.com/${repo.owner}/${repo.repo}/commit/`;
  const section = buildChangelogSection(next, new Date().toISOString().slice(0, 10), commits, { commitUrl });
  log('');
  log(section);
  log('');

  // ---------- 5. 确认 ----------
  log(`▶ 发布 ${current} → ${next}（tag ${tag} → ${repo.owner}/${repo.repo}，由 GitHub Actions 执行 npm publish）`);
  if (!YES) {
    const ok = await ask('确认发布？（确认后写入 CHANGELOG、commit、tag、push）', 'y');
    if (!/^y(es)?$/i.test(ok)) throw new Error('已取消');
  }

  if (DRY_RUN) {
    log(`✔ dry-run 完成：将发布 ${current} → ${next}（未做任何修改）`);
    return;
  }

  // ---------- 6. CHANGELOG + 版本写入 + commit + tag + push ----------
  // CHANGELOG 同版本去重：重发/修复场景下段落已存在时跳过写入，避免重复段落
  const changelogContent = await fs.readFile(CHANGELOG_FILE, 'utf8').catch(() => '');
  if (changelogContent.includes(`## ${tag} `)) {
    log(`ℹ CHANGELOG 已包含 ${tag} 段落，跳过写入`);
  } else {
    await writeChangelog(section);
  }
  // ★ 版本号写盘（单一事实源）：此步骤缺失会导致 tag 内 package.json 与版本不符
  pkg.version = next;
  await fs.writeFile(PKG_FILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  await sh('git', ['add', 'package.json', 'CHANGELOG.md']);
  await sh('git', ['-c', 'user.name=release', '-c', 'user.email=release@local', 'commit', '-m', `chore(release): ${tag}`]);
  // 提交后自检：tag 将指向的 HEAD 中 package.json 必须已是目标版本
  const committedVersion = JSON.parse(await sh('git', ['show', `HEAD:package.json`])).version;
  if (committedVersion !== next) {
    throw new Error(`自检失败：提交内 package.json 版本为 ${committedVersion}，预期 ${next}（中止，未打 tag）`);
  }
  await sh('git', ['tag', '-a', tag, '-m', `${tag}`]);
  await sh('git', ['push', 'origin', 'main', tag]);
  log(`✔ 已推送 ${tag}，Release workflow 已触发`);

  // ---------- 7. 跟踪发布结果 ----------
  log(`▶ 等待 GitHub Actions 发布结果（最长 10 分钟）`);
  const conclusion = await waitForRelease(repo, tag);
  console.log('');
  if (conclusion === 'success') {
    log(`✔ 发布成功：https://www.npmjs.com/package/${pkg.name}`);
    log(`  GitHub Release：https://github.com/${repo.owner}/${repo.repo}/releases/tag/${tag}`);
  } else if (conclusion === 'timeout') {
    log(`⚠ 等待超时，请自行查看：https://github.com/${repo.owner}/${repo.repo}/actions`);
  } else {
    log(`✖ Release workflow 失败（${conclusion}）：https://github.com/${repo.owner}/${repo.repo}/actions`);
    await rollbackRelease(pkg.name, tag);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
