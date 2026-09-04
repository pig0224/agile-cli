import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from './core/paths.js';

/** CLI 版本号：单一事实源 = package.json（避免硬编码脱节，如 --version 显示旧版本） */
export const cliVersion: string = (
  JSON.parse(readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')) as { version: string }
).version;
