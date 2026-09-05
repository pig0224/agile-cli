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

export const updateCommand = new Command('update')
  .description('更新 agile CLI 到 npm 最新版本')
  .action(async () => {
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
  });
