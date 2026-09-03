import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry } from '../core/config.js';
import { computeSyncPlan, executeSyncPlan } from '../core/sync.js';
import * as ui from '../ui.js';

export const syncCommand = new Command('sync')
  .description('同步 registry.yaml 登记的外部仓库（如 tech-specs）：把磁盘 submodule 状态收敛到声明状态')
  .option('--repo <path>', '只同步指定仓库（可重复）', collect, [] as string[])
  .option('--force', '忽略 dirty 仓库强制更新')
  .option('--dry-run', '只输出计划，不执行')
  .option('--quiet', '静默模式（自动场景使用，仅输出异常）')
  .action(async (opts: { repo: string[]; force?: boolean; dryRun?: boolean; quiet?: boolean }) => {
    const root = requireWorkspaceRoot();
    const registry = await loadRegistry(root);

    const plan = await computeSyncPlan(root, registry, { only: opts.repo.length ? opts.repo : undefined, force: opts.force });

    const hasActions = plan.adds.length + plan.updates.length + plan.removes.length > 0;
    if (!opts.quiet) {
      if (!hasActions) {
        console.log(ui.ok('所有外部仓库均已同步，无需操作。'));
      } else {
        console.log(ui.bold('同步计划：'));
        for (const a of plan.adds) console.log(`  ${ui.info('+')} ${a.repoPath} ← ${a.url}${a.branch ? ` (${a.branch})` : ''}`);
        for (const u of plan.updates) console.log(`  ${ui.info('↻')} ${u.repoPath}（${u.reason}）`);
        for (const r of plan.removes) console.log(`  ${ui.warn('-')} ${r.path}（registry 中不存在，将移除）`);
      }
      for (const w of plan.warnings) console.log(ui.warn(w));
    }

    if (opts.dryRun) {
      if (!opts.quiet) console.log(ui.dim('（dry-run，未执行）'));
      return;
    }
    if (!hasActions) return;

    const log = opts.quiet ? () => {} : (msg: string) => console.log(`  ${msg}`);
    const report = await executeSyncPlan(root, registry, plan, { only: opts.repo.length ? opts.repo : undefined, force: opts.force }, log);

    if (!opts.quiet) {
      for (const p of report.added) console.log(ui.ok(`已添加 ${p}`));
      for (const p of report.updated) console.log(ui.ok(`已更新 ${p}`));
      for (const p of report.removed) console.log(ui.ok(`已移除 ${p}`));
    }
    for (const f of report.failed) console.log(ui.fail(`${f.repoPath}: ${f.error}`));

    if (report.failed.length > 0) process.exitCode = 1;
  });

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
