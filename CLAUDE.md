# CLAUDE.md — agile-cli 仓库导航

本仓库 = `fcc-agile-cli`（npm 包，bin: `agile`；GitHub 仓库名 agile-cli）。配套仓库（独立 git 仓库，非本仓库的一部分）：
- `agile-plugins`（Claude Code 插件市场）：`src/core/paths.ts` 的 `DEFAULT_PLUGIN_MARKETPLACE` 指向其地址
- `agile-templates`（项目模板注册中心）：`DEFAULT_TEMPLATE_REGISTRY` 指向其地址

**修改代码前先读本文。**

## 协作红线（优先级最高）

1. **绝对不允许执行 `git add`**：哪些变更进入提交，由人工审阅决定。完成修改后，列出变更文件清单与建议的 commit message，等待人工 add。
2. **人工 add 完成后，可汇总执行 `git commit`**：但 commit 前必须先 `git status` 检查——若仍有本次变更相关的未暂存文件，停下来提醒人工补充 add（不得自行 add）；确认全部已暂存后才执行 commit。
3. **不允许执行 `git push`**（含 tag 推送、以及内部会执行 add/commit/push 的命令）：推送一律人工处理。
4. **决不允许发版**：创建/推送 tag、执行 `npm run release`、触发 Release workflow、`npm publish` 等一切发版动作，只能由人工处理。
5. 只读 git 命令（status / log / diff / blame / fetch）不受限制。

## 核心模型（单仓模式）

- workspace = **单一 git 仓库**：biz-tech-docs / biz-product-docs / projects / process-docs 都是普通目录
- **registry.yaml = 外部仓库登记处**（唯一事实源）：只登记 tech-specs 这类公司级外部 submodule；`sync` 把磁盘收敛到声明状态
- projects 内项目由 `init project` 从模板生成（普通目录 + git add，**不走 submodule**）
- 跨模块变更一个 PR 天然原子——不存在多仓 PR/分支聚合问题

## 常用命令

```bash
pnpm install
pnpm build          # tsc → dist/
pnpm test           # vitest（test/）
pnpm typecheck
node dist/index.js --help
node dist/index.js template check --registry ../agile-templates   # 兄弟模板仓库直读模式
claude plugin validate ../agile-plugins                            # 兄弟插件市场校验
```

E2E 冒烟（真实 git 操作，写入 %TEMP%）：`init workspace → repo add <本地裸仓库> → sync → template list → init project --template → foreach → worktree create → doctor`，参考 docs/architecture.md「验证清单」。

## 结构

```
src/core/     ★ 纯逻辑层（必须可单测，禁止依赖 commander / MCP SDK）
              paths / schemas(zod) / config / sync / doctor / status /
              git / task / template-registry / scaffold / projects
src/commands/ 命令层（薄壳：参数解析 → 调 core → 输出）
src/mcp/      MCP Server（复用 core，全部输出 JSON）
scripts/      release.mjs（发版脚本：质量门→CHANGELOG 生成→tag）+ lib/ + build.mjs + extract-release-notes.mjs
test/         vitest 单测
docs/         设计文档
```

## 关键约定

- **core 不写 I/O 入口逻辑**：命令层与 MCP 层只做「入口 → 调 core → 输出」，两个入口行为必然一致。
- **改 sync 行为先改/加 `test/sync.test.ts`；改 projects 遍历先改/加 `test/projects.test.ts`；改模板校验先改/加 `test/template-registry.test.ts`。**
- **worktree create 自动 sync**（`src/commands/worktree.ts` 的 autoSync）：失败仅警告不阻塞。
- **task 能力无 CLI 命令**：仅 MCP 工具 `agile_task_create` 暴露（core/task.ts 供 MCP 调用）。
- **模板缓存**：`~/.agile/templates/<url哈希>`（用户级只读副本，fetch+reset 刷新，失联降级用缓存，本地目录直读跳过缓存）。
- **git 安全默认**：submodule/clone 本地路径统一附加 `-c protocol.file.allow=always`。
- CLI 输出统一走 `src/ui.ts`；错误用 `AgileError`/`GitError`，消息中文。
- **发版 = `npm run release`（人工执行）**：质量门（typecheck/test/build）→ 依据 Conventional Commits 自动生成 CHANGELOG 段落并建议版本号（feat→minor、fix→patch、`!`/BREAKING CHANGE→major）→ bump package.json → commit → tag → push → release.yml 等 CI 通过后发 npm。commit message 必须遵循 Conventional Commits（破坏性用 `!` 或 `BREAKING CHANGE:`）。

## 文档地图

| 文档 | 内容 |
|---|---|
| docs/architecture.md | 总体架构（单仓模式）、三仓解耦、验证清单 |
| docs/sync-engine.md | sync 收敛算法、安全设计 |
| docs/mcp.md | MCP 工具契约与注册方式 |
| docs/release.md | 发版流程（npm）、CI 说明 |
