## v1.3.0 (2026-09-05)

> bump: minor

### Features

- feat(cli): biz-tech-docs 团队知识库支持登记为 submodule（多 workspace 共享） ([`6059f6d`](https://github.com/pig0224/agile-cli/commit/6059f6d0c613c4a8e19e905b0d08ce1f0f7fa71c))
- feat(cli): worktree create 支持跟踪远程分支，任务目录拆分为 7 文件 ([`59d2e49`](https://github.com/pig0224/agile-cli/commit/59d2e49c1b2f1aeab0104e45280998b117e9999b))

### Fixes

- fix(cli): 修复 sync 对转义 URL 的误判与 worktree 内 submodule 空目录 ([`1e98b1f`](https://github.com/pig0224/agile-cli/commit/1e98b1f2f15c0fe552af5b11bd1feacc22e2f6a0))

## v1.2.0 (2026-09-04)

> bump: minor

### Features

- feat(init): init project 支持无模板空项目；plugin enable/disable 缺省 agile ([`10deb43`](https://github.com/pig0224/agile-cli/commit/10deb4383c657c312cb44c493592677ad492107b))
- feat(release): 发布失败自动回退；CHANGELOG 过滤发版提交 ([`2f5f2ba`](https://github.com/pig0224/agile-cli/commit/2f5f2ba4a20e0664a8d00923feb29b1521e1e44b))

### Other Changes

- ci(release): 关闭 Release Notes 自动生成 ([`604f5f9`](https://github.com/pig0224/agile-cli/commit/604f5f9d9d85690111220c25a938da5de454831b))

## v1.1.0 (2026-09-04)

> bump: minor

### Features

- feat: 钩子迁移至 husky + CHANGELOG 依赖条目过滤 + 文档过时修正 ([`860a0e8`](https://github.com/pig0224/agile-cli/commit/860a0e83ad4c3f22efe643af6ab40655958767a4))
- feat: CHANGELOG 提交 hash 渲染为可点击链接；内容只保留版本段落 ([`80316d7`](https://github.com/pig0224/agile-cli/commit/80316d7abc54674564ee344f4a735bdb28241fbc))
- feat: esbuild 单文件打包 + 门禁分层 + CHANGELOG 自动生成 + 社区三件套 ([`fea608a`](https://github.com/pig0224/agile-cli/commit/fea608a3d8332ae5f856b52b99b20603689f2e85))

### Performance

- perf: 优化 changelog 生成脚本 ([`493d65c`](https://github.com/pig0224/agile-cli/commit/493d65c0e1584d7284cc46e6b2c372dddb9b1185))

### Other Changes

- ci: 更新 Release 流程 ([`77edeeb`](https://github.com/pig0224/agile-cli/commit/77edeebfd0871e25a03af649f6e17550904b7280))
- test: 分组标题断言同步（Bug Fixes → Fixes） ([`38f6fda`](https://github.com/pig0224/agile-cli/commit/38f6fdab8e8fea0e1af604f703fa121ba67736af))
- chore: 优化 workflow ([`5f566f1`](https://github.com/pig0224/agile-cli/commit/5f566f1cb9fbc55ef26a7adee6ff2c7ef989ed24))
- chore: 更新 CHANGELOG 内容 ([`84f0f39`](https://github.com/pig0224/agile-cli/commit/84f0f3935ad690a6e716961fe238296cd77a20b6))
- chore: 移除 push 的 CI 门禁 ([`6b06348`](https://github.com/pig0224/agile-cli/commit/6b06348b38ada8a97c795ce0322c6a5eca0762ee))
- ci: 发版增加 wait-for-ci 守门——npm publish 必须等待 CI 通过 ([`6f4ab96`](https://github.com/pig0224/agile-cli/commit/6f4ab96d9aa93ff16a3e90aa9a7396fb8f2c194d))
- ci: Node 基线提升至 24——execa 10 需 Set.prototype.union（Node 22+），CI 精简为单 job ([`7848aab`](https://github.com/pig0224/agile-cli/commit/7848aab1105d855db2cd0cd256634ba0fc25a106))
- ci: dependabot 升级检查调整为 daily；PR 触发排除 main 目标分支 ([`4e8e9c4`](https://github.com/pig0224/agile-cli/commit/4e8e9c40f1521a44f037932f0045c2b03f873cea))
- docs: 协作红线——add/push/发版归人工，人工 add 后 AI 可汇总 commit（前置完整性检查） ([`c37d4ec`](https://github.com/pig0224/agile-cli/commit/c37d4ec2b5117138ef98fd0ae282282bc4235f38))

## v1.0.0 (2026-09-03)

### Breaking Changes

- fix!: 模板缓存语义反转——默认走本地缓存，--refresh 才联网刷新 ([`ef5b5da`](https://github.com/pig0224/agile-cli/commit/ef5b5dac1df85331c8b747461fee245d76e2e866))
- feat!: 单仓模式重构——registry 收窄为外部仓库登记处，移除 gclient 借鉴 ([`a7dcc7a`](https://github.com/pig0224/agile-cli/commit/a7dcc7a9ab6659497caa9536bba6fd8b984e6487))
- feat!: task 命令从 CLI 移除，仅通过 MCP 工具 agile_task_create 暴露 ([`48c2dce`](https://github.com/pig0224/agile-cli/commit/48c2dce867a75c1d288944d84ad167d5139646a6))
- feat!: npm 包名改为 fcc-agile-cli（agile-cli 无 scope 名已被 npm 占用） ([`e724bcd`](https://github.com/pig0224/agile-cli/commit/e724bcde63947e96a5b78cfef9f1a27f474bbaaf))
- chore!: npm 包名 @fcc/agilecli → @fcc/agile-cli（bin 仍为 agile） ([`66aa20f`](https://github.com/pig0224/agile-cli/commit/66aa20f0bc63f6a28869f3d7e9c8c5c94c700c6a))
- feat!: npm 包名 @fcc/agile → @fcc/agilecli（bin 仍为 agile）；插件市场仓库名改为 agile-plugins ([`ed5f2b7`](https://github.com/pig0224/agile-cli/commit/ed5f2b745443586622cba9afc5362047908dc06c))
- feat!: 三仓解耦——CLI 发 npm，插件市场与项目模板走独立 git 仓库 ([`369c602`](https://github.com/pig0224/agile-cli/commit/369c602548e05e5a2f886c3e295affb3d4928549))

### Features

- feat: 新增 npm run release 发版命令（本地校验+tag 推送，npm 发布交给 GitHub Actions） ([`dd10666`](https://github.com/pig0224/agile-cli/commit/dd106667bfaddac7d178020aa4bdb7e7b89f9d8e))
- feat: npm 双包发布设计修复 + CI/CD + 文档重构 ([`35cfa06`](https://github.com/pig0224/agile-cli/commit/35cfa06b05379171ebd3fd24d3471939a2b20901))
- feat: agile-cli + agile-plugin 初始实现 ([`4689a10`](https://github.com/pig0224/agile-cli/commit/4689a1030394cebbfdfd28e9d34ab050b21c7c79))

### Bug Fixes

- fix: release.mjs 修正 readline 导入 ([`22650c8`](https://github.com/pig0224/agile-cli/commit/22650c821f74c86d6345da9ca7efe48e6185a809))

### Other Changes

- docs: 品牌词大小写统一（FCC-Agile / Agile / FCC），代码与命令语法不变 ([`59c6527`](https://github.com/pig0224/agile-cli/commit/59c65271027c8ec4dbedb5c6718f5dd6e174ceb9))
- ci: 补充 ISSUE_TEMPLATE / dependabot / dependency-review ([`ed8f369`](https://github.com/pig0224/agile-cli/commit/ed8f3691a43002aed2e50a74c58231631891f69d))
- docs: README 增加生态文档站链接 ([`45fa9ec`](https://github.com/pig0224/agile-cli/commit/45fa9ec3f18c11ca82589b7a83084246b8293275))
- docs: 发版命令 npm run release 文档（CLAUDE.md / docs/release.md） ([`6bbf12a`](https://github.com/pig0224/agile-cli/commit/6bbf12ad30b98de02cb67149ce85e3fd81d8a402))
- chore: GitHub 仓库地址改为 pig0224 org（默认插件市场/模板源/徽章/repository） ([`9fab639`](https://github.com/pig0224/agile-cli/commit/9fab639f66615f7cacacd8cea4e6ac69df3150a8))
- chore: 从 monorepo 拆分为独立仓库（subtree split 保留历史） ([`57a01a0`](https://github.com/pig0224/agile-cli/commit/57a01a0b222e29a3de3b1800aa04a99da997990f))
