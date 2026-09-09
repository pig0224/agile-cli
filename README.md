# FCC-Agile CLI

[![CI](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/ci.yml)
[![Release](https://github.com/pig0224/agile-cli/actions/workflows/release.yml/badge.svg)](https://github.com/pig0224/agile-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/fcc-agile-cli.svg)](https://www.npmjs.com/package/fcc-agile-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

📖 **完整文档**：https://pig0224.github.io/agile-docs/ （命令参考 / 使用流程 / 插件与模板指南）

FCC-Agile CLI（npm 包 `fcc-agile-cli`，命令名 `agile`）：初始化与管理敏捷研发工作区——公司规范、技术知识库、产品知识库、项目代码、过程产物集中一处，统一配置、统一同步。

**一个工作区，全团队共用**：跨模块变更经由一个 PR 一并提交评审。外部资源（公司级规范 tech-specs、团队知识库 biz-tech-docs、项目模板、Claude 插件）由 `agile sync` 统一拉取，配置集中于 `.agile/settings.json`。tech-specs 与 biz-tech-docs 同一入库规则：未登记时是工作区内普通目录、随工作区提交获得版本管理；登记为外部资源后由 sync 维护（.gitignore 忽略、不入库）。已登记的外部资源本地改动优先：sync 仅快进拉取，不覆盖本地改动。

CLI 经 npm 发布；插件与模板更新后即时生效，三者独立演进：

| 仓库 | 职责 |
|---|---|
| [agile-plugins](https://github.com/pig0224/agile-plugins) | Claude Code 插件市场（SDD/TDD 插件） |
| [agile-templates](https://github.com/pig0224/agile-templates) | 项目模板注册中心（registry.json + 模板目录） |

## 安装

```bash
npm install -g fcc-agile-cli
```

> Node ≥ 24，git ≥ 2.30

## 5 分钟上手

```bash
# 1. 初始化工作区（.agile/settings.json + 五类目录骨架）
mkdir my-workspace && cd my-workspace
agile init workspace --name my-workspace

# 2. 登记外部资源（均可选：未登记则目录随工作区提交；登记后改为外部仓库、由 sync 维护）
agile config set tech-specs git@gitlab.corp:specs/tech-specs.git   # 可选：公司规范集中维护
agile config set biz-tech-docs git@gitlab.corp:kb/tech-docs.git   # 可选：团队知识库跨 workspace 共享
agile sync                        # 拉取外部资源 + 模板缓存 + 插件安装并保持更新

# 3. 新建项目（模板名以 template list 输出为准——官方注册中心可能尚未登记模板）
agile template list
agile init project --template go-service   # 缺省 --name：目录名 = go-service

# 4. 日常
agile sync --dry-run             # 预览将要执行的动作
agile worktree create feature/STO-001   # 完整开发环境（前后自动 sync）
agile plugin ls                  # 依赖声明 × 本机安装实况对照

# 5. 安装 Claude Code 插件（SDD/TDD 流程）
agile plugin install agile
```

## 工作区结构

```
my-workspace/                    # 团队工作区
├── .gitignore                   # 忽略 .worktrees/、.tmp-*/、process-docs/*/assets/（截图本机留存）；tech-specs/、biz-tech-docs/ 登记为外部仓库后写入（sync 自动补写）
├── .agile/
│   └── settings.json            # 唯一配置：目录路径、外部资源、插件市场与依赖声明、模板源
├── tech-specs/                  # 公司级技术规范（默认随工作区提交；config set 登记后由 sync 自动维护）
├── biz-tech-docs/               # 团队技术设计知识库（默认随工作区提交；config set 登记后由 sync 自动维护）
├── biz-product-docs/            # 产品设计知识库
├── projects/                    # 项目代码（模板脚手架直接落此）
└── process-docs/                # 过程产物（STO-xxx 标准任务目录）
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `agile init workspace [--name <名>] [--tech-specs <url>] [--biz-tech-docs <url>] [--marketplace <url>] [--template-registry <url>]` | 初始化工作区（settings.json + 五类目录骨架；旧版配置自动迁移；--name 自定义 workspace 名称，缺省取目录名） |
| `agile init project [--template <t>] [--name <目录名 \| 组合项目名称=目录名>]` | 创建项目到 projects/（--template 从单例/组合模板生成，缺省为空项目骨架且 --name 必填；--name 三模式——空骨架/单例为裸目录名、组合为 成员名=目录名 可重复，缺省用模板名/成员名） |
| `agile sync [--dry-run]` | 拉取四类内容：外部资源 tech-specs / biz-tech-docs（本地改动优先）+ 模板缓存刷新 + 插件按声明安装并检查更新（不卸载既有安装） |
| `agile config get/set/unset <tech-specs\|biz-tech-docs\|plugin-repo\|template-repo>` | 快捷配置外部资源与插件/模板源地址（操作方式与 npm registry 换源一致；plugin-repo/template-repo 的 unset 恢复内置官方源） |
| `agile config list` | 查看全部配置（settings.json） |
| `agile worktree create/list/remove` | 隔离开发环境管理（create 前后自动 sync；--help 有参数详述） |
| `agile template list/update/clean` | 模板注册中心：查看（`list --json` JSON 输出）/ 刷新缓存 / 清理缓存（源 = settings.json templates.registry） |
| `agile plugin install/uninstall/update/ls` | 插件管理（操作方式与 npm 一致：install/uninstall 同时维护 settings.json 依赖声明；update 刷新市场并强制重装；ls 声明 × 实况对照） |
| `agile update` | CLI 自更新（npm） |
| `agile version` | 查看当前 CLI 版本（同 `--version`） |

> 私有源：`agile config set plugin-repo <git-url>` / `agile config set template-repo <git-url>` 切换内网镜像（落点 settings.json 的 `plugins.marketplace` / `templates.registry`，也可手改；`config unset` 恢复内置官方源）。

> workspace 外降级：查询类命令不要求 workspace——`config get`/`config list` 显示内置官方默认，`template list`/`template update` 用内置官方模板源（模板缓存本机所有 workspace 共用），`plugin ls` 仅显示本机安装实况。写操作类（`config set/unset`、`sync`、`worktree`、`init project`）必须在工作区内执行，否则报错提示。

## 自动同步

`agile worktree create` 创建开发环境**前后各自动执行一次 sync**（主工作区拉取外部资源；新环境内需重新拉取，失败仅警告不阻塞）。日常场景也可手动 `agile sync`（幂等）。

## AI 集成

CLI 不提供 MCP Server：AI（Claude Code 等）直接经 Bash 调用全部命令（`agile sync` / `agile config list` / `agile worktree create` …）。任务目录（STO-xxx，初始 8 个 .md）由 Claude Code 插件命令 `/agile:sync-req`、`/agile:fix-bug` 等按 sdd-tdd-method SKILL 附录模板创建。

## 开发

```bash
pnpm install
pnpm build && pnpm test && pnpm typecheck
node dist/index.js --help                       # 本地试用
node dist/index.js template list                # 模板源见 settings.json templates.registry（可指向 ../agile-templates 验证）
```

结构：`src/core/`（纯逻辑，可单测）→ `src/commands/`（commander 薄壳）→ `test/`（vitest）。详见 [CLAUDE.md](./CLAUDE.md) 与 [docs/](./docs/)。

发版：维护者执行 `npm run release`（自动生成 CHANGELOG 段落、建议版本号、打 tag），npm publish 由 GitHub Actions 执行（详见 [docs/release.md](./docs/release.md)）。commit message 请遵循 Conventional Commits。

## 从 1.x 升级（迁移）

- `agile init workspace` 会自动把旧版 `.agile/workspace.yaml / registry.yaml / plugin.yaml` 并入 `.agile/settings.json`；确认无误后人工 `git rm` 三个旧文件。
- tech-specs / biz-tech-docs 不再走 submodule：若此前已登记为 submodule，请先人工执行 `git submodule deinit --all`，再 `agile sync`（目录转为独立仓库拉取）。
- 命令变更：`status/repo/doctor/foreach/hooks` 已移除（`foreach` 可用常规脚本替代，`doctor` 场景由 `sync --dry-run` 覆盖）；`plugin` 收敛为 `install/uninstall/update/ls`；`config` 四键快捷配置；`template` 去掉了 `check/unregister` 与各选项；`mcp` 已移除（AI 直接经 Bash 调用 CLI）。
- `init workspace` 的 `--default-branch` 选项与 settings.json 的 `defaultBranch` 字段已移除（初始分支固定 `main`，需要改名用 `git branch -m`）；存量 settings.json 里残留的该字段会被自动忽略。

## License

[MIT](./LICENSE) © FCC contributors
