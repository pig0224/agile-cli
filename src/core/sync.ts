import fs from 'node:fs/promises';
import path from 'node:path';
import { git, gitTry, isDirty } from './git.js';
import { ensureTemplateRepo } from './template-registry.js';
import { syncPlugins, type PluginSyncStep } from './claude-plugins.js';
import type { Settings } from './schemas.js';

export interface SyncStep {
  name: string;
  status: 'done' | 'skipped' | 'warn' | 'failed';
  detail: string;
}

export type { PluginSyncStep };

export interface SyncOptions {
  /** 只产出计划不落盘（repos 不 clone/pull、templates 不刷新、plugins 不安装） */
  dryRun?: boolean;
}

/** sync 覆盖的外部仓库槽位：key 与 settings.repos / settings.paths 的键一致；
 *  alwaysIgnore = 未登记也写入 .gitignore（tech-specs 为公司级规范、天然外部仓库，
 *  即使当前 workspace 未登记也不该提交入库；biz-tech-docs 未登记时是 workspace 内普通目录，随仓库入库） */
const REPO_SLOTS = [
  { key: 'techSpecs', label: 'tech-specs（公司级规范）', configKey: 'tech-specs', alwaysIgnore: true },
  { key: 'bizTechDocs', label: 'biz-tech-docs（团队知识库）', configKey: 'biz-tech-docs', alwaysIgnore: false },
] as const;

/** 单个外部仓库槽位的收敛：目录缺失 → clone；已有 → fetch + ff-only 快进（dirty 跳过、分叉报人工） */
async function syncRepoSlot(root: string, settings: Settings, slot: (typeof REPO_SLOTS)[number], dryRun?: boolean): Promise<SyncStep> {
  const entry = settings.repos[slot.key];
  const dir = path.join(root, settings.paths[slot.key]);
  if (!entry?.url) {
    return { name: slot.label, status: 'skipped', detail: `未配置仓库地址（agile config set ${slot.configKey} <git-url>）` };
  }

  const exists = await fs
    .stat(dir)
    .then(() => true)
    .catch(() => false);
  // 必须是仓库根（toplevel == dir 本身）：rev-parse 的 --git-dir/--show-toplevel 都会向上继承父仓，
  // 会把 workspace 根仓内的抽屉子目录误判为 git 仓库。realpath 归一 Windows 8.3 短路径（ADMINI~1）与大小写。
  let isRepo = false;
  if (exists) {
    const top = await gitTry(dir, ['rev-parse', '--show-toplevel']);
    if (top.ok) {
      const [a, b] = await Promise.all([
        fs.realpath(top.stdout.trim()).catch(() => ''),
        fs.realpath(dir).catch(() => ''),
      ]);
      isRepo = a.toLowerCase() === b.toLowerCase();
    }
  }

  if (!isRepo) {
    if (exists) {
      // 骨架目录（仅 init 生成的 README.md）→ 让位给 clone；其他非空目录不动
      const files = await fs.readdir(dir);
      if (files.length !== 1 || files[0] !== 'README.md') {
        return { name: slot.label, status: 'failed', detail: `目录已存在且非空且不是 git 仓库：${settings.paths[slot.key]}，请手动处理后重试` };
      }
      if (dryRun) return { name: slot.label, status: 'skipped', detail: `[dry-run] 将让位骨架目录并 clone ${entry.url}` };
      await fs.rm(dir, { recursive: true, force: true });
    } else if (dryRun) {
      return { name: slot.label, status: 'skipped', detail: `[dry-run] 将 clone ${entry.url}` };
    }
    try {
      // 本地路径 URL 需放开 git 的 file 协议安全限制（git 安全默认）
      await git(root, ['-c', 'protocol.file.allow=always', 'clone', entry.url, dir]);
    } catch (e) {
      return { name: slot.label, status: 'failed', detail: `clone 失败：${(e as Error).message.split('\n')[0]}` };
    }
    return { name: slot.label, status: 'done', detail: `已克隆 ${entry.url}` };
  }

  // 知识库/规范目录是可写工作区（knowledge 等会落盘）→ 一律 pull 不 reset；本地改动优先
  if (await isDirty(dir)) {
    return { name: slot.label, status: 'warn', detail: '存在未提交改动，跳过更新（本地优先，不覆盖）' };
  }
  if (dryRun) return { name: slot.label, status: 'skipped', detail: '[dry-run] 将拉取远端最新（fast-forward）' };
  try {
    await git(dir, ['fetch', 'origin']);
    const ff = await gitTry(dir, ['merge', '--ff-only', '@{upstream}']);
    if (!ff.ok) {
      return { name: slot.label, status: 'failed', detail: `无法快进到远端（${(ff.stderr || '').split('\n')[0]}），需人工处理` };
    }
  } catch (e) {
    return { name: slot.label, status: 'failed', detail: `拉取失败：${(e as Error).message.split('\n')[0]}` };
  }
  return { name: slot.label, status: 'done', detail: '已同步到远端最新' };
}

/** workspace 根 .gitignore 是否覆盖该抽屉目录（外部资源不入库的防线；init workspace 按「已登记才忽略」写入，
 *  后补登记/手改 settings.paths 场景由 sync 自动补写，见 appendGitignore） */
async function gitignoreCovers(root: string, relDir: string): Promise<boolean> {
  const gi = await fs.readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '');
  const target = `${relDir.replace(/\\/g, '/')}/`;
  return gi.split(/\r?\n/).map((l) => l.trim()).includes(target);
}

/** 向 workspace 根 .gitignore 幂等追加一行（relDir → `<relDir>/`）；
 *  文件不存在时创建；追加行跟随既有文件的换行风格（CRLF 文件不产生混合换行）；写失败返回 false 交人工 */
async function appendGitignore(root: string, relDir: string): Promise<boolean> {
  const giPath = path.join(root, '.gitignore');
  try {
    const gi = await fs.readFile(giPath, 'utf8').catch(() => '');
    const eol = gi.includes('\r\n') ? '\r\n' : '\n';
    const line = `${relDir.replace(/\\/g, '/')}/`;
    await fs.writeFile(giPath, gi === '' ? `${line}${eol}` : `${gi.replace(/\r?\n*$/, eol)}${line}${eol}`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 模板仓库缓存刷新：fetch + reset 到远端最新；失联降级沿用本地缓存 */
async function syncTemplates(settings: Settings, dryRun?: boolean): Promise<SyncStep> {
  if (dryRun) return { name: 'templates（模板缓存）', status: 'skipped', detail: '[dry-run] 将刷新模板仓库缓存' };
  try {
    const { stale } = await ensureTemplateRepo(settings.templates.registry, { refresh: true });
    return stale
      ? { name: 'templates（模板缓存）', status: 'warn', detail: '模板源失联，沿用本地缓存' }
      : { name: 'templates（模板缓存）', status: 'done', detail: '已刷新到远端最新' };
  } catch (e) {
    return { name: 'templates（模板缓存）', status: 'failed', detail: (e as Error).message };
  }
}

/** 按 settings 声明收敛全部外部资源到本地：外部仓库拉取 + 模板缓存刷新 + Claude 插件安装 */
export async function syncWorkspace(root: string, settings: Settings, opts: SyncOptions = {}): Promise<SyncStep[]> {
  const steps: SyncStep[] = [];
  for (const slot of REPO_SLOTS) {
    const step = await syncRepoSlot(root, settings, slot, opts.dryRun);
    steps.push(step);
    const registered = Boolean(settings.repos[slot.key]?.url);
    const covered = await gitignoreCovers(root, settings.paths[slot.key]);
    // 已登记为外部仓库 → 抽屉目录必须被 .gitignore 忽略（防外部内容入库）；
    // 缺行自动补写（dry-run 只出计划；写失败降级 warn 交人工）
    if (registered && !covered) {
      if (opts.dryRun) {
        steps.push({ name: slot.label, status: 'skipped', detail: `[dry-run] 将在 .gitignore 追加 ${settings.paths[slot.key]}/（外部仓库内容不入库）` });
      } else {
        const ok = await appendGitignore(root, settings.paths[slot.key]);
        steps.push(
          ok
            ? { name: slot.label, status: 'done', detail: `已在 .gitignore 追加 ${settings.paths[slot.key]}/（外部仓库内容不入库）` }
            : { name: slot.label, status: 'warn', detail: `${settings.paths[slot.key]}/ 未在 workspace 根 .gitignore 忽略且自动补写失败——外部仓库内容可能被提交入库，请手动补该行` },
        );
      }
    }
    // 未登记且非「始终忽略」槽位 → .gitignore 残留忽略行会让知识库内容不入库，提示人工删行
    // （登记后该行由本命令维护；tech-specs 未登记也忽略，属预期，不提示）
    if (!registered && !slot.alwaysIgnore && covered) {
      steps.push({
        name: slot.label,
        status: 'warn',
        detail: `${settings.paths[slot.key]}/ 在 .gitignore 中但未登记为外部仓库——知识库内容不会随 workspace 仓库入库；若需入库请手动删除该行（登记为外部仓库后该行由 agile sync 维护）`,
      });
    }
    if (settings.repos[slot.key]?.ref) {
      steps.push({ name: slot.label, status: 'warn', detail: '声明了版本锁定（ref）——锁定拉取暂未实现，按远端最新拉取' });
    }
  }
  steps.push(await syncTemplates(settings, opts.dryRun));
  steps.push(...(await syncPlugins(root, settings, { dryRun: opts.dryRun })));
  return steps;
}
