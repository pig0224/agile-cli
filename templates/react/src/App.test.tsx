import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('可被导入（占位测试，TDD 时替换为真实用例）', () => {
    expect(App).toBeTypeOf('function');
  });
});
