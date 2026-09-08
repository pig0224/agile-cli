import { Command } from 'commander';
import pc from 'picocolors';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadSettings } from '../core/config.js';
import { syncWorkspace } from '../core/sync.js';
import * as ui from '../ui.js';

export const syncCommand = new Command('sync')
  .description(
    '同步外部资源到本地：已登记的外部仓库（tech-specs / biz-tech-docs，clone 或快进拉取，本地改动优先）+ 模板缓存刷新 + Claude 插件按声明安装并检查更新（绝不卸载）',
  )
  .option('--dry-run', '只显示将执行的动作，不落盘')
  .action(async (opts: { dryRun?: boolean }) => {
    const root = requireWorkspaceRoot();
    const settings = await loadSettings(root);
    const steps = await syncWorkspace(root, settings, { dryRun: opts.dryRun === true });
    console.log(ui.bold('同步计划与结果：'));
    for (const s of steps) {
      // 状态标记与 ui.ts 同一字形标准（✔/✖）：此前 ✓/✖ 另成一套，GBK 控制台双套字形易乱码；
      // 且 ui.ok('✓') 会渲染成「✔ ✓」双标记——状态列只取单符号
      const tag =
        s.status === 'done'
          ? pc.green('✔')
          : s.status === 'warn'
            ? pc.yellow('!')
            : s.status === 'failed'
              ? pc.red('✖')
              : pc.dim('·');
      console.log(`  ${tag} ${s.name}：${s.detail}`);
    }
    if (steps.some((s) => s.status === 'failed')) process.exitCode = 1;
  });
