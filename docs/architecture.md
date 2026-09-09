# 总体架构

> `fcc-agile-cli`（本仓库）+ 外部两个 git 仓库（[agile-plugins](https://github.com/pig0224/agile-plugins) 插件市场、[agile-templates](https://github.com/pig0224/agile-templates) 模板注册中心）组成完整体系。三者解耦：只有本仓库发 npm，插件与模板的扩展不影响本仓库。

## 1. 单仓模式（核心取舍）

**workspace = 单一 git 仓库**。曾采用多仓 submodule 模式解决角色权限隔离，代价是跨模块变更需要多 PR + 指针滚动。现改为单仓 + CODEOWNERS 目录级权限治理：

- biz-product-docs / projects / process-docs = 普通目录
- **跨模块变更一个 PR 天然原子**（前后端代码 + 过程文档一起 review、一起 merge）
- 发版 = workspace 仓库打 tag（可目录级 tag，如 `projects/order-service/v1.2.0`）
- **外部资源不进 workspace 仓库（按登记）**：tech-specs（公司级规范）与 biz-tech-docs（团队知识库）同一规则——未登记时是 workspace 内普通目录（随仓库提交、worktree 天然可用）；登记为外部仓库后才写入 .gitignore。已登记目录各自是独立 git 仓库，由 `agile sync` clone/快进拉取——**本地改动优先，绝不覆盖**（这些目录是可写工作区，知识库命令会直接落盘）。登记动机是跨 workspace 共享、集中演进（如公司规范、多团队共用知识库）

```
workspace/                  # 单一 git 仓库（团队）
├── CLAUDE.md               # 工作区导航地图（init workspace 生成：五类目录表 + 常用命令 + AI 会话须知；人工维护后不覆盖）
├── .gitignore              # 忽略 .worktrees/、.tmp-*/、process-docs/*/assets/（截图本机留存）；tech-specs/、biz-tech-docs/ 登记为外部仓库后写入（sync 自动补写）
├── .agile/settings.json    # 唯一配置
├── tech-specs/             # 抽屉一（默认普通目录随仓库入库；config set 登记为外部仓库后不入库，sync 管理）
├── biz-tech-docs/          # 抽屉二（默认普通目录随仓库入库；config set 登记为外部仓库后不入库，sync 管理）
├── biz-product-docs/       # 抽屉三（普通目录）
├── projects/               # 抽屉四（普通目录，模板脚手架落此）
└── process-docs/           # 抽屉五（普通目录，STO-xxx 标准任务目录：五文档 + be/fe 角色文件）
```

## 2. 三仓解耦（CLI 与扩展源）

| 交付物 | 分发载体 | 扩展方式 | 本仓库是否需要发版 |
|---|---|---|---|
| `fcc-agile-cli`（CLI，本仓库） | npm | —（本体） | — |
| agile-plugins（插件市场） | git 仓库 | 加 `plugins/<name>/` + 登记 marketplace.json | ❌ |
| agile-templates（模板库） | git 仓库 | 加 `singles/<模板名>/`（或 `solutions/<组合>/<成员>/`）+ 登记 registry.json | ❌ |

对接点在 **settings.json**（`plugins.marketplace` / `templates.registry`）。

CLI 对两个仓库的内容零知识：安装插件 = `claude plugin marketplace add <地址>` + `claude plugin install <name>@<市场名>`；使用模板 = clone 模板仓库读 registry.json（v2：singles / solutions / projects 全数组）。新增插件/模板对 CLI 完全透明，用户可通过 `agile config set plugin-repo / template-repo` 将两个地址换成团队私有仓库（unset 恢复内置官方源）。

## 3. 分层架构（CLI）

```
┌─────────────────────────────────────────────┐
│ CLI（commander）                             │  ← 入口层：参数解析 + 输出格式化（AI 经 Bash 直调同一入口）
├─────────────────────────────────────────────┤
│ src/core/（纯逻辑，可单测）                   │  ← 业务层：schema/同步/校验
│   paths / schemas(zod) / config / sync      │
│   claude-plugins / git                      │
│   template-registry / manifest / scaffold   │
├─────────────────────────────────────────────┤
│ git CLI  │  插件市场 git 仓库 │ 模板 git 仓库 │  ← 外部依赖（地址可配置）
└─────────────────────────────────────────────┘
```

铁律：
- core 不依赖 commander；命令层只做「入口 → 调 core → 输出」。
- **无 MCP Server（2.0 起移除）**：AI（Claude Code 等）经 Bash 调用 CLI，与人类共用同一入口，行为天然一致。
- **core 不输出**：sync 等核心返回结构化结果（steps），打印由命令层决定（如 worktree 的 autoSync 只打印 warn/failed）。
- 改 sync 行为先改/加 `test/sync.test.ts`；改模板校验先改/加 `test/template-registry.test.ts`。

## 4. 配置文件契约（.agile/settings.json，唯一配置）

```json
{
  "version": 2,
  "name": "my-workspace",
  "created": "2026-09-05",
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

所有配置经 zod schema 校验（[src/core/schemas.ts](../src/core/schemas.ts)），错误信息带字段路径，中文。`version` 当前为 2（1 为 2.0.x 存量，读取自动兼容、内存归一为 2）。旧版三 yaml（workspace/registry/plugin）由 `agile init workspace` 自动迁移。

## 5. 自动同步

`agile worktree create` 创建开发环境**前后各自动执行一次 sync**：主仓拉外部资源；worktree 内因外部仓库不入库（settings.json 随仓库检出，tech-specs/biz-tech-docs 需独立 clone）。失败仅警告不阻塞，基于现有状态继续。日常也可手动 `agile sync`（幂等）。

## 6. 验证清单（E2E 冒烟）

在本机 %TEMP% 用本地裸仓库走通以下链路即为基线通过：

```
git init --bare src.git && clone + commit + push      # 准备外部源（tech-specs）
git init --bare tpl.git && clone + registry.json + push  # 准备模板源（v2：singles/<模板>/ 单例 + solutions/<组合>/<成员>/ 组合专属成员模板）
agile init workspace --name e2e --tech-specs <src.git>    # settings.json + CLAUDE.md 导航地图 + .gitignore（.worktrees/、.tmp-*/、process-docs/*/assets/、已登记的 tech-specs/）
cat CLAUDE.md                 # 导航地图内容随 settings.paths 实际路径渲染（重复 init 不覆盖）
agile sync                    # 骨架目录让位 → clone → 检出
agile sync                    # 幂等：ff-only 无变化
agile config set biz-tech-docs <src.git> && agile config get biz-tech-docs
agile config set plugin-repo <src.git> && agile config set template-repo <tpl.git> && agile config get template-repo
agile config unset plugin-repo && agile config get plugin-repo   # 恢复内置官方源
agile config list             # settings.json 全量
agile template list           # 从模板源拉取注册中心（含组合模板成员名单分组）
agile init project --template go-service                 # 单例：缺省 --name → 落 projects/go-service + git add
agile init project --template go-service --name order    # 单例：--name 覆盖 → 落 projects/order（{{name}} = order；生成清单 member = go-service，文件名 = order.json）
agile init project --name my-lib                         # 空项目骨架（--name 裸值必填，不访问模板注册中心）
agile init project foo --template go-service             # 位置参数已废弃 → 废弃指引报错（2.4.0 BREAKING）
agile init project --template admin-base --name backend=admin-backend   # 组合模板 → 成员平铺 projects/{admin-backend,frontend}/ + 逐成员 git add（同时写生成清单 .agile/manifests/<成员目录名>.json 并 git add）
agile init project --template admin-base --name backend=admin-backend   # 组合幂等补缺：清单一致的已存在成员跳过 + warn（补缺按本次的有效成员目录名，覆盖须带相同 --name 键值）
agile init project --template admin-base                 # 撞名跳过路径：若某有效成员目录名已被同名普通项目占用（无生成清单）→ 该成员跳过 + warn（人工核对）
rm projects/admin-backend/README.md && agile init project --template admin-base --name backend=admin-backend   # 清单校验路径：清单不符 → 硬错误「与生成清单不符（缺 N 文件 / 多 M 项）……请删除该目录后重跑」（2.4.0 起无 --force 出路）
mkdir projects/placeholder && agile init project --template admin-base   # 空目录放行：同名空目录被模板填充（计入 created）
mkdir projects/empty-proj && agile init project --name empty-proj        # 空骨架：已存在的空目录同样放行生成（与模板路径语义一致）
agile worktree create feature/STO-001                    # 前后自动 sync（worktree 内独立 clone）
agile worktree remove feature/STO-001
agile plugin install agile && agile plugin ls
```
