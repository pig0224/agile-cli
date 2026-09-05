import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadSettings } from '../core/config.js';
import { syncWorkspace } from '../core/sync.js';
import * as ui from '../ui.js';

export const syncCommand = new Command('sync')
  .description(
    '同步外部资源到本地：外部仓库（公司级规范 tech-specs / 团队知识库 biz-tech-docs，clone 或快进拉取，本地改动优先）+ 模板缓存刷新 + Claude 插件按声明安装（绝不卸载）',
  )
  .option('--dry-run', '只显示将执行的动作，不落盘')
  .action(async (opts: { dryRun?: boolean }) => {
    const root = requireWorkspaceRoot();
    const settings = await loadSettings(root);
    const steps = await syncWorkspace(root, settings, { dryRun: opts.dryRun === true });
    console.log(ui.bold('同步计划与结果：'));
    for (const s of steps) {
      const tag =
        s.status === 'done' ? ui.ok('✓') : s.status === 'warn' ? ui.warn('!') : s.status === 'failed' ? ui.warn('✖') : ui.dim('·');
      console.log(`  ${tag} ${s.name}：${s.detail}`);
    }
    if (steps.some((s) => s.status === 'failed')) process.exitCode = 1;
  });
