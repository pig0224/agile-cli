# 贡献指南（CONTRIBUTING）

感谢关注 fcc-agile-cli！欢迎任何形式的贡献：bug 报告、文档改进、功能建议、代码 PR。

## 环境搭建

```bash
git clone git@github.com:pig0224/agile-cli.git
cd agile-cli
pnpm install        # Node ≥ 24，pnpm ≥ 10
pnpm build && pnpm test   # 验证环境
node dist/index.js --help # 本地试用
```

## 开发流程

1. **从 main 创建分支**（推荐使用 agile worktree，普通分支也可以）：

   ```bash
   git checkout -b feat/your-feature
   ```

2. **开发并测试**：`pnpm typecheck && pnpm test && pnpm build` 全绿后再提交（push 时本地钩子会再次校验）。
3. **提交**：遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)——

   ```
   feat: 支持xxx        # 新功能（minor）
   fix: 修复xxx         # 修复（patch）
   docs: 文档xxx        # 文档
   chore: 构建/工具xxx   # 杂项
   feat!: 破坏性变更     # major（或提交尾行 BREAKING CHANGE: <说明>）
   ```

   > 注：commit 由贡献者执行；协作中的 AI 助手不得执行 git add/commit/push（见仓库 CLAUDE.md 协作红线）。

4. **推送并开 PR**：`git push origin feat/your-feature` → 在 GitHub 开 PR（指向 main）。
5. **CI 门禁**：PR 会自动跑 typecheck / test / build / CLI 冒烟（Node 24），全绿是合并前提。
6. **Review**：CODEOWNERS 会自动请求维护者 review；approve 后合并（squash）。

## 发布（维护者）

[release-please](https://github.com/googleapis/release-please) 自动维护 Release PR（CHANGELOG + 版本 bump）——merge 该 PR 即自动打 tag 并发布 npm。详见 [docs/release.md](./docs/release.md)。

## 报告问题

使用 [issue 模板](https://github.com/pig0224/agile-cli/issues/new/choose)：bug 请附 `agile doctor --json` 输出与复现步骤。行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 设计文档

修改核心逻辑前请阅读 [CLAUDE.md](./CLAUDE.md)（分层约定、测试要求）与 [docs/](./docs/)（架构、sync 引擎、MCP 契约）。
