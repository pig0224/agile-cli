# FCC-Agile-Cli

[![CI](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml)
[![Release](https://github.com/pig0224/agile-cli/actions/workflows/release.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/fcc-agile-cli.svg)](https://www.npmjs.com/package/fcc-agile-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

📖 **完整文档**：https://pig0224.github.io/agile-docs/ （命令参考 / MCP / 使用流程 / 插件与模板指南）

**One root, five drawers** — 一个 workspace 根 + 五个抽屉的研发工作区 CLI。

**单仓模式**：整个团队一个 git 仓库（biz-tech-docs / projects / process-docs 都是普通目录），跨模块变更一个 PR 天然原子；只有公司级规范（tech-specs 等）作为外部 submodule 由 `.agile/registry.yaml` 登记、`agile sync` 收敛——**registry 是唯一事实源**。

**本仓库只做 CLI（npm 包）**。配套的两个 git 仓库与本 CLI 解耦，扩展它们不需要本仓库发版：

| 仓库 | 职责 |
|---|---|
| [agile-plugins](https://github.com/pig0224/agile-plugins) | Claude Code 插件市场（SDD/TDD 插件） |
| [agile-templates](https://github.com/pig0224/agile-templates) | 项目模板注册中心（registry.yaml + 模板目录） |

## 安装

```bash
npm install -g fcc-agile-cli
```

> Node ≥ 24，git ≥ 2.30。插件与模板由各自 git 仓库分发，无需 npm。

## 5 分钟上手

```bash
# 1. 初始化工作区（.agile 三个 yaml + 五个抽屉骨架 + git init）
mkdir my-workspace && cd my-workspace
agile init workspace --name my-workspace

# 2. 登记公司规范仓库（唯一需要 submodule 的抽屉）
agile repo add tech-specs git@gitlab.corp:specs/tech-specs.git
agile sync

# 3. 新建项目（模板来自模板注册中心 git 仓库，落 projects/ 普通目录）
agile template list
agile init project order-service --template go-service

# 4. 日常
agile status                    # 外部仓库状态总览
agile foreach 'npm test'        # 遍历 projects/ 下全部项目执行命令
agile worktree create feature/STO-001   # 完整开发环境（自动先 sync 外部仓库）
agile doctor                    # 健康检查（配置/权限/漂移），--fix 自动修复

# 5. 安装 Claude Code 插件（SDD/TDD 流程）
agile plugin install agile
```

## 工作区结构（一个根、五个抽屉）

```
my-workspace/                    # 单一 git 仓库（团队）
├── .gitmodules                  # 仅外部 submodule（由 agile sync 维护）
├── .agile/
│   ├── workspace.yaml           # workspace 元信息
│   │                            #   ├─ plugin.marketplace   插件市场 git 地址
│   │                            #   └─ templates.registry   模板注册中心 git 地址
│   ├── registry.yaml            # 外部仓库登记处（唯一事实源）
│   └── plugin.yaml              # 已安装插件登记
├── tech-specs/                  # 抽屉一：公司级技术规范（submodule）
├── biz-tech-docs/               # 抽屉二：团队技术设计知识库（普通目录）
├── biz-product-docs/            # 抽屉三：产品设计知识库（普通目录）
├── projects/                    # 抽屉四：项目代码（普通目录，模板脚手架直接落此）
└── process-docs/                # 抽屉五：过程产物（STO-xxx 五文档，普通目录）
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `agile init workspace` | 初始化工作区骨架与 `.agile` 配置（含插件市场/模板源地址） |
| `agile init project <name> [--template <t>]` | 创建项目到 projects/（--template 从模板生成，缺省为空项目骨架；普通目录，git add） |
| `agile template list/update/check` | 模板注册中心：查看 / 刷新缓存 / 一致性校验 |
| `agile sync [--repo] [--force] [--dry-run] [--quiet]` | 收敛外部 submodule 到 registry 声明状态 |
| `agile status [--json]` | 外部仓库状态总览（AI 友好 JSON 输出） |
| `agile repo add/remove/list/pin/unpin/set-url/set-branch` | registry 条目管理 |
| `agile config get/set/list/unset` | workspace.yaml 增删改查 |
| `agile doctor [--fix] [--offline]` | 健康检查：配置校验、远端权限、三方漂移 |
| `agile worktree create/list/remove` | workspace 根仓库 worktree（create 自动 sync） |
| `agile foreach '<cmd>' [--group glob]` | 遍历 projects/ 下项目执行命令 |
| `agile hooks run/list` | 项目钩子（批量依赖安装、codegen 等） |
| `agile plugin install/enable/disable/list` | 插件管理（市场 = git 仓库，`--marketplace` 可换源） |
| `agile update --cli` | CLI 自更新（npm） |
| `agile mcp` | 启动 stdio MCP Server |

> 任务目录（STO-xxx 五文档）不注册 CLI 命令，仅通过 MCP 工具 `agile_task_create` 暴露（供插件命令 /agile:sync-req 等调用）。

## 自动同步

`agile worktree create` 创建开发环境前会**自动执行 sync**（外部仓库拉到最新，失败仅警告不阻塞）。日常场景也可手动 `agile sync`（幂等）。

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

发版：维护者执行 `npm run release`（自动生成 CHANGELOG 段落、建议版本号、打 tag），npm publish 由 GitHub Actions 执行（详见 [docs/release.md](./docs/release.md)）。commit message 请遵循 Conventional Commits。

## License

[MIT](./LICENSE) © FCC contributors
