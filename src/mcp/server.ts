import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findWorkspaceRoot } from '../core/paths.js';
import { loadSettings } from '../core/config.js';
import { syncWorkspace } from '../core/sync.js';

const TASK_DOC_NAMES = [
  'requirement.md',
  'design.md',
  'implementation.md',
  'implementation-be.md',
  'implementation-fe.md',
  'review.md',
  'release.md',
];

function json(result: unknown): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function rootOrError(): { root: string | null; error?: string } {
  const root = findWorkspaceRoot();
  return root ? { root } : { root: null, error: '未找到 workspace（缺少 .agile/settings.json），请先运行 agile init workspace' };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'fcc-agile-cli', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'agile_workspace_info',
    {
      description: '获取当前 workspace 的基本信息：根目录与 .agile/settings.json 全部配置（含五个抽屉路径、外部仓库、插件与模板源）。',
      inputSchema: {},
    },
    async () => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      return json({ root, settings: await loadSettings(root) });
    },
  );

  server.registerTool(
    'agile_sync',
    {
      description:
        '同步外部资源到本地：外部仓库（tech-specs 公司级规范 / biz-tech-docs 团队知识库，clone 或快进拉取，本地改动优先）+ 模板缓存刷新 + Claude 插件按声明安装。默认 dryRun=true 只返回计划；dryRun=false 时执行。',
      inputSchema: {
        dryRun: z.boolean().default(true).describe('true=只返回计划；false=执行'),
      },
    },
    async ({ dryRun }) => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const settings = await loadSettings(root);
      const steps = await syncWorkspace(root, settings, { dryRun });
      return json({ dryRun, steps });
    },
  );

  server.registerTool(
    'agile_template_list',
    {
      description:
        '列出项目模板注册中心的全部可用模板（agile init project --template <模板名> 使用）。模板源 = settings.json templates.registry 指向的 git 仓库，默认走本地缓存。',
      inputSchema: {},
    },
    async () => {
      const { root, error } = rootOrError();
      if (!root) return json({ error });
      const { loadTemplates } = await import('../core/template-registry.js');
      try {
        const settings = await loadSettings(root);
        const result = await loadTemplates(settings.templates.registry);
        return json({
          registry: settings.templates.registry,
          templates: result.registry.templates,
          issues: result.issues,
          stale: result.stale,
        });
      } catch (e) {
        return json({ error: (e as Error).message });
      }
    },
  );

  server.registerTool(
    'agile_task_create',
    {
      description:
        '在 process-docs 下创建需求编号目录（STO-xxx）及标准五文档（implementation 含 -be/-fe 角色文件，共 7 个）：requirement/design/implementation/implementation-be/implementation-fe/review/release.md。',
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
