# MCP Server 契约

> `agile mcp` 启动 stdio MCP Server（实现 [src/mcp/server.ts](../src/mcp/server.ts)），复用 core 逻辑，全部工具返回 JSON 文本。供 Claude Code 等 AI 客户端程序化调用 CLI 能力。

## 1. 工具清单

| 工具 | 说明 | 关键参数 |
|---|---|---|
| `agile_workspace_info` | workspace 配置、五抽屉路径、仓库注册表 | - |
| `agile_status` | 各仓库 branch/commit/dirty/pin/local 状态 | - |
| `agile_sync` | 收敛磁盘状态到 registry | `dryRun`（默认 true！）、`force`、`repo[]`、`noHooks` |
| `agile_doctor` | 健康检查（配置/权限/漂移） | `offline`（跳过远端探测）、`fix`（自动修复） |
| `agile_template_list` | 列出模板注册中心全部模板 | `refresh`（默认 false 只读缓存） |
| `agile_task_create` | 创建 `process-docs/<编号>/` 五文档目录 | `taskId`（如 STO-001） |
| `agile_config_list` | workspace.yaml 全量配置 | - |
| `agile_repo_list` | registry 全部仓库（url/branch/pin） | - |

安全设计：`agile_sync` 默认 `dryRun: true` 只返回计划——AI 必须显式传 `dryRun: false` 才执行写操作，避免模型误触发 git 变更。

## 2. 注册方式

**项目级**（工作区根 `.mcp.json`）：

```json
{ "mcpServers": { "agile": { "command": "agile", "args": ["mcp"] } } }
```

**agile-plugin 捆绑**：[agile-plugin 仓库](https://github.com/pig0224/agile-plugin)中插件的 `.mcp.json` 声明同样的 server，安装插件后自动可用（工具名带插件命名空间前缀）。

## 3. 错误约定

- workspace 不存在 → 返回 `{ "error": "未找到 workspace…" }`（JSON，不是协议错误）
- 执行失败 → `report.failed[]` 内含 `{repoPath, error}`，整体不抛协议错误
- 配置非法 → 抛 AgileError 消息（中文，带文件名）

## 4. 新增工具的约定

1. 逻辑写在 `src/core/`（或复用已有 core 函数）
2. `server.registerTool` 用 zod 定义 `inputSchema`，description 写清副作用
3. 有写操作的工具默认 dry-run 或需要显式确认参数
