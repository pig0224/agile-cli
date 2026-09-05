# MCP Server 契约

> `agile mcp` 启动 stdio MCP Server（实现 [src/mcp/server.ts](../src/mcp/server.ts)），复用 core 逻辑，全部工具返回 JSON 文本。供 Claude Code 等 AI 客户端程序化调用 CLI 能力。

## 1. 工具清单

| 工具 | 说明 | 关键参数 |
|---|---|---|
| `agile_workspace_info` | 根目录 + settings.json 全量配置（抽屉路径、外部仓库、插件与模板源） | - |
| `agile_sync` | 同步外部资源：tech-specs / biz-tech-docs 仓库（clone 或快进，本地优先）+ 模板缓存刷新 + 插件按声明安装 | `dryRun`（默认 true！） |
| `agile_template_list` | 列出模板注册中心全部模板（源 = settings.json templates.registry，默认走本地缓存） | - |
| `agile_task_create` | 创建 `process-docs/<编号>/` 标准任务目录（7 个 .md：requirement / design / implementation + implementation-be / implementation-fe / review / release）。**task 能力不注册 CLI 命令，仅通过本工具暴露**（供 Claude Code 插件命令 /agile:sync-req 等编程化调用） | `taskId`（如 STO-001） |

安全设计：`agile_sync` 默认 `dryRun: true` 只返回计划（steps）——AI 必须显式传 `dryRun: false` 才执行写操作，避免模型误触发 git 变更。

## 2. 注册方式

**项目级**（工作区根 `.mcp.json`）：

```json
{ "mcpServers": { "agile": { "command": "agile", "args": ["mcp"] } } }
```

**agile-plugins 捆绑**：[agile-plugins 仓库](https://github.com/pig0224/agile-plugins)中插件的 `.mcp.json` 声明同样的 server，安装插件后自动可用（工具名带插件命名空间前缀）。

## 3. 错误约定

- workspace 不存在 → 返回 `{ "error": "未找到 workspace…" }`（JSON，不是协议错误）
- 执行失败 → `steps[]` 内含 `status: "failed"` 的条目与 detail，整体不抛协议错误
- 配置非法 → 抛 AgileError 消息（中文，带文件名）

## 4. 新增工具的约定

1. 逻辑写在 `src/core/`（或复用已有 core 函数）
2. `server.registerTool` 用 zod 定义 `inputSchema`，description 写清副作用
3. 有写操作的工具默认 dry-run 或需要显式确认参数
