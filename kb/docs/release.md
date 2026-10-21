---
created: 2026-10-21
updated: 2026-10-21
tags:
  - release
  - macos
  - homebrew
---

# 发布 mdnotate

给负责发版的人：如何把当前分支的改动发布为签名、公证过的 universal macOS 应用，并确认 Homebrew 用户能取得同一份产物。

## 发布前

先读项目的 [release skill](../../.claude/skills/release/SKILL.md)，再运行 `scripts/release-status.sh`，同时核对四处版本文件、远端 tag、GitHub Release 和 workflow。新版本必须高于所有已推送的 tag；有 tag 却没有 Release 时，先查清失败原因，不能只按最近成功版本递增。

检查 `kb/known-issues.md` 和 `kb/next-up.md`，了解仍待人工验收的行为。已有截图与验收报告的目录在对应计划或后续事项中列出。

非交互 shell 不一定激活 mise。使用项目固定的 Node 24 跑预检，避免系统 Node 的浏览器 API 与 jsdom 冲突：

```bash
mise exec -- pnpm test
mise exec -- pnpm build
cargo test --manifest-path src-tauri/Cargo.toml -p mdnotate-cli
```

`pnpm build` 包含 TypeScript 检查。涉及 Rust app 改动时，在前端构建完成后补做：

```bash
bash scripts/build-cli.sh
cargo test --manifest-path src-tauri/Cargo.toml
```

本地预检生成的未签名 CLI 只用于测试；CI 会重新构建两个架构并签名。

## 版本与发布

用 `scripts/bump-version.sh <version>` 一次修改并校验 `package.json`、`tauri.conf.json`、app 的 `Cargo.toml` 和 `Cargo.lock`。CLI 从所在 app bundle 取得版本，不单独 bump crate 版本。

把版本改动和本次所需文档一起提交，确认工作区干净。先推当前分支的 commit，再创建并推送与配置一致的 `v<version>` tag。推送 tag 会触发正式发布；`workflow_dispatch` 只构建 artifact，不发布 Release。

`.github/workflows/release.yml` 会运行前端与 CLI 测试，校验 tag，构建 arm64 + x86_64 的 app 和内嵌 CLI，再由 Tauri 完成 Developer ID 签名、公证和 staple。随后检查 app 与 CLI 的签名、CLI 的两个架构和 app 的 Gatekeeper 结果，发布 universal dmg。

Apple 凭据与 tap deploy key 已配置在仓库 Actions secrets 中。需要修复凭据时，以 `~/Sync/apple-developer/AGENTS.md` 为准，env 文件只经 envops 操作；普通发版无需轮换密钥。

## 确认发布完成

跟踪对应 tag 的 workflow，不能只看 Release 页面：Homebrew 更新发生在发布 dmg 之后，仍可能单独失败。检查构建日志中的公证成功记录与签名、Gatekeeper 结果。

workflow 成功后确认：

- GitHub Release 的 tag、版本和 universal dmg 文件名一致。
- `reorx/homebrew-tap` 的 `Casks/mdnotate.rb` 已更新版本，sha256 与发布的 dmg 一致；tap deploy key 缺失时 CI 会跳过这步，即使整个 workflow 显示成功。
- `scripts/release-status.sh` 中版本文件、tag、Release 和 workflow 结论一致。

用户侧先更新 tap，再用 `brew fetch --cask reorx/tap/mdnotate` 校验下载与 sha256。若本机已安装或正在使用 mdnotate，把下载的 dmg 只读挂载，将 app 复制到项目 `tmp/` 的临时目录后评估，避免覆盖正在使用的应用：

```bash
codesign --verify --deep --strict <临时目录>/mdnotate.app
spctl -a -t execute -vv <临时目录>/mdnotate.app
syspolicy_check distribution <临时目录>/mdnotate.app
xcrun stapler validate <临时目录>/mdnotate.app
```

签名应属于 Developer ID，Gatekeeper 应报告 `source=Notarized Developer ID`。同时检查内嵌 CLI 的签名与 `arm64 x86_64` 架构。结束后卸载 dmg、移除临时 app；若启动过测试 app，还要注销它的 LaunchServices 注册并退出测试实例。界面验收遵循 [验收手册](verification.md)，截图归档到当日任务的 `tmp/` 目录。

## 失败与已发布产物

先用 `gh run view <run-id> --log-failed` 定位。尚未发布的 tag 与已经有用户下载的 Release 必须区别处理；已发布的 dmg 不覆盖、不替换，修复通过新版本交付。仅 Homebrew 步骤失败时修复 cask，无需重新生成和上传 dmg。

## 相关文件

- [项目发布 SOP](../../.claude/skills/release/SKILL.md)
- [CI workflow](../../.github/workflows/release.yml)
- [版本 bump 脚本](../../scripts/bump-version.sh)
- [发布状态核对脚本](../../scripts/release-status.sh)
- [内嵌 CLI 构建与签名](../../scripts/build-cli.sh)
