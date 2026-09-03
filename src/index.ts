#!/usr/bin/env node
import { Command } from 'commander';
import { AgileError, GitError } from './core/errors.js';
import { cliVersion } from './version.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { statusCommand } from './commands/status.js';
import { repoCommand } from './commands/repo.js';
import { configCommand } from './commands/config.js';
import { doctorCommand } from './commands/doctor.js';
import { worktreeCommand } from './commands/worktree.js';
import { templateCommand } from './commands/template.js';
import { foreachCommand } from './commands/foreach.js';
import { hooksCommand } from './commands/hooks.js';
import { pluginCommand } from './commands/plugin.js';
import { updateCommand } from './commands/update.js';
import { mcpCommand } from './commands/mcp.js';
import pc from 'picocolors';

const program = new Command();

program
  .name('agile')
  .description('一个根、五个抽屉：Workspace 生命周期管理 CLI\n单仓模式：registry.yaml 登记外部仓库（submodule），registry 为唯一事实源。')
  .version(cliVersion, '-v, --version', '查看当前 CLI 版本')
  .addCommand(initCommand)
  .addCommand(syncCommand)
  .addCommand(statusCommand)
  .addCommand(repoCommand)
  .addCommand(configCommand)
  .addCommand(doctorCommand)
  .addCommand(worktreeCommand)
  .addCommand(templateCommand)
  .addCommand(foreachCommand)
  .addCommand(hooksCommand)
  .addCommand(pluginCommand)
  .addCommand(updateCommand)
  .addCommand(mcpCommand);

program
  .command('version')
  .description('查看当前 CLI 版本')
  .action(() => {
    console.log(cliVersion);
  });

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (e instanceof AgileError || e instanceof GitError) {
    console.error(pc.red(`✖ ${e.message}`));
    process.exitCode = 1;
  } else if ((e as Error).message?.includes('unknown command')) {
    console.error(pc.red(`✖ ${(e as Error).message}`));
    process.exitCode = 1;
  } else {
    throw e;
  }
}
