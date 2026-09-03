# Sync Engine 设计

> `agile sync` 是 CLI 的核心：把 workspace 磁盘状态收敛到 registry.yaml 声明的期望状态。实现见 [src/core/sync.ts](../src/core/sync.ts)。

## 1. 收敛算法

```
E = registry 声明的仓库集合（期望）
A = .gitmodules 记录的 submodule 集合
D = 磁盘实际状态（目录 + .git）

E − A → git submodule add --name <path> <url> <path>
        ├── 目标是骨架目录（仅 README.md，init workspace 生成的抽屉）→ 先让位：
        │     git rm -r --ignore-unmatch <path> && rm -rf <path>，再 add
        ├── 有 pin → add 后 fetch + checkout <pin> + git add <path>
        └── 本地路径 URL → 附加 -c protocol.file.allow=always

A − E → git submodule deinit --force <path>
        git rm -f <path> && rm -rf .git/modules/<path>

E ∩ A → git submodule update --init --recursive <path>
        ├── registry.url ≠ gitmodules.url → 视作 remove + add（重挂载）
        ├── 占位 URL（本地项目）→ 视作 up-to-date，跳过
        ├── 有 pin → fetch origin + checkout <pin>（与当前 HEAD 相同则无事可做）
        └── 无 pin → fetch <branch> + checkout + merge --ff-only origin/<branch>

最后 → 对本次 added/updated 的仓库执行匹配的 hooks
```

计划（`computeSyncPlan`）与执行（`executeSyncPlan`）分离：`--dry-run`、单测、MCP 的 dryRun 模式都复用计划计算。

## 2. 安全设计

| 场景 | 行为 |
|---|---|
| 仓库 dirty | 默认跳过更新并列 warning；`--force` 才强制（绝不自动 stash/reset） |
| 无 pin 且本地与远端分叉 | `merge --ff-only` 失败即报错，交人工处理 |
| 有 pin 且当前 HEAD ≠ pin | 更新到 pin（doctor 同时报 pin-drift warning） |
| 本地路径 URL | 统一 `-c protocol.file.allow=always`（git 安全默认限制 file 协议） |
| 目录非空且非骨架 | 拒绝 add，warning 提示人工处理（不静默覆盖用户数据） |
| 移除仓库 | deinit + rm + 清理 .git/modules，`--force` 需显式给出 |

## 3. init project 的挂载方式

`agile init project <name> --template <模板名>`：

1. 从模板注册中心（git 仓库，`templates.registry` 配置）解析模板并做一致性校验（详见 [templates.md](./templates.md)）
2. 脚手架生成到 `.agile/.scaffold/`（已 .gitignore，占位符 `{{name}}`/`{{safeName}}` 替换）
3. 临时目录 git init + 初始 commit
4. `git submodule add` 从临时目录 clone 到目标位置（`-c protocol.file.allow=always`）
5. `git config -f .gitmodules` 回写真实 URL（`--remote` 给了用真实值；否则占位）
6. 清理临时目录 + 写 registry

未提供 `--remote` 的项目登记 `git@placeholder.local:<path>.git` 占位 URL，全链路特判：
- `sync`：视作 up-to-date，不 fetch
- `doctor`：warn `no-remote`（提示 `agile repo set-url`），不算 error
- `status`：显示「本地（未配置远端）」

推送远端后一条命令迁移为正常仓库：`agile repo set-url <repoPath> <git-url>`（同时改 registry/.gitmodules/本地 origin）。

## 4. hooks 匹配

workspace.yaml 的 hooks 是 `{match, run}` 列表。`matchRepo(pattern, repoPath)` 支持：

- `*`：单段通配（`projects/*` 匹配 `projects/foo`，不匹配 `projects/foo/bar`）
- `**`：跨段通配（`projects/**` 匹配任意深度）
- 精确路径：`tech-specs` 只匹配自身

hooks 在 sync 结束后对 added/updated 的仓库逐个执行（`--no-hooks` 跳过），也可以随时 `agile hooks run [--only glob]` 手动执行。

## 5. 已知边界

- hooks 串行执行（未来可加 `--parallel`）
- sync 拉取 branch 时未处理远端 force-push（ff-only 报错即停，符合安全设计）
- submodule 递归（嵌套 submodule）依赖 git 自身 `--recursive`
