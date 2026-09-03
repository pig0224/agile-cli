# 总体架构

> `agile-cli`（本仓库）+ 外部两个 git 仓库（[agile-plugins](https://github.com/pig0224/agile-plugins) 插件市场、[agile-templates](https://github.com/pig0224/agile-templates) 模板注册中心）组成完整体系。三者解耦：只有本仓库发 npm，插件与模板的扩展不影响本仓库。

## 1. 三仓解耦

| 交付物 | 分发载体 | 扩展方式 | 本仓库是否需要发版 |
|---|---|---|---|
| `agile-cli`（CLI，本仓库） | npm | —（本体） | — |
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

## 2. gclient 概念映射

| depot_tools/gclient | 本项目 | 说明 |
|---|---|---|
| `.gclient` | `.agile/workspace.yaml` | workspace 元信息：名称、默认分支、抽屉路径、hooks、插件市场/模板源 |
| `DEPS` | `.agile/registry.yaml` | 依赖清单（path → url/branch/pin），**唯一事实源** |
| `gclient sync` | `agile sync` | 三方 diff（registry ↔ .gitmodules ↔ 磁盘）+ 收敛执行 |
| `gclient runhooks` | `agile hooks run` | post-sync 钩子（依赖安装、codegen） |
| `gclient recurse` | `agile foreach` | 遍历仓库执行命令 |
| `gclient`（无对应） | `agile doctor` | 补充：健康检查与自动修复 |

**与 gclient 的关键差异**：gclient 用纯 git checkout 平铺管理依赖，不写 `.gitmodules`；本项目按需求采用 **git submodule** 组织，registry.yaml 扮演 DEPS 的角色——声明期望状态，`sync` 负责收敛，`doctor` 负责报告不可收敛项。

## 3. 分层架构

```
┌─────────────────────────────────────────────┐
│ CLI（commander）  MCP Server（stdio）        │  ← 入口层：参数解析 + 输出格式化
├─────────────────────────────────────────────┤
│ src/core/（纯逻辑，可单测）                   │  ← 业务层：schema/计划计算/校验
│   paths / schemas(zod) / config / sync      │
│   doctor / status / git / task              │
│   template-registry / scaffold              │
├─────────────────────────────────────────────┤
│ git CLI  │  插件市场 git 仓库 │ 模板 git 仓库 │  ← 外部依赖（地址可配置）
└─────────────────────────────────────────────┘
```

铁律：
- core 不依赖 commander / MCP SDK；命令层与 MCP 层只做「入口 → 调 core → 输出」。
- CLI、MCP 两个入口共享同一 core 实现，行为必然一致。
- 改 sync 行为先改/加 `test/sync.test.ts`；改模板校验先改/加 `test/template-registry.test.ts`。

## 4. 配置文件契约

**workspace.yaml**：`version(1) / name / created / defaultBranch / paths{五抽屉} / plugin{marketplace} / templates{registry} / hooks[{match,run}]`

**registry.yaml**：`version(1) / repositories{ <相对路径>: {url, branch?, pin?} }`
- key = submodule path（如 `projects/order-service`），抽屉分组由路径前缀天然表达
- `pin` 存在时 sync 精确 checkout 到该 commit（≈ gclient revision）
- `url` 以 `git@placeholder.local:` 开头 = 本地项目（未推送远端），sync/doctor/status 特判

**plugin.yaml**：`version(1) / plugins{ <name>: {source(市场地址), enabled, version?} }`

所有 yaml 经 zod schema 校验（[src/core/schemas.ts](../src/core/schemas.ts)），错误信息带文件名与字段路径，中文。

## 5. 验证清单（E2E 冒烟）

在本机 %TEMP% 用本地裸仓库走通以下链路即为基线通过：

```
git init --bare src.git && clone + commit + push      # 准备远端
agile init workspace --name e2e --template-registry ../agile-templates
agile repo add tech-specs <src.git>
agile sync                    # 骨架目录让位 → submodule add → 检出
agile status / agile doctor --offline
agile template list           # 从模板源拉取注册中心
agile init project order-service --template go-service
agile worktree create projects/order-service feature/STO-001 && remove
agile task create STO-001
agile plugin install agile --marketplace ../agile-plugins
node dist/index.js mcp        # JSON-RPC initialize + tools/list + agile_status
```
