# Sync Engine 设计

> `agile sync` 收敛 workspace 的外部 submodule（tech-specs 等公司级规范仓库）到 registry.yaml 声明的期望状态。实现见 [src/core/sync.ts](../src/core/sync.ts)。

## 1. 收敛算法

```
E = registry 声明的外部仓库集合（期望）
A = .gitmodules 记录的 submodule 集合
D = 磁盘实际状态（目录 + .git）

E − A → git submodule add --name <path> <url> <path>
        ├── 目标是骨架目录（仅 README.md，init workspace 生成的抽屉）→ 先让位：
        │     git rm -r --ignore-unmatch <path> && rm -rf <path>，再 add
        └── 有 pin → add 后 fetch + checkout <pin> + git add <path>

A − E → git submodule deinit --force <path>
        git rm -f <path> && rm -rf .git/modules/<path>

E ∩ A → git submodule update --init --recursive <path>
        ├── registry.url ≠ gitmodules.url → 视作 remove + add（重挂载）
        ├── 有 pin → fetch origin + checkout <pin>（与当前 HEAD 相同则无事可做）
        └── 无 pin → fetch <branch> + checkout + merge --ff-only origin/<branch>
```

计划（`computeSyncPlan`）与执行（`executeSyncPlan`）分离：`--dry-run`、单测、MCP 的 dryRun 模式都复用计划计算。

## 2. 安全设计

| 场景 | 行为 |
|---|---|
| 外部仓库 dirty | 默认跳过更新并列 warning；`--force` 才强制（绝不自动 stash/reset） |
| 无 pin 且本地与远端分叉 | `merge --ff-only` 失败即报错，交人工处理 |
| 有 pin 且当前 HEAD ≠ pin | 更新到 pin（doctor 同时报 pin-drift warning） |
| 本地路径 URL | 统一 `-c protocol.file.allow=always`（git 安全默认限制 file 协议） |
| 目录非空且非骨架 | 拒绝 add，warning 提示人工处理（不静默覆盖用户数据） |
| 移除仓库 | deinit + rm + 清理 .git/modules |

## 3. 骨架目录让位

`init workspace` 会为五个抽屉生成仅含 README.md 的骨架目录。当用户把 `tech-specs` 登记进 registry 后 sync，骨架目录自动让位：`git rm -r --ignore-unmatch` 解除跟踪 → 删除目录 → `submodule add` 重建。判定标准：目录内只有 README.md 一个文件（`isSkeletonDir`）。

## 4. init project（模板落地，非 submodule）

`agile init project <name> --template <模板名>`：

1. 从模板注册中心（git 仓库，`templates.registry` 配置）解析模板并做一致性校验（详见 agile-templates 仓库的 registry 文档）
2. 脚手架**直接生成到 `projects/<name>`**（workspace 单仓内普通目录，占位符 `{{name}}`/`{{safeName}}` 替换）
3. `git add`（不自动 commit，提交时机由开发者决定）

项目与 workspace 其余变更一起走同一个 PR——不存在多仓指针滚动问题。

## 5. 自动同步

`agile worktree create <branch>` 前置 `autoSync`：读 registry → computeSyncPlan → 有动作则 executeSyncPlan；任何失败只警告不阻塞（基于当前磁盘状态创建开发环境）。`agile sync --quiet` 供自动化场景静默执行。

## 6. hooks 匹配（projects 遍历）

workspace.yaml 的 hooks 是 `{match, run}` 列表，`match` 用 glob 匹配 **`projects/<name>`**（`*` 单段 / `**` 跨段，见 `matchRepo`）。`agile hooks run` 遍历 `listProjects()` 识别的项目执行。项目识别标准：`projects/` 下含构建特征文件（package.json / go.mod / pom.xml / tsconfig.json 等）的目录（[src/core/projects.ts](../src/core/projects.ts)）。

## 7. 已知边界

- 拉取 branch 时未处理远端 force-push（ff-only 报错即停，符合安全设计）
- submodule 递归（嵌套 submodule）依赖 git 自身 `--recursive`
- sync 为串行执行（外部仓库数量少，无需并行）
