import { execa } from 'execa';
import { Command } from 'commander';
import * as ui from '../ui.js';
import { cliVersion } from '../version.js';

const PKG = 'fcc-agile-cli';

/** semver（x.y.z）比较：a 严格大于 b 时为 true（防 npm latest 回滚/异常旧版触发降级安装） */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

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
    if (!isNewer(latest, cliVersion)) {
      console.log(ui.warn(`npm 上的最新版本（${latest}）不高于当前版本（${cliVersion}），跳过自更新（避免降级）`));
      return;
    }
    console.log(ui.info(`发现新版本：${latest}，执行自更新…`));
    const r = await execa('npm', ['install', '-g', `${PKG}@latest`], { shell: true, reject: false, windowsHide: true });
    if (r.exitCode === 0) console.log(ui.ok('CLI 已更新，请重开终端使 bin 生效。'));
    else console.log(ui.fail(`自更新失败：${r.stderr || r.stdout}`));
  });
