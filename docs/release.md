# 发版流程与 CI/CD

> 只有本仓库（`fcc-agile-cli`，bin: `agile`）发 npm；插件市场与模板注册中心以 git 仓库分发，推送即完成发版。
> **npm publish 只由 GitHub Actions 执行**（tag 触发）；**tag 由 release-please 自动创建**（Release PR merge 后）。

## 0. 发版流程（release-please）

```bash
# 1. 日常开发：feature 分支提交（Conventional Commits：feat / fix / docs / chore…）
#    破坏性变更：feat!: … 或提交尾行 BREAKING CHANGE: <说明>
# 2. PR merge 到 main

# 3. release-please 自动维护一个 Release PR（CHANGELOG.md 更新 + package.json 版本 bump）
# 4. 人工 review 并 merge 该 Release PR → 自动打 tag vX.Y.Z
# 5. tag 触发 release.yml → 构建 + 发 npm + GitHub Release
```

- 组成部分：[release-please.yml](../.github/workflows/release-please.yml)（维护 Release PR）+ [release.yml](../.github/workflows/release.yml)（tag → 发 npm）
- 配置：[release-please-config.json](../release-please-config.json)、[.release-please-manifest.json](../.release-please-manifest.json)（版本记录）
- [CHANGELOG.md](../CHANGELOG.md) 由 release-please 依据 Conventional Commits 自动生成并维护

**commit message 规范是发版系统的地基**：`feat:` → minor，`fix:` → patch，`feat!:`/`BREAKING CHANGE:` → major。

## 1. CI（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）

触发：push 到 main + 所有 PR。

矩阵：ubuntu × Node 24。`pnpm install --frozen-lockfile → typecheck → vitest → build → CLI 冒烟（--version/--help/MCP initialize）`。

## 2. Release（[.github/workflows/release.yml](../.github/workflows/release.yml)）

触发：推送 `v*` tag（由 Release PR merge 自动创建）。

流程：
1. 校验 `package.json` 版本号与 tag 一致（不一致直接失败）
2. `pnpm build`（typecheck/test 由 main 上的 CI 已对该 commit 验证，此处不重复）
3. `pnpm publish --access public`
4. `softprops/action-gh-release` 创建 GitHub Release（自动生成 release notes）

**前置配置**：仓库 Settings → Secrets → Actions 添加 `NPM_TOKEN`（npmjs.com 的 Automation Token）。

## 3. 版本回退

- 应急：`npm dist-tag add fcc-agile-cli@<旧版本> latest`——新装用户立即拿回旧版
- 正式：revert 恶化提交，走 release-please 发修复版（forward-fix）
- 不采用删除已发布版本的回退方式

## 4. 首次发布 checklist

- [x] GitHub 仓库创建（开源），推送代码
- [x] 默认地址（`DEFAULT_PLUGIN_MARKETPLACE` / `DEFAULT_TEMPLATE_REGISTRY`）与 `repository.url` 已指向实际仓库
- [x] 配置 `NPM_TOKEN` secret
- [x] v1.0.0 已发布（`npm i -g fcc-agile-cli` 验证）
- [ ] 后续发版：merge feature PR → merge release-please 的 Release PR → 验证 npm 版本
