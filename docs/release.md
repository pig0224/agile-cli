# 发版流程与 CI/CD

> 只有本仓库（`fcc-agile-cli`，bin: `agile`）发 npm；插件市场与模板注册中心以 git 仓库分发，推送即完成发版。
> **npm publish 只由 GitHub Actions 执行**（tag 触发）；tag 由发版脚本 `npm run release` 创建。

## 0. 发版流程（`npm run release`，人工执行）

```bash
npm run release                      # 交互式：依据提交类型自动建议版本号
npm run release -- patch|minor|major # 指定 bump 类型
npm run release -- 0.2.0             # 指定确切版本
npm run release -- patch --dry-run   # 演练，不实际执行
```

脚本做的事（全部本地完成，任何一步失败都不会推送）：
1. 前置检查：工作区干净 / 在 main / 与 origin 同步 / 目标 tag 不存在
2. 质量门：typecheck + test + build（与 CI 同款）
3. **CHANGELOG 自动生成**：收集自上个 tag 以来的提交，按 Conventional Commits 分组
   （Features / Bug Fixes / Breaking Changes / Other；Dependabot 的 `chore(deps)` 条目自动排除），
   并依据提交类型建议版本号（feat→minor、fix→patch、breaking→major）
4. 写入 CHANGELOG.md → bump package.json → `chore(release): vX.Y.Z` commit → 打 tag → 推送
5. 提交后自检：HEAD 内 package.json 版本必须等于目标版本（防 tag 与版本脱节）

push 后由 release.yml 完成：wait-for-ci（等待 CI 通过）→ build → 发 npm → GitHub Release（notes 取自 CHANGELOG 对应段落）。

## 1. CI（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）

触发：push 到 main + 所有 PR。

矩阵：ubuntu × Node 24。`pnpm install --frozen-lockfile → typecheck → vitest → build → CLI 冒烟（--version/--help/MCP initialize）`。

## 2. Release（[.github/workflows/release.yml](../.github/workflows/release.yml)）

触发：推送 `v*` tag（由发版脚本创建）。

流程：
1. **wait-for-ci**：轮询等待同 commit 的 CI 跑完且通过（最长 10 分钟，失败/超时即终止，禁止发布）
2. 校验 `package.json` 版本号与 tag 一致
3. `pnpm build` + 提取 CHANGELOG 对应段落作为 Release notes
4. `pnpm publish --access public`
5. `softprops/action-gh-release` 创建 GitHub Release

**前置配置**：仓库 Settings → Secrets → Actions 添加 `NPM_TOKEN`（npmjs.com 的 Automation Token）。

## 3. 版本规范与回退

- `package.json` 与 git tag `vX.Y.Z` 对齐；版本号由提交类型自动推导（feat→minor、fix→patch、breaking→major）
- 破坏性变更使用 `feat!:`/`BREAKING CHANGE:` 提交标记，并在 release notes 说明
- 应急回退：`npm dist-tag add fcc-agile-cli@<旧版本> latest`（新装用户立即拿回旧版）；正式修复走 forward-fix 发新版
- 不采用删除已发布版本的回退方式

## 4. 发版 checklist

- [x] GitHub 仓库创建、代码推送、`NPM_TOKEN` secret 配置、默认地址替换
- [x] v1.0.0 / v1.1.0 已发布
- [ ] 后续发版：`npm run release` → 确认 CI/wait-for-ci 全绿 → 验证 npm 版本与文档站
