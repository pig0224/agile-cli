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

/** 外部仓库登记（settings.json repos 条目）。ref 为版本锁定预留字段：
 *  设置后 sync 会 pin 到该 commit（锁定拉取暂未实现，出现即警告按最新拉取） */
export const RepoEntrySchema = z.object({
  url: z.string().min(1),
  ref: z.string().optional(),
});

/** 插件依赖声明（settings.json plugins.dependencies 条目）：仅声明「用哪个插件、来自哪个市场」，
 *  安装/启用等实况由 Claude Code 全局管理（~/.claude/plugins），本文件不做登记。 */
export const PluginDependencySchema = z.object({
  /** 市场名（claude plugin install <name>@<marketplace> 的 @ 后缀）；缺省用内置市场名（fcc） */
  marketplace: z.string().optional(),
  /** 版本锁定：pin 到市场仓库 commit SHA；缺省跟随市场最新（锁定安装暂未实现，仅保留声明） */
  ref: z.string().optional(),
});

export const SettingsSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  created: z.string(),
  defaultBranch: z.string().default('main'),
  paths: PathsSchema,
  /** 外部仓库：公司级规范（techSpecs）与团队技术知识库（bizTechDocs）。
   *  目录被 .gitignore 忽略不入库，由 agile sync 拉取到本地；未配置则 sync 提示跳过。 */
  repos: z
    .object({
      techSpecs: RepoEntrySchema.optional(),
      bizTechDocs: RepoEntrySchema.optional(),
    })
    .default({}),
  plugins: z
    .object({
      /** 插件市场 git 地址（可指向团队私有 fork；agile config set plugin-repo 换源，unset 恢复默认） */
      marketplace: z.string().default(DEFAULT_PLUGIN_MARKETPLACE),
      dependencies: z.record(z.string(), PluginDependencySchema).default({}),
    })
    .default({ marketplace: DEFAULT_PLUGIN_MARKETPLACE, dependencies: {} }),
  /** 项目模板注册中心 git 地址（可指向团队私有 fork；agile config set template-repo 换源，unset 恢复默认） */
  templates: z
    .object({
      registry: z.string().default(DEFAULT_TEMPLATE_REGISTRY),
    })
    .default({ registry: DEFAULT_TEMPLATE_REGISTRY }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type RepoEntry = z.infer<typeof RepoEntrySchema>;
export type PluginDependency = z.infer<typeof PluginDependencySchema>;
