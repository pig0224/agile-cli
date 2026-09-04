#!/usr/bin/env node
/**
 * CLI 构建：esbuild 打包为单文件（minify + 无 sourcemap）。
 * - 产物 dist/index.js 自包含（依赖已内联），npm 包只需 dist + templates
 * - 类型检查仍由 tsc --noEmit 负责（pnpm typecheck）
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  minify: true,
  charset: 'utf8',
  sourcemap: false,
  legalComments: 'none',
  // ESM 产物中 CJS 依赖的 require() 落到 shim，注入真实 createRequire 避免抛错
  banner: {
    js: `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});
