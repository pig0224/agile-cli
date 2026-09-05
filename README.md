# FCC-Agile-Cli

[![CI](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml)
[![Release](https://github.com/pig0224/agile-cli/actions/workflows/release.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/fcc-agile-cli.svg)](https://www.npmjs.com/package/fcc-agile-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

📖 **完整文档**：https://pig0224.github.io/agile-docs/ （命令参考 / MCP / 使用流程 / 插件与模板指南）

**One root, five drawers** — 一个 workspace 根 + 五个抽屉的研发工作区 CLI。

**单仓模式**：整个团队一个 git 仓库（biz-product-docs / projects / process-docs 都是普通目录），跨模块变更一个 PR 天然原子。外部资源（公司级规范 tech-specs、团队知识库 biz-tech-docs、项目模板、Claude 插件）由 `agile sync` 统一拉取，配置集中在 `.agile/settings.json`——**tech-specs / biz-tech-docs 目录不入库**（.gitignore 忽略），各自是独立 git 仓库，本地改动优先（sync 只快进拉取，绝不覆盖本地）。

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
# 1. 初始化工作区（.agile/settings.json + 五个抽屉骨架 + git init）
mkdir my-workspace && cd my-workspace
agile init workspace --name my-workspace

# 2. 登记外部仓库（公司规范必选；多 workspace 团队可加登记团队知识库，目录均不入库）
agile config set tech-specs git@gitlab.corp:specs/tech-specs.git
agile config set biz-tech-docs git@gitlab.corp:kb/tech-docs.git   # 可选：团队知识库跨 workspace 共享
agile sync                        # 拉取外部仓库 + 模板缓存 + 插件

# 3. 新建项目（模板来自模板注册中心 git 仓库，落 projects/ 普通目录）
agile template list
agile init project order-service --template go-service

# 4. 日常
agile sync --dry-run             # 预览将要执行的动作
agile worktree create feature/STO-001   # 完整开发环境（前后自动 sync）
agile plugin ls                  # 依赖声明 × 本机安装实况对照

# 5. 安装 Claude Code 插件（SDD/TDD 流程）
agile plugin install agile
```

## 工作区结构（一个根、五个抽屉）

```
my-workspace/                    # 单一 git 仓库（团队）
├── .gitignore                   # 忽略 .worktrees/、tech-specs/、biz-tech-docs/（外部仓库不入库）
├── .agile/
│   └── settings.json            # 唯一配置：抽屉路径、外部仓库、插件市场与依赖声明、模板源
├── tech-specs/                  # 抽屉一：公司级技术规范（独立 git 仓库，不入库）
├── biz-tech-docs/               # 抽屉二：团队技术设计知识库（默认普通目录；可 config set 登记为外部仓库）
├── biz-product-docs/            # 抽屉三：产品设计知识库（普通目录）
├── projects/                    # 抽屉四：项目代码（普通目录，模板脚手架直接落此）
└── process-docs/                # 抽屉五：过程产物（STO-xxx 标准任务目录，普通目录）
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `agile init workspace [--tech-specs <url>] [--biz-tech-docs <url>]` | 初始化工作区（settings.json + 五抽屉 + git init；旧版三 yaml 自动迁移） |
| `agile init project <name> [--template <t>]` | 创建项目到 projects/（--template 从模板生成，缺省为空项目骨架；普通目录，git add） |
| `agile sync [--dry-run]` | 拉取四类外部资源：tech-specs / biz-tech-docs 仓库（clone 或快进，本地优先）+ 模板缓存刷新 + 插件按声明安装（绝不卸载） |
| `agile config get/set/unset <tech-specs\|biz-tech-docs\|plugin-repo\|template-repo>` | 快捷配置外部仓库与插件/模板源地址（类 npm registry 换源体验；plugin-repo/template-repo 的 unset 恢复内置官方源） |
| `agile config list` | 查看全部配置（settings.json） |
| `agile worktree create/list/remove` | workspace 根仓库 worktree（create 前后自动 sync；--help 有参数详述） |
| `agile template list/update/clean` | 模板注册中心：查看 / 刷新缓存 / 清理缓存（源 = settings.json templates.registry） |
| `agile plugin install/uninstall/update/ls` | 插件管理（类 npm：install/uninstall 同时维护 settings.json 依赖声明；update 刷新市场并强制重装；ls 声明 × 实况对照） |
| `agile update` | CLI 自更新（npm） |
| `agile mcp` | 启动 stdio MCP Server |

> 任务目录（STO-xxx 标准任务目录）不注册 CLI 命令，仅通过 MCP 工具 `agile_task_create` 暴露（供插件命令 /agile:sync-req 等调用）。

> 私有源：`agile config set plugin-repo <git-url>` / `agile config set template-repo <git-url>` 一键切换内网镜像（落点 settings.json 的 `plugins.marketplace` / `templates.registry`，也可手改；`config unset` 恢复内置官方源）。

## 自动同步

`agile worktree create` 创建开发环境**前后各自动执行一次 sync**（主仓拉外部资源；worktree 内因外部仓库不入库需独立 clone，失败仅警告不阻塞）。日常场景也可手动 `agile sync`（幂等）。

## MCP / AI 集成

`agile mcp` 暴露 4 个工具：`agile_workspace_info`、`agile_sync`（默认 dry-run）、`agile_template_list`、`agile_task_create`。项目 `.mcp.json` 接入：

```json
{ "mcpServers": { "agile": { "command": "agile", "args": ["mcp"] } } }
```

## 开发

```bash
pnpm install
pnpm build && pnpm test && pnpm typecheck
node dist/index.js --help                       # 本地试用
node dist/index.js template list                # 模板源见 settings.json templates.registry（可指向 ../agile-templates 验证）
```

结构：`src/core/`（纯逻辑，可单测）→ `src/commands/`（commander 薄壳）/ `src/mcp/`（MCP Server）→ `test/`（vitest）。详见 [CLAUDE.md](./CLAUDE.md) 与 [docs/](./docs/)。

发版：维护者执行 `npm run release`（自动生成 CHANGELOG 段落、建议版本号、打 tag），npm publish 由 GitHub Actions 执行（详见 [docs/release.md](./docs/release.md)）。commit message 请遵循 Conventional Commits。

## 从 1.x 升级（迁移）

- `agile init workspace` 会自动把旧版 `.agile/workspace.yaml / registry.yaml / plugin.yaml` 并入 `.agile/settings.json`；确认无误后人工 `git rm` 三个旧文件。
- tech-specs / biz-tech-docs 不再走 submodule：若此前已登记为 submodule，请先人工执行 `git submodule deinit --all`，再 `agile sync`（目录转为独立仓库拉取）。
- 命令变更：`status/repo/doctor/foreach/hooks` 已移除（`foreach` 可用常规脚本替代，`doctor` 场景由 `sync --dry-run` 覆盖）；`plugin` 收敛为 `install/uninstall/update/ls`；`config` 只管两仓地址；`template` 去掉了 `check/unregister` 与各选项。

## License

[MIT](./LICENSE) © FCC contributors
