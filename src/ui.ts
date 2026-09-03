import pc from 'picocolors';

export const ok = (msg: string) => pc.green(`✔ ${msg}`);
export const info = (msg: string) => pc.cyan(msg);
export const warn = (msg: string) => pc.yellow(`⚠ ${msg}`);
export const fail = (msg: string) => pc.red(`✖ ${msg}`);
export const dim = (msg: string) => pc.dim(msg);
export const bold = (msg: string) => pc.bold(msg);

/** 简易表格输出（无需外部依赖） */
export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      // 可见宽度（去除 ANSI 转义）
      const visible = cell.replace(/\[[0-9;]*m/g, '');
      widths[i] = Math.max(widths[i] ?? 0, visible.length + 2);
    });
  }
  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join(''))
    .join('\n');
}

export function pad(text: string, len: number): string {
  const visible = text.replace(/\[[0-9;]*m/g, '');
  return text + ' '.repeat(Math.max(0, len - visible.length));
}
