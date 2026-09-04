#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 提取指定版本的段落，写入目标文件（供 release workflow 作为
 * GitHub Release 的 body）。用法：node extract-release-notes.mjs <vX.Y.Z> <输出文件>
 * 版本段落不存在时写入兜底说明（release 仍会创建，附自动生成的 PR notes）。
 */
import fs from 'node:fs/promises';

const [tag, outFile] = process.argv.slice(2);
if (!tag || !outFile) {
  console.error('用法：node extract-release-notes.mjs <vX.Y.Z> <输出文件>');
  process.exit(1);
}

const changelog = await fs.readFile('CHANGELOG.md', { encoding: 'utf8' }).catch(() => '');
const header = `## ${tag}`;
const start = changelog.indexOf(header);

let body;
if (start === -1) {
  body = `> ${tag}（CHANGELOG 段落缺失，请查看 CHANGELOG.md）\n`;
} else {
  const rest = changelog.slice(start + header.length);
  const nextHeading = rest.search(/^## /m);
  // 跳过段落标题行的日期残余（## vX.Y.Z (日期)）
  const section = rest.slice(0, nextHeading === -1 ? rest.length : nextHeading);
  body = section.split('\n').slice(1).join('\n').trim() + '\n';
}

await fs.writeFile(outFile, body, 'utf8');
console.log(`✔ 已提取 ${tag} 的更新说明（${body.length} 字符）`);
