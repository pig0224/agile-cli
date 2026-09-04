import { execa } from 'execa';
import { Command } from 'commander';
import * as ui from '../ui.js';
import { cliVersion } from '../version.js';

const PKG = 'fcc-agile-cli';

/** 查询 npm registry 上最新版本 */
async function latestFromNpm(): Promise<string | null> {
  try {
    const r = await execa('npm', ['view', PKG, 'version'], { reject: false, timeout: 20_000, windowsHide: true });
    if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
    return null;
  } catch {
    return null;
  }
}

async function updateCli(): Promise<void> {
  console.log(ui.info(`当前 CLI 版本：${cliVersion}`));
  const latest = await latestFromNpm();
  if (latest == null) {
    console.log(ui.warn('无法查询 npm registry（私有环境请手动升级或配置 registry）'));
    return;
  }
  if (latest === cliVersion) {
    console.log(ui.ok('CLI 已是最新版本。'));
    return;
  }
  console.log(ui.info(`发现新版本：${latest}，执行自更新…`));
  const r = await execa('npm', ['install', '-g', `${PKG}@latest`], { shell: true, reject: false, windowsHide: true });
  if (r.exitCode === 0) console.log(ui.ok('CLI 已更新，请重开终端使 bin 生效。'));
  else console.log(ui.fail(`自更新失败：${r.stderr || r.stdout}`));
}

async function updatePlugin(): Promise<void> {
  // 插件市场为独立 git 仓库，重新执行安装拉取市场最新版本。
  // 不在 workspace 内时使用官方默认市场，仅跳过 plugin.yaml 登记。
  const { pluginCommand } = await import('./plugin.js');
  await pluginCommand.parseAsync(['install', 'agile'], { from: 'user' });
}

export const updateCommand = new Command('update')
  .description('更新 agile CLI（默认）；--plugin 更新插件；--all 全部更新')
  .option('--plugin', '只更新 agile plugin（重新安装拉取插件市场最新版本）')
  .option('--all', '同时更新 CLI 与插件')
  .action(async (opts: { plugin?: boolean; all?: boolean }) => {
    const doPlugin = opts.plugin === true || opts.all === true;
    const doCli = !doPlugin || opts.all === true;

    if (doCli) await updateCli();
    if (doPlugin) await updatePlugin();
  });
