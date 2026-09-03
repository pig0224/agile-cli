# CLAUDE.md — agile-cli 仓库导航

本仓库 = `@fcc/agilecli`（npm 包，bin: `agile`）。配套仓库（独立 git 仓库，非本仓库的一部分）：
- `agile-plugins`（Claude Code 插件市场）：`src/core/paths.ts` 的 `DEFAULT_PLUGIN_MARKETPLACE` 指向其地址
- `agile-templates`（项目模板注册中心）：`DEFAULT_TEMPLATE_REGISTRY` 指向其地址

**修改代码前先读本文。**

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

E2E 冒烟（真实 git 操作，写入 %TEMP%）：`init workspace → repo add <本地裸仓库> → sync → template list → init project --template → doctor`，参考 docs/architecture.md「验证清单」。

## 结构

```
src/core/     ★ 纯逻辑层（必须可单测，禁止依赖 commander / MCP SDK）
              paths / schemas(zod) / config / sync / doctor / status /
              git / task / template-registry / scaffold
src/commands/ 命令层（薄壳：参数解析 → 调 core → 输出）
src/mcp/      MCP Server（复用 core，全部输出 JSON）
test/         vitest 单测
docs/         设计文档
```

## 关键约定

- **core 不写 I/O 入口逻辑**：命令层与 MCP 层只做「入口 → 调 core → 输出」，两个入口行为必然一致。
- **改 sync 行为先改/加 `test/sync.test.ts`；改模板校验先改/加 `test/template-registry.test.ts`。**
- **模板缓存**：`~/.agile/templates/<url哈希>`（用户级只读副本，`git fetch + reset --hard` 刷新，失联降级用缓存，本地目录直读跳过缓存）。
- **本地项目**：`init project` 未给 `--remote` 时登记 `git@placeholder.local:` 占位 URL；sync/doctor/status 通过 `isPlaceholderUrl()` 特判。
- **git 安全默认**：submodule/clone 本地路径统一附加 `-c protocol.file.allow=always`。
- CLI 输出统一走 `src/ui.ts`；错误用 `AgileError`/`GitError`，消息中文。
- 版本：`package.json` 与 git tag `vX.Y.Z` 对齐，release workflow 校验。

## 文档地图

| 文档 | 内容 |
|---|---|
| docs/architecture.md | 总体架构、与两个外部仓库的解耦、gclient 映射、验证清单 |
| docs/sync-engine.md | sync 收敛算法、安全设计、hooks 匹配 |
| docs/mcp.md | MCP 工具契约与注册方式 |
| docs/release.md | 发版流程（npm）、CI 说明 |
