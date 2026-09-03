import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findWorkspaceRoot } from '../core/paths.js';
import { loadRegistry, loadWorkspace } from '../core/config.js';
import { collectStatus } from '../core/status.js';
import { computeSyncPlan, executeSyncPlan } from '../core/sync.js';
import { runDoctor } from '../core/doctor.js';

const TASK_DOC_NAMES = ['requirement.md', 'design.md', 'implementation.md', 'review.md', 'release.md'];

function json(result: unknown): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function rootOrError(): { root: string | null; error?: string } {
  const root = findWorkspaceRoot();
  return root ? { root } : { root: null, error: '未找到 workspace（缺少 .agile/workspace.yaml），请先运行 agile init workspace' };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: '@fcc/agile', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'agile_workspace_info',
    {
      description: '获取当前 workspace 的基本信息：配置、五个抽屉路径、仓库注册表。',
      inputSchema: {},
    },
    async () => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const workspace = await loadWorkspace(root);
      const registry = await loadRegistry(root);
      return json({ root, workspace, repositories: Object.keys(registry.repositories) });
    },
  );

  server.registerTool(
    'agile_status',
    {
      description: '查看各仓库的 branch/commit/dirty 状态与 pin 偏差。',
      inputSchema: {},
    },
    async () => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const registry = await loadRegistry(root);
      return json({ root, repos: await collectStatus(root, registry) });
    },
  );

  server.registerTool(
    'agile_sync',
    {
      description:
        '把 workspace 磁盘状态收敛到 .agile/registry.yaml 声明的期望状态（新增/更新/移除 git submodule）。默认 dryRun=true 只返回计划；dryRun=false 时执行。',
      inputSchema: {
        dryRun: z.boolean().default(true).describe('true=只返回计划；false=执行'),
        force: z.boolean().default(false).describe('忽略 dirty 仓库强制更新'),
        repo: z.array(z.string()).optional().describe('只同步指定仓库路径'),
        noHooks: z.boolean().default(false).describe('跳过 post-sync hooks'),
      },
    },
    async ({ dryRun, force, repo, noHooks }) => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const registry = await loadRegistry(root);
      const plan = await computeSyncPlan(root, registry, { only: repo?.length ? repo : undefined, force });
      if (dryRun) return json({ dryRun: true, plan });
      const report = await executeSyncPlan(root, registry, plan, {
        only: repo?.length ? repo : undefined,
        force,
        noHooks,
      });
      return json({ dryRun: false, plan, report });
    },
  );

  server.registerTool(
    'agile_doctor',
    {
      description: '工作空间健康检查：配置错误、远端权限、registry/gitmodules/磁盘漂移。返回问题清单。',
      inputSchema: {
        offline: z.boolean().default(false).describe('跳过远端可达性检查'),
        fix: z.boolean().default(false).describe('自动修复可修复项'),
      },
    },
    async ({ offline, fix }) => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      return json(await runDoctor(root, { offline, fix }));
    },
  );

  server.registerTool(
    'agile_task_create',
    {
      description: '在 process-docs 下创建需求编号目录（STO-xxx）及标准五文档：requirement/design/implementation/review/release.md。',
      inputSchema: {
        taskId: z.string().describe('需求编号，如 STO-001'),
      },
    },
    async ({ taskId }) => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const { createTaskDocs } = await import('../core/task.js');
      try {
        const dir = await createTaskDocs(root, taskId);
        return json({ created: dir, docs: TASK_DOC_NAMES });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    },
  );

  server.registerTool(
    'agile_config_list',
    {
      description: '列出 workspace.yaml 全部配置。',
      inputSchema: {},
    },
    async () => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      return json(await loadWorkspace(root));
    },
  );

  server.registerTool(
    'agile_repo_list',
    {
      description: '列出 registry.yaml 中登记的全部仓库及 URL/分支/pin。',
      inputSchema: {},
    },
    async () => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const registry = await loadRegistry(root);
      return json(registry.repositories);
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
