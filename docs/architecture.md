# 总体架构

> `fcc-agile-cli`（本仓库）+ 外部两个 git 仓库（[agile-plugins](https://github.com/pig0224/agile-plugins) 插件市场、[agile-templates](https://github.com/pig0224/agile-templates) 模板注册中心）组成完整体系。三者解耦：只有本仓库发 npm，插件与模板的扩展不影响本仓库。

## 1. 单仓模式（核心取舍）

**workspace = 单一 git 仓库**。曾采用多仓 submodule 模式解决角色权限隔离，代价是跨模块变更需要多 PR + 指针滚动。现改为单仓 + CODEOWNERS 目录级权限治理：

- biz-tech-docs / biz-product-docs / projects / process-docs = 普通目录
- **跨模块变更一个 PR 天然原子**（前后端代码 + 过程文档一起 review、一起 merge）
- 发版 = workspace 仓库打 tag（可目录级 tag，如 `projects/order-service/v1.2.0`）
- **registry.yaml 收窄为外部仓库登记处**：只管 tech-specs 这类公司级 submodule（跨团队共享、独立演进、团队无写权限），`agile sync` 收敛，pin 可锁版本

```
workspace/                  # 单一 git 仓库（团队）
├── .gitmodules             # 仅外部 submodule
├── .agile/                 # workspace.yaml / registry.yaml / plugin.yaml
├── tech-specs/             # 抽屉一（submodule，sync 管理）
├── biz-tech-docs/          # 抽屉二（普通目录）
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

对接点在 **workspace.yaml**：

```yaml
plugin:
  marketplace: https://github.com/pig0224/agile-plugins.git   # 插件市场
templates:
  registry: https://github.com/pig0224/agile-templates.git  # 模板源
```

CLI 对两个仓库的内容零知识：安装插件 = `claude plugin marketplace add <地址>` + `claude plugin install <name>@<市场名>`；使用模板 = clone 模板仓库读 registry.yaml。新增插件/模板对 CLI 完全透明，用户可将两个地址换成团队私有仓库。

## 3. 分层架构（CLI）

```
┌─────────────────────────────────────────────┐
│ CLI（commander）  MCP Server（stdio）        │  ← 入口层：参数解析 + 输出格式化
├─────────────────────────────────────────────┤
│ src/core/（纯逻辑，可单测）                   │  ← 业务层：schema/计划计算/校验
│   paths / schemas(zod) / config / sync      │
│   doctor / status / git / task              │
│   template-registry / scaffold / projects   │
├─────────────────────────────────────────────┤
│ git CLI  │  插件市场 git 仓库 │ 模板 git 仓库 │  ← 外部依赖（地址可配置）
└─────────────────────────────────────────────┘
```

铁律：
- core 不依赖 commander / MCP SDK；命令层与 MCP 层只做「入口 → 调 core → 输出」。
- CLI、MCP 两个入口共享同一 core 实现，行为必然一致。
- 改 sync 行为先改/加 `test/sync.test.ts`；改模板校验先改/加 `test/template-registry.test.ts`；改 projects 遍历先改/加 `test/projects.test.ts`。

## 4. 配置文件契约

**workspace.yaml**：`version(1) / name / created / defaultBranch / paths{五抽屉} / plugin{marketplace} / templates{registry} / hooks[{match,run}]`
- hooks 的 `match` 匹配 `projects/<name>`（glob），`hooks run` 遍历 projects 执行

**registry.yaml**：`version(1) / repositories{ <相对路径>: {url, branch?, pin?} }`
- 只登记外部 submodule（如 tech-specs）；key = submodule path
- `pin` 存在时 sync 精确 checkout 到该 commit（锁版本，适合规范仓库稳定性要求高的场景）

**plugin.yaml**：`version(1) / plugins{ <name>: {source(市场地址), enabled, version?} }`

所有 yaml 经 zod schema 校验（[src/core/schemas.ts](../src/core/schemas.ts)），错误信息带文件名与字段路径，中文。

## 5. 自动同步

`agile worktree create` 创建开发环境前自动执行 sync（外部仓库拉到最新；失败仅警告不阻塞，基于现有状态创建）。日常也可手动 `agile sync`（幂等，registry 为唯一事实源）。

## 6. 验证清单（E2E 冒烟）

在本机 %TEMP% 用本地裸仓库走通以下链路即为基线通过：

```
git init --bare src.git && clone + commit + push      # 准备远端
agile init workspace --name e2e --template-registry ../agile-templates
agile repo add tech-specs <src.git>
agile sync                    # 骨架目录让位 → submodule add → 检出
agile status / agile doctor --offline
agile template list           # 从模板源拉取注册中心
agile init project order-service --template go-service   # 落 projects/ 普通目录 + git add
agile foreach 'git status --porcelain'
agile worktree create feature/STO-001 && agile worktree remove feature/STO-001
agile plugin install agile --marketplace ../agile-plugins
node dist/index.js mcp        # JSON-RPC initialize + tools/list；tools/call agile_task_create
```
