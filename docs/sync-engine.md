# Sync Engine 设计

> `agile sync` 把四类外部资源拉到本地：外部仓库（tech-specs / biz-tech-docs）、模板缓存、Claude 插件。实现见 [src/core/sync.ts](../src/core/sync.ts)，插件执行层见 [src/core/claude-plugins.ts](../src/core/claude-plugins.ts)。

## 1. 四步拉取

`syncWorkspace(root, settings, { dryRun? })` → `SyncStep[]`（`{ name, status: done|skipped|warn|failed, detail }`），串行执行：

```
① repos（逐槽位 techSpecs / bizTechDocs）
   settings.repos 无 url        → skipped（提示 agile config set <key> <git-url>）
   目录不存在                   → git clone（file 协议放开）
   骨架目录（仅 README.md）      → 让位删除后 clone（init workspace 生成的抽屉骨架）
   目录非空且非骨架             → failed（不静默覆盖用户数据）
   已是 git 仓库
   ├── dirty                    → warn 跳过（本地优先，绝不覆盖可写工作区）
   ├── dryRun                   → skipped [dry-run]
   └── 干净                     → fetch origin + merge --ff-only @{upstream}
                                  失败 → failed（分叉/force-push，交人工）
   ref 版本锁定（预留）          → 追加 warn「锁定暂未实现，按最新拉取」（不阻断）

② templates
   ensureTemplateRepo(settings.templates.registry, { refresh: true })
   ├── 成功                     → done（fetch + reset 到远端最新）
   └── 失联但有缓存             → warn「沿用本地缓存」（stale 降级）

③ plugins（按 settings.plugins.dependencies 声明收敛，绝不卸载）
   无声明                       → skipped
   已装同市场                   → skipped
   本机同名来自其他市场         → warn（不自动替换，给出切换命令）
   未安装                       → marketplace add（幂等兜底）+ claude plugin install
   ref 版本锁定（预留）         → warn「锁定暂未实现，按市场最新安装」
   本机已装未声明               → skipped（信息性提示）
```

失败语义：任一步 failed → `agile sync` 退出码 1，其余步骤继续执行（部分成功可见）。

## 2. 安全设计

| 场景 | 行为 |
|---|---|
| 外部仓库 dirty | warn 跳过更新（本地优先，绝不自动 stash/reset/覆盖——这些目录是可写工作区，知识库命令直接落盘） |
| 本地与远端分叉 | `merge --ff-only` 失败即 failed，交人工处理 |
| 本地路径 URL | 统一 `-c protocol.file.allow=always`（git 安全默认限制 file 协议） |
| 目录非空且非骨架 | 拒绝 clone，failed 提示人工处理 |
| 拉取只进不退 | 只 pull 不 reset，不处理远端 force-push |
| 插件同步 | 绝不卸载：声明删除 ≠ 本机卸载（卸载走 `agile plugin uninstall` / `claude plugin uninstall`） |

## 3. 骨架目录让位

`init workspace` 会为五个抽屉生成仅含 README.md 的骨架目录。当用户 `config set` 登记外部仓库后 sync，骨架目录自动让位：删除目录 → `git clone` 重建。判定标准：目录内只有 README.md 一个文件。

## 4. core 不输出（分层约定）

`syncWorkspace` 只返回结构化 steps，不打印。命令层决定呈现方式：

- `agile sync`：全部步骤逐条输出（✓ done / ! warn / ✖ failed / · skipped）
- `agile worktree create` 的 autoSync：只打印 warn/failed（不阻塞创建）
- MCP `agile_sync`：steps 直接 JSON 返回

## 5. 自动同步

`agile worktree create <branch>` 前后各执行一次 autoSync（主仓 + worktree 目录内各一次，worktree 内因外部仓库不入库需独立 clone）。任何失败只警告不阻塞（基于当前磁盘状态创建开发环境）。

## 6. 版本锁定（预留）

`repos.*.ref` 与 `plugins.dependencies.*.ref` 字段已进 schema，当前出现即警告「锁定拉取/安装暂未实现，按最新拉取」且不阻断。后续实现后：repo ref = fetch + checkout ref（detached 或分支锁）；plugin ref = 市场克隆 checkout 后安装。

## 7. 已知边界

- 拉取 branch 时未处理远端 force-push（ff-only 报错即停，符合安全设计）
- sync 为串行执行（资源数量少，无需并行）
- 插件安装实况由 Claude Code 全局管理（`~/.claude/plugins/installed_plugins.json`），CLI 只维护声明与执行安装
