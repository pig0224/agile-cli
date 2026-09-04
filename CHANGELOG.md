# Changelog

## v1.0.0 (2026-09-03)

> bump: major

### Breaking Changes

- fix!: 模板缓存语义反转——默认走本地缓存，--refresh 才联网刷新 (ef5b5da)
- feat!: 单仓模式重构——registry 收窄为外部仓库登记处，移除 gclient 借鉴 (a7dcc7a)
- feat!: task 命令从 CLI 移除，仅通过 MCP 工具 agile_task_create 暴露 (48c2dce)
- feat!: npm 包名改为 fcc-agile-cli（agile-cli 无 scope 名已被 npm 占用） (e724bc)
- chore!: npm 包名 @fcc/agilecli → @fcc/agile-cli（bin 仍为 agile） (66aa20)
- feat!: npm 包名 @fcc/agile → @fcc/agilecli（bin 仍为 agile）；插件市场仓库名改为 agile-plugins (ed5f2b)
- feat!: 三仓解耦——CLI 发 npm，插件市场与项目模板走独立 git 仓库 (369c60)

### Features

- feat: 新增 npm run release 发版命令（本地校验+tag 推送，npm 发布交给 GitHub Actions） (dd10666)
- feat: npm 双包发布设计修复 + CI/CD + 文档重构 (35cfa06)
- feat: agile-cli + agile-plugin 初始实现 (4689a10)

### Bug Fixes

- fix: release.mjs 修正 readline 导入 (22650c8)

### Other Changes

- docs: 品牌词大小写统一（FCC-Agile / Agile / FCC），代码与命令语法不变 (59c6527)
- ci: 补充 ISSUE_TEMPLATE / dependabot / dependency-review (ed8f369)
- docs: README 增加生态文档站链接 (45fa9ec)
- docs: 发版命令 npm run release 文档（CLAUDE.md / docs/release.md） (6bbf12b)
- chore: GitHub 仓库地址改为 pig0224 org（默认插件市场/模板源/徽章/repository） (9fab639)
- chore: 从 monorepo 拆分为独立仓库（subtree split 保留历史） (57a01a)
