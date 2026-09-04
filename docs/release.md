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

push 后由 release.yml 完成：validate（质量门）→ publish（发 npm → GitHub Release，notes 取自 CHANGELOG 对应段落）。

## 1. CI（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）

触发：push 到 main + 所有 PR。

矩阵：ubuntu × Node 24。`pnpm install --frozen-lockfile → typecheck → vitest → build → CLI 冒烟（--version/--help/MCP initialize）`。

## 2. Release（[.github/workflows/release.yml](../.github/workflows/release.yml)）

触发：推送 `v*` tag（由发版脚本创建）。两个 job 串行，全部通过才发布：

1. **validate**：install → typecheck → test → build → CLI 冒烟（--version / --help / MCP initialize）→ 上传 dist artifact（不再依赖 CI workflow，自身跑完整质量门）
2. **publish**（needs validate）：校验 `package.json` 版本号与 tag 一致 → 下载 dist artifact → 提取 CHANGELOG 对应段落作为 Release notes → `pnpm publish --access public` → `softprops/action-gh-release` 创建 GitHub Release（`generate_release_notes: false`）

**前置配置**：仓库 Settings → Secrets → Actions 添加 `NPM_TOKEN`（npmjs.com 的 Automation Token）。

## 3. 版本规范与回退

- `package.json` 与 git tag `vX.Y.Z` 对齐；版本号由提交类型自动推导（feat→minor、fix→patch、breaking→major）
- 破坏性变更使用 `feat!:`/`BREAKING CHANGE:` 提交标记，并在 release notes 说明
- **发布失败自动回退**（发版脚本内置）：Release workflow 失败时，脚本自动 revert `chore(release)` 提交并推送 main（还原 CHANGELOG 与版本号）、删除远端与本地 tag；若 npm 上已存在该版本（publish 成功但后续步骤失败）则拒绝自动回退并提示人工处置。等待超时不回退（workflow 可能仍在运行）
- 应急回退（版本已发布到 npm 后）：`npm dist-tag add fcc-agile-cli@<旧版本> latest`（新装用户立即拿回旧版）；正式修复走 forward-fix 发新版
- 不采用删除已发布版本的回退方式

## 4. 发版 checklist

- [x] GitHub 仓库创建、代码推送、`NPM_TOKEN` secret 配置、默认地址替换
- [x] v1.0.0 / v1.1.0 已发布
- [ ] 后续发版：`npm run release` → 确认 CI/wait-for-ci 全绿 → 验证 npm 版本与文档站
