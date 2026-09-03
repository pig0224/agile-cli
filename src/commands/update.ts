import { execa } from 'execa';
import { Command } from 'commander';
import * as ui from '../ui.js';
import { cliVersion } from '../version.js';

/** 查询 npm registry 上最新版本 */
async function latestFromNpm(): Promise<string | null> {
  try {
    const r = await execa('npm', ['view', 'fcc-agile-cli', 'version'], { reject: false, timeout: 20_000, windowsHide: true });
    if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
    return null;
  } catch {
    return null;
  }
}

export const updateCommand = new Command('update')
  .description('更新 agile CLI 自身 / agile plugin')
  .option('--cli', '只更新 CLI（npm install -g fcc-agile-cli@latest）')
  .option('--plugin', '只更新 agile plugin（重新安装本地 marketplace 指向）')
  .action(async (opts: { cli?: boolean; plugin?: boolean }) => {
    // 默认两者都检查
    const doCli = opts.cli || (!opts.cli && !opts.plugin);
    const doPlugin = opts.plugin || (!opts.cli && !opts.plugin);

    if (doCli) {
      console.log(ui.info(`当前 CLI 版本：${cliVersion}`));
      const latest = await latestFromNpm();
      if (latest == null) {
        console.log(ui.warn('无法查询 npm registry（私有环境请手动升级或配置 registry）'));
      } else if (latest === cliVersion) {
        console.log(ui.ok('CLI 已是最新版本。'));
      } else {
        console.log(ui.info(`发现新版本：${latest}，执行自更新…`));
        const r = await execa('npm', ['install', '-g', 'fcc-agile-cli@latest'], { shell: true, reject: false, windowsHide: true });
        if (r.exitCode === 0) console.log(ui.ok('CLI 已更新，请重开终端使 bin 生效。'));
        else console.log(ui.fail(`自更新失败：${r.stderr || r.stdout}`));
      }
    }

    if (doPlugin) {
      // 插件市场为独立 git 仓库，重新执行安装拉取市场最新版本
      const { pluginCommand } = await import('./plugin.js');
      await pluginCommand.parseAsync(['install', 'agile'], { from: 'user' });
    }
  });
