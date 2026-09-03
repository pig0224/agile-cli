# 发版流程与 CI/CD

> 只有本仓库（`agile-cli`）发 npm；插件市场与模板注册中心以 git 仓库分发，推送即完成发版。
> **npm publish 只由 GitHub Actions 执行**（tag 触发），本地不需要也不应该再执行 npm publish。

## 0. 一键发版（推荐）

```bash
npm run release                      # 交互式，默认 patch
npm run release -- minor             # 指定 bump 类型
npm run release -- 0.2.0             # 指定确切版本
npm run release -- patch --dry-run   # 演练，不实际执行
```

`scripts/release.mjs` 做的事：
1. 前置检查：工作区干净 / 在 main / 与 origin 同步 / 目标 tag 不存在
2. 质量门：typecheck + test + build（与 CI 同款）
3. bump `package.json` 版本 → `chore(release): vX.Y.Z` commit → 打 tag → 推送
4. 轮询 GitHub Actions（最长 10 分钟），报告 Release workflow 结论与 npm 包链接

## 1. CI（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）

触发：push 到 main + 所有 PR。

矩阵：ubuntu/windows × Node 20/22/24。`pnpm install --frozen-lockfile → typecheck → vitest → build → CLI 冒烟（--version/--help/MCP initialize）`。

## 2. Release（[.github/workflows/release.yml](../.github/workflows/release.yml)）

触发：推送 `v*` tag。

```
git tag v0.2.0 && git push origin v0.2.0
```

流程：
1. 校验 `package.json` 版本号与 tag 一致（不一致直接失败）
2. typecheck + test + build
3. `pnpm publish --access public`
4. `softprops/action-gh-release` 创建 GitHub Release（自动生成 release notes）

**前置配置**：仓库 Settings → Secrets → Actions 添加 `NPM_TOKEN`（npmjs.com 的 Automation Token）。

## 3. 版本规范

- `package.json` 与 git tag `vX.Y.Z` 对齐；0.x 阶段 minor 即破坏性变更候选，遵守 semver
- 破坏性变更（如命令参数变更）使用 `feat!:`/`BREAKING CHANGE:` 提交标记，并在 release notes 说明

## 4. 首次发布 checklist

- [ ] GitHub 仓库创建（开源），推送代码
- [ ] `src/core/paths.ts` 中两个默认地址（`DEFAULT_PLUGIN_MARKETPLACE` / `DEFAULT_TEMPLATE_REGISTRY`）与 `package.json` 的 `repository.url` 替换为实际仓库地址
- [ ] 打 tag `v0.1.0` 推送，确认 Release workflow 全绿
- [ ] `npm i -g agile-cli` 验证安装 + `agile plugin install agile` + `agile template list` 验证两个 git 源链路
