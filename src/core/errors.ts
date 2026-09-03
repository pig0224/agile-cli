/** CLI 统一错误类型：携带用户可读的中文提示 */
export class AgileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgileError';
  }
}

export class GitError extends Error {
  constructor(message: string, readonly args: string[], readonly stderr: string) {
    super(message);
    this.name = 'GitError';
  }
}
