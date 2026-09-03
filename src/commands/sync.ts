import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry } from '../core/config.js';
import { computeSyncPlan, executeSyncPlan } from '../core/sync.js';
import * as ui from '../ui.js';

export const syncCommand = new Command('sync')
  .description('同步工作空间代码：把磁盘状态收敛到 registry.yaml 声明的期望状态（gclient sync 风格）')
  .option('--repo <path>', '只同步指定仓库（可重复）', collect, [] as string[])
  .option('--force', '忽略 dirty 仓库强制更新')
  .option('--no-hooks', '跳过 post-sync hooks')
  .option('--dry-run', '只输出计划，不执行')
  .action(async (opts: { repo: string[]; force?: boolean; noHooks?: boolean; dryRun?: boolean }) => {
    const root = requireWorkspaceRoot();
    const registry = await loadRegistry(root);

    const plan = await computeSyncPlan(root, registry, { only: opts.repo.length ? opts.repo : undefined, force: opts.force });

    if (plan.adds.length === 0 && plan.updates.length === 0 && plan.removes.length === 0) {
      console.log(ui.ok('所有仓库均已同步，无需操作。'));
    } else {
      console.log(ui.bold('同步计划：'));
      for (const a of plan.adds) console.log(`  ${ui.info('+')} ${a.repoPath} ← ${a.url}${a.branch ? ` (${a.branch})` : ''}`);
      for (const u of plan.updates) console.log(`  ${ui.info('↻')} ${u.repoPath}（${u.reason}）`);
      for (const r of plan.removes) console.log(`  ${ui.warn('-')} ${r.path}（registry 中不存在，将移除）`);
    }
    for (const w of plan.warnings) console.log(ui.warn(w));

    if (opts.dryRun) {
      console.log(ui.dim('（dry-run，未执行）'));
      return;
    }

    if (plan.adds.length === 0 && plan.updates.length === 0 && plan.removes.length === 0) {
      // 无任何动作（可能全部被 warnings 跳过）：不执行 hooks，避免无谓的 workspace 加载
      return;
    }

    const report = await executeSyncPlan(root, registry, plan, { only: opts.repo.length ? opts.repo : undefined, force: opts.force, noHooks: opts.noHooks }, (msg) => console.log(`  ${msg}`));

    for (const p of report.added) console.log(ui.ok(`已添加 ${p}`));
    for (const p of report.updated) console.log(ui.ok(`已更新 ${p}`));
    for (const p of report.removed) console.log(ui.ok(`已移除 ${p}`));
    for (const f of report.failed) console.log(ui.fail(`${f.repoPath}: ${f.error}`));
    for (const h of report.hooksRun) {
      if (h.ok) console.log(ui.ok(`hook ✔ ${h.run}（${h.match}）`));
      else console.log(ui.fail(`hook ✖ ${h.run}（${h.match}）：${h.error}`));
    }

    if (report.failed.length > 0) process.exitCode = 1;
  });

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
