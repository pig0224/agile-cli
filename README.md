# @fcc/agilecli

[![CI](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml)
[![Release](https://github.com/pig0224/agile-cli/actions/workflows/release.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@fcc/agilecli.svg)](https://www.npmjs.com/package/@fcc/agilecli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**One root, five drawers** — 一个 workspace 根 + 五个知识/代码抽屉的研发工作区 CLI，设计参考 Chromium 的 [depot_tools/gclient](https://chromium.googlesource.com/chromium/tools/depot_tools/)：`.agile/registry.yaml` 是唯一事实源（≈ DEPS），`agile sync` 把磁盘状态收敛到声明状态。

**本仓库只做 CLI（npm 包）**。配套的两个 git 仓库与本 CLI 解耦，扩展它们不需要本仓库发版：

| 仓库 | 职责 |
|---|---|
| [agile-plugins](https://github.com/pig0224/agile-plugins) | Claude Code 插件市场（SDD/TDD 插件） |
| [agile-templates](https://github.com/pig0224/agile-templates) | 项目模板注册中心（registry.yaml + 模板目录） |

## 安装

```bash
npm install -g @fcc/agilecli
```

> Node ≥ 18，git ≥ 2.30。插件与模板由各自 git 仓库分发，无需 npm。

## 5 分钟上手

```bash
# 1. 初始化工作区（.agile 三个 yaml + 五个抽屉骨架 + git init）
mkdir my-workspace && cd my-workspace
agile init workspace --name my-workspace

# 2. 登记五个抽屉的仓库（公司/团队的 git 地址）
agile repo add tech-specs git@gitlab.corp:specs/tech-specs.git
agile repo add biz-tech-docs git@gitlab.corp:team/biz-tech-docs.git
agile repo add biz-product-docs git@gitlab.corp:team/biz-product-docs.git

# 3. 一键同步（拉齐全部 submodule，幂等可重跑）
agile sync

# 4. 新建项目（模板来自模板注册中心 git 仓库）
agile template list                                   # 查看可用模板
agile init project order-service --template go-service

# 5. 日常
agile status                    # 各仓库 branch/commit/dirty/pin 总览
agile worktree create projects/order-service feature/STO-001   # 隔离开发环境
agile task create STO-001       # process-docs/STO-001 五文档骨架
agile doctor                    # 健康检查（配置/权限/漂移），--fix 自动修复

# 6. 安装 Claude Code 插件（SDD/TDD 流程，来自插件市场 git 仓库）
agile plugin install agile
```

## 工作区结构（一个根、五个抽屉）

```
my-workspace/                    # Workspace 根 Git Repo
├── .gitmodules                  # 由 agile sync 维护
├── .agile/
│   ├── workspace.yaml           # workspace 元信息（≈ .gclient）
│   │                            #   ├─ plugin.marketplace   插件市场 git 地址
│   │                            #   └─ templates.registry   模板注册中心 git 地址
│   ├── registry.yaml            # 仓库注册中心（≈ DEPS，唯一事实源）
│   └── plugin.yaml              # 已安装插件登记
├── tech-specs/                  # 抽屉一：公司级技术规范（submodule）
├── biz-tech-docs/               # 抽屉二：团队技术设计知识库（submodule）
├── biz-product-docs/            # 抽屉三：产品设计知识库（submodule）
├── projects/                    # 抽屉四：项目代码（submodule group）
└── process-docs/                # 抽屉五：过程产物（STO-xxx 五文档，根仓库内）
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `agile init workspace` | 初始化工作区骨架与 `.agile` 配置（含插件市场/模板源地址） |
| `agile init project <name> --template <t>` | 从模板注册中心生成项目 + 注册 registry + 挂载 submodule |
| `agile template list/update/check` | 模板注册中心：查看 / 刷新缓存 / 一致性校验 |
| `agile sync [--repo] [--force] [--dry-run] [--no-hooks]` | 收敛磁盘状态到 registry（gclient sync 风格） |
| `agile status [--json]` | 仓库状态总览（AI 友好 JSON 输出） |
| `agile repo add/remove/list/pin/unpin/set-url/set-branch` | registry 条目管理 |
| `agile config get/set/list/unset` | workspace.yaml 增删改查 |
| `agile doctor [--fix] [--offline]` | 健康检查：配置校验、远端权限、三方漂移 |
| `agile worktree create/list/remove` | git worktree 开发环境管理 |
| `agile task create/list/status` | 过程产物任务目录（STO-xxx 五文档模板） |
| `agile hooks run/list` | post-sync 钩子（≈ gclient runhooks） |
| `agile foreach '<cmd>' [--group glob]` | 遍历仓库执行命令（≈ gclient recurse） |
| `agile plugin install/enable/disable/list` | 插件管理（市场 = git 仓库，`--marketplace` 可换源） |
| `agile update --cli` | CLI 自更新（npm） |
| `agile mcp` | 启动 stdio MCP Server |

## MCP / AI 集成

`agile mcp` 暴露 8 个工具：`agile_workspace_info`、`agile_status`、`agile_sync`（默认 dry-run）、`agile_doctor`、`agile_template_list`、`agile_task_create`、`agile_config_list`、`agile_repo_list`。项目 `.mcp.json` 接入：

```json
{ "mcpServers": { "agile": { "command": "agile", "args": ["mcp"] } } }
```

## 开发

```bash
pnpm install
pnpm build && pnpm test && pnpm typecheck
node dist/index.js --help                       # 本地试用
node dist/index.js template check --registry ../agile-templates   # 用兄弟仓库做本地验证
```

结构：`src/core/`（纯逻辑，可单测）→ `src/commands/`（commander 薄壳）/ `src/mcp/`（MCP Server）→ `test/`（vitest）。详见 [CLAUDE.md](./CLAUDE.md) 与 [docs/](./docs/)。

发版：`package.json` 版本号与 git tag 对齐，推送 `v*` tag 触发 [release workflow](./.github/workflows/release.yml) 自动发布 npm（需 `NPM_TOKEN` secret）。

## License

[MIT](./LICENSE) © fcc-agile contributors
