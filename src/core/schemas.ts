import { z } from 'zod';
import { DEFAULT_PATHS, DEFAULT_PLUGIN_MARKETPLACE, DEFAULT_TEMPLATE_REGISTRY } from './paths.js';

export const PathsSchema = z
  .object({
    techSpecs: z.string(),
    bizTechDocs: z.string(),
    bizProductDocs: z.string(),
    projects: z.string(),
    processDocs: z.string(),
  })
  .default({ ...DEFAULT_PATHS });

export const HookSchema = z.object({
  /** glob 或精确前缀匹配仓库路径，如 "projects/frontend-web" 或 "projects/*" */
  match: z.string(),
  run: z.string(),
});

export const WorkspaceSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  created: z.string(),
  defaultBranch: z.string().default('main'),
  paths: PathsSchema,
  /** 插件市场（git 仓库，含 .claude-plugin/marketplace.json） */
  plugin: z
    .object({
      marketplace: z.string().default(DEFAULT_PLUGIN_MARKETPLACE),
    })
    .default({ marketplace: DEFAULT_PLUGIN_MARKETPLACE }),
  /** 项目模板注册中心（git 仓库，含 registry.yaml） */
  templates: z
    .object({
      registry: z.string().default(DEFAULT_TEMPLATE_REGISTRY),
    })
    .default({ registry: DEFAULT_TEMPLATE_REGISTRY }),
  hooks: z.array(HookSchema).default([]),
});

export const RepoEntrySchema = z.object({
  url: z.string().min(1),
  branch: z.string().optional(),
  /** 固定 commit；设置后 sync 会精确 checkout 到该提交 */
  pin: z.string().optional(),
});

export const RegistrySchema = z.object({
  version: z.literal(1),
  /** key = 相对 workspace 根的路径（即 submodule path），如 "projects/frontend-web" */
  repositories: z.record(z.string(), RepoEntrySchema),
});

export const PluginEntrySchema = z.object({
  /** 来源：npm 包名 / git URL / 本地路径 */
  source: z.string().min(1),
  enabled: z.boolean().default(true),
  version: z.string().optional(),
});

export const PluginFileSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), PluginEntrySchema),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>;
export type RepoEntry = z.infer<typeof RepoEntrySchema>;
export type RegistryConfig = z.infer<typeof RegistrySchema>;
export type PluginFileConfig = z.infer<typeof PluginFileSchema>;
export type Hook = z.infer<typeof HookSchema>;
