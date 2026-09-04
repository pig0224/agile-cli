import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** CLI 版本号：单一事实源 = package.json（避免硬编码脱节，如 --version 显示旧版本） */
export const cliVersion: string = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    version: string;
  }
).version;
