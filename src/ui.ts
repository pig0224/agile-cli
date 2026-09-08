import pc from 'picocolors';

export const ok = (msg: string) => pc.green(`✔ ${msg}`);
export const info = (msg: string) => pc.cyan(msg);
export const warn = (msg: string) => pc.yellow(`⚠ ${msg}`);
export const fail = (msg: string) => pc.red(`✖ ${msg}`);
export const dim = (msg: string) => pc.dim(msg);
export const bold = (msg: string) => pc.bold(msg);
