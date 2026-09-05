# 总体架构

> `fcc-agile-cli`（本仓库）+ 外部两个 git 仓库（[agile-plugins](https://github.com/pig0224/agile-plugins) 插件市场、[agile-templates](https://github.com/pig0224/agile-templates) 模板注册中心）组成完整体系。三者解耦：只有本仓库发 npm，插件与模板的扩展不影响本仓库。

## 1. 单仓模式（核心取舍）

**workspace = 单一 git 仓库**。曾采用多仓 submodule 模式解决角色权限隔离，代价是跨模块变更需要多 PR + 指针滚动。现改为单仓 + CODEOWNERS 目录级权限治理：

- biz-product-docs / projects / process-docs = 普通目录
- **跨模块变更一个 PR 天然原子**（前后端代码 + 过程文档一起 review、一起 merge）
- 发版 = workspace 仓库打 tag（可目录级 tag，如 `projects/order-service/v1.2.0`）
- **外部资源不进 workspace 仓库**：tech-specs（公司级规范，跨团队共享、独立演进、团队无写权限）与 biz-tech-docs（多 workspace 共享的团队知识库，可选）目录写入 .gitignore，各自是独立 git 仓库，由 `agile sync` clone/快进拉取——**本地改动优先，绝不覆盖**（这些目录是可写工作区，知识库命令会直接落盘）

```
workspace/                  # 单一 git 仓库（团队）
├── .gitignore              # 忽略 .worktrees/、tech-specs/、biz-tech-docs/
├── .agile/settings.json    # 唯一配置
├── tech-specs/             # 抽屉一（独立 git 仓库，不入库，sync 管理）
├── biz-tech-docs/          # 抽屉二（默认普通目录；config set 登记为外部仓库后不入库，sync 管理）
├── biz-product-docs/       # 抽屉三（普通目录）
├── projects/               # 抽屉四（普通目录，模板脚手架落此）
└── process-docs/           # 抽屉五（普通目录，STO-xxx 标准任务目录：五文档 + be/fe 角色文件）
```

## 2. 三仓解耦（CLI 与扩展源）

| 交付物 | 分发载体 | 扩展方式 | 本仓库是否需要发版 |
|---|---|---|---|
| `fcc-agile-cli`（CLI，本仓库） | npm | —（本体） | — |
| agile-plugins（插件市场） | git 仓库 | 加 `plugins/<name>/` + 登记 marketplace.json | ❌ |
| agile-templates（模板库） | git 仓库 | 加 `<模板名>/` + 登记 registry.yaml | ❌ |

对接点在 **settings.json**（`plugins.marketplace` / `templates.registry`）。

CLI 对两个仓库的内容零知识：安装插件 = `claude plugin marketplace add <地址>` + `claude plugin install <name>@<市场名>`；使用模板 = clone 模板仓库读 registry.yaml。新增插件/模板对 CLI 完全透明，用户可通过 `agile config set plugin-repo / template-repo` 将两个地址换成团队私有仓库（unset 恢复内置官方源）。

## 3. 分层架构（CLI）

```
┌─────────────────────────────────────────────┐
│ CLI（commander）  MCP Server（stdio）        │  ← 入口层：参数解析 + 输出格式化
├─────────────────────────────────────────────┤
│ src/core/（纯逻辑，可单测）                   │  ← 业务层：schema/同步/校验
│   paths / schemas(zod) / config / sync      │
│   claude-plugins / git / task               │
│   template-registry / scaffold              │
├─────────────────────────────────────────────┤
│ git CLI  │  插件市场 git 仓库 │ 模板 git 仓库 │  ← 外部依赖（地址可配置）
└─────────────────────────────────────────────┘
```

铁律：
- core 不依赖 commander / MCP SDK；命令层与 MCP 层只做「入口 → 调 core → 输出」。
- CLI、MCP 两个入口共享同一 core 实现，行为必然一致。
- **core 不输出**：sync 等核心返回结构化结果（steps），打印由命令层决定（如 worktree 的 autoSync 只打印 warn/failed）。
- 改 sync 行为先改/加 `test/sync.test.ts`；改模板校验先改/加 `test/template-registry.test.ts`。

## 4. 配置文件契约（.agile/settings.json，唯一配置）

```json
{
  "version": 1,
  "name": "my-workspace",
  "created": "2026-09-05",
  "defaultBranch": "main",
  "paths": {
    "techSpecs": "tech-specs",
    "bizTechDocs": "biz-tech-docs",
    "bizProductDocs": "biz-product-docs",
    "projects": "projects",
    "processDocs": "process-docs"
  },
  "repos": {
    "techSpecs": { "url": "git@corp:com/specs.git" },
    "bizTechDocs": { "url": "git@corp:team/kb.git" }
  },
  "plugins": {
    "marketplace": "https://github.com/pig0224/agile-plugins.git",
    "dependencies": { "agile": { "marketplace": "fcc" } }
  },
  "templates": { "registry": "https://github.com/pig0224/agile-templates.git" }
}
```

- `repos` 两键均可缺省（未配置 = sync 提示跳过）；条目 `{ url, ref? }`，`ref` 为版本锁定预留（出现即警告「锁定暂未实现，按最新拉取」）
- `plugins.dependencies` = 插件依赖声明（类 npm package.json）；`agile plugin install/uninstall/update` 与声明联动；安装实况由 Claude Code 全局管理，`agile plugin ls` 输出对照
- `plugins.marketplace` / `templates.registry` 支持换私有源：`agile config set plugin-repo / template-repo`（unset 恢复内置官方源），也可手改

所有配置经 zod schema 校验（[src/core/schemas.ts](../src/core/schemas.ts)），错误信息带字段路径，中文。旧版三 yaml（workspace/registry/plugin）由 `agile init workspace` 自动迁移。

## 5. 自动同步

`agile worktree create` 创建开发环境**前后各自动执行一次 sync**：主仓拉外部资源；worktree 内因外部仓库不入库（settings.json 随仓库检出，tech-specs/biz-tech-docs 需独立 clone）。失败仅警告不阻塞，基于现有状态继续。日常也可手动 `agile sync`（幂等）。

## 6. 验证清单（E2E 冒烟）

在本机 %TEMP% 用本地裸仓库走通以下链路即为基线通过：

```
git init --bare src.git && clone + commit + push      # 准备外部源（tech-specs）
git init --bare tpl.git && clone + registry.yaml + push  # 准备模板源
agile init workspace --name e2e --tech-specs <src.git>    # settings.json + .gitignore 三行
agile sync                    # 骨架目录让位 → clone → 检出
agile sync                    # 幂等：ff-only 无变化
agile config set biz-tech-docs <src.git> && agile config get biz-tech-docs
agile config set plugin-repo <src.git> && agile config set template-repo <tpl.git> && agile config get template-repo
agile config unset plugin-repo && agile config get plugin-repo   # 恢复内置官方源
agile config list             # settings.json 全量
agile template list           # 从模板源拉取注册中心
agile init project order-service --template go-service   # 落 projects/ 普通目录 + git add
agile worktree create feature/STO-001                    # 前后自动 sync（worktree 内独立 clone）
agile worktree remove feature/STO-001
agile plugin install agile && agile plugin ls
node dist/index.js mcp        # JSON-RPC initialize + tools/list；tools/call agile_task_create
```
