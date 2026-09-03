import { Command } from 'commander';
import { requireWorkspaceRoot } from '../core/paths.js';
import { runDoctor } from '../core/doctor.js';
import * as ui from '../ui.js';

export const doctorCommand = new Command('doctor')
  .description('检测工作空间健康问题（配置错误、权限不足、registry/gitmodules/磁盘漂移等）')
  .option('--fix', '自动修复可修复项（移除无权限/非法仓库等）')
  .option('--offline', '跳过远端可达性检查')
  .option('--json', '输出 JSON（供 AI / MCP 消费）')
  .action(async (opts: { fix?: boolean; offline?: boolean; json?: boolean }) => {
    const root = requireWorkspaceRoot();
    const result = await runDoctor(root, { fix: opts.fix, offline: opts.offline });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(ui.bold(`健康检查（检查了 ${result.checked.repos} 个仓库，${result.checked.remotes} 个远端）：`));
      console.log('');
      if (result.issues.length === 0) {
        console.log(ui.ok('工作空间健康，无问题。'));
      } else {
        for (const issue of result.issues) {
          const tag = issue.level === 'error' ? ui.fail(`[${issue.code}]`) : ui.warn(`[${issue.code}]`);
          console.log(`  ${tag} ${issue.message}`);
        }
        const fixable = result.issues.filter((i) => i.fixable).length;
        if (fixable > 0 && !opts.fix) {
          console.log('');
          console.log(ui.dim(`其中 ${fixable} 项可自动修复：运行 agile doctor --fix`));
        }
      }
      for (const f of result.fixes) console.log(ui.ok(f));
    }

    const hasError = result.issues.some((i) => i.level === 'error');
    if (hasError) process.exitCode = 1;
  });
