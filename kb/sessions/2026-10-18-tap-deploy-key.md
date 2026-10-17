---
created: 2026-10-18
tags:
  - release
  - homebrew
  - github-actions
---

# Homebrew tap 写权限迁移到 deploy key（T2）

## 概要

按发布链路协调记录执行 T2，将 cask 更新的写凭据从 fine-grained PAT 换成仅覆盖
`reorx/homebrew-tap` 的可写 SSH deploy key。已运行共享 skill 的 `setup-secrets.sh
--repo reorx/mdnotate --skip-apple`，创建标题为 `release: reorx/mdnotate` 的公钥记录，
私钥存为本仓库的 `TAP_DEPLOY_KEY` secret，脚本退出时清理本地临时私钥。

## 修改的文件

- `.github/workflows/release.yml`：用 `actions/checkout` 的 `ssh-key` 检出 tap，
  `git push origin HEAD` 推送；通过 job env 判断凭据存在，缺失时提示并跳过。
- `.claude/skills/release/SKILL.md`：说明 deploy key 的范围、存放位置与轮换命令。
- `AGENTS.md`：发布入口补充凭据规则与配置文档指路。
- 本记录：保存迁移范围、验证结果与后续验证边界。

## 注意事项

- 保留原来的 sed 更新 version / sha256、提交身份、提交信息及内容相同则不提交的行为。
- `if` 不直接使用 secrets；`HAS_TAP_DEPLOY_KEY` 经 job env 传递配置状态。
- `actionlint .github/workflows/release.yml`：无输出，退出码 0（actionlint 1.7.12）。
- GitHub API 已确认 deploy key `166777200` 的 `read_only: false`、`verified: true`。
- 仓库文本中已无旧凭据名称引用；现有历史记录没有需要修改的命中。
- 收尾顺序为：提交，核对待推送列表只含本任务提交，推送 master，再删除旧 secret。

## 遗留问题

- 新 key 在 Actions 中实际检出和推送 tap 要等下一次发版验证；本次不打 tag、不触发 workflow。
- 删除 Actions secret 不会吊销原 fine-grained PAT，交给协调者在 GitHub 网页中处理。
- 最终提交、推送及 secret 删除证据见协调目录的 `T2-summary.md`；证据目录为
  `/Users/reorx/Code/gapless-paste/tmp/2026-10-18-release-followups/T2/`。
- 按协调约束不改 `kb/next-up.md` 或 `kb/known-issues.md`，后续登记交给协调者。

## 相关文档

- [发布链路协调记录](../../../gapless-paste/kb/plans/2026-10-18-release-followups-coordination.md) — 本次执行依据，范围为 T2。
- [验收手册](../docs/verification.md) — 本次验证前参考；本次只改 CI 与文档，无需启动应用。
