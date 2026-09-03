import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { loadRegistry, loadWorkspace } from '../core/config.js';
import { collectStatus } from '../core/status.js';
import * as ui from '../ui.js';

export const statusCommand = new Command('status')
  .description('查看各仓库的 branch / commit / dirty 状态及与 pin 的偏差')
  .option('--json', '输出 JSON（供 AI / MCP 消费）')
  .action(async (opts: { json?: boolean }) => {
    const root = requireWorkspaceRoot();
    const registry = await loadRegistry(root);
    const statuses = await collectStatus(root, registry);

    if (opts.json) {
      console.log(JSON.stringify({ root, repos: statuses }, null, 2));
      return;
    }

    const workspace = await loadWorkspace(root);
    console.log(ui.bold(`workspace: ${workspace.name}（${root}）`));
    console.log('');

    const rows: string[][] = [[pc('仓库'), pc('分支'), pc('HEAD'), pc('状态')]];
    for (const s of statuses) {
      const state = !s.exists
        ? ui.warn('未检出')
        : s.error
          ? ui.fail('异常')
          : s.drifted
            ? ui.warn(`pin 漂移 → ${s.pin?.slice(0, 8)}`)
            : s.dirty
              ? ui.warn('dirty')
              : ui.ok('干净');
      rows.push([s.repoPath, s.branch ?? '-', s.commit ?? '-', state]);
    }
    console.log(ui.table(rows));
  });

function pc(s: string): string {
  return ui.bold(s);
}
