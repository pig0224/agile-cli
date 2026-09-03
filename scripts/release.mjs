#!/usr/bin/env node
/**
 * agile-cli 发版脚本（npm run release）
 *
 * 本地只负责：前置检查 → 质量门 → bump 版本 → commit + tag → push。
 * 真正的 npm publish 由 GitHub Actions release workflow 执行（tag 触发），
 * 本地不需要也不应该再执行 npm publish。
 *
 * 用法：
 *   npm run release                      # 交互式（默认 patch）
 *   npm run release -- patch|minor|major # 指定 bump 类型
 *   npm run release -- 0.2.0             # 指定确切版本
 *   npm run release -- patch --dry-run   # 只演练不执行
 *   npm run release -- patch --yes       # 跳过确认
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readline } from 'node:readline/promises';
import { execa } from 'execa';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PKG_FILE = path.join(ROOT, 'package.json');

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
  const rl = readline({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question}${fallback ? `（回车=${fallback}）` : ''}: `)).trim();
  rl.close();
  return answer || fallback || '';
}

/** 从 origin URL 解析 owner/repo（支持 ssh 与 https 形式） */
function parseGithubRepo(remoteUrl) {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.#?]+)(?:\.git)?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
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
        if (run && (run.status === 'completed' || run.status === 'failure')) {
          return run.conclusion;
        }
      }
    } catch {
      // 网络抖动，继续轮询
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return 'timeout';
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

  // ---------- 2. 解析目标版本 ----------
  let next;
  if (positional && SEMVER_RE.test(positional)) {
    next = positional;
  } else if (positional && BUMP_TYPES.includes(positional)) {
    next = bump(current, positional);
  } else if (!positional) {
    const type = await ask(`当前 ${current}，bump 类型 ${BUMP_TYPES.join('/')}`, 'patch');
    if (!BUMP_TYPES.includes(type)) throw new Error(`非法 bump 类型：${type}`);
    next = bump(current, type);
  } else {
    throw new Error(`无法识别的参数：${positional}（可用：patch | minor | major | x.y.z）`);
  }

  const tag = `v${next}`;
  const tagExists = await trySh('git', ['rev-parse', tag]);
  if (tagExists) throw new Error(`tag ${tag} 已存在`);
  if (next === current) throw new Error(`新版本与当前版本相同：${next}`);

  // ---------- 3. 质量门（与 CI 相同）----------
  log(`▶ 质量门：typecheck / test / build`);
  if (DRY_RUN) {
    log('（dry-run 跳过）');
  } else {
    await sh('pnpm', ['typecheck']);
    await sh('pnpm', ['test']);
    await sh('pnpm', ['build']);
  }

  // ---------- 4. 确认 ----------
  log(`▶ 发布 ${current} → ${next}（tag ${tag} → ${repo.owner}/${repo.repo}，由 GitHub Actions 执行 npm publish）`);
  if (!YES) {
    const ok = await ask('确认发布？(y/n)', 'y');
    if (!/^y(es)?$/i.test(ok)) throw new Error('已取消');
  }

  if (DRY_RUN) {
    log(`✔ dry-run 完成：将发布 ${current} → ${next}（未做任何修改）`);
    return;
  }

  // ---------- 5. 写版本 + commit + tag + push ----------
  pkg.version = next;
  await fs.writeFile(PKG_FILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  await sh('git', ['add', 'package.json']);
  await sh('git', ['-c', 'user.name=release', '-c', 'user.email=release@local', 'commit', '-m', `chore(release): ${tag}`]);
  await sh('git', ['tag', '-a', tag, '-m', `${tag}`]);
  await sh('git', ['push', 'origin', 'main', tag]);
  log(`✔ 已推送 ${tag}，Release workflow 已触发`);

  // ---------- 6. 跟踪发布结果 ----------
  if (repo) {
    log(`▶ 等待 GitHub Actions 发布结果（最长 10 分钟）`);
    const conclusion = await waitForRelease(repo, tag);
    console.log('');
    if (conclusion === 'success') {
      log(`✔ 发布成功：https://www.npmjs.com/package/${pkg.name}`);
      log(`  GitHub Release：https://github.com/${repo.owner}/${repo.repo}/releases/tag/${tag}`);
    } else if (conclusion === 'timeout') {
      log(`⚠ 等待超时，请自行查看：https://github.com/${repo.owner}/${repo.repo}/actions`);
    } else {
      throw new Error(`Release workflow 失败（${conclusion}），详情：https://github.com/${repo.owner}/${repo.repo}/actions`);
    }
  }
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
