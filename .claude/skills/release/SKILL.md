---
name: release
description: mdnotate 发版 SOP。当用户要发布新版本、bump 版本号、打 tag、出 dmg、更新 Homebrew cask，或者一次发布失败了要收拾残局时使用。触发词：发版、release、bump version、打 tag、发新版本、release failed。
---

# mdnotate 发版 SOP

push 一个 `v*` tag 会触发 `.github/workflows/release.yml`：跑测试 → 校验 tag 与
`tauri.conf.json` 的 version → macOS runner 构建 universal dmg（Developer ID 签名 +
公证 + staple）→ 发 GitHub Release → sed 改写 `reorx/homebrew-tap` 的
`Casks/mdnotate.rb`。全程约 8 分钟。

**tag 就是发布动作本身**，没有别的按钮。所以顺序错了、版本号写漏了，代价是一个
推出去还得删掉的 tag。

## 1. 定版本号：先看现实，别信 `git tag`

```bash
gh release list --limit 5   # 真正发出去的
git tag --sort=-v:refname | head -5   # 打过的（可能有发失败的死 tag）
gh run list --limit 5       # 每个 tag 的 workflow 到底成没成
```

三者可能对不上。**已经发生过**：v0.4.0 的 tag 推上去了，但那个 commit 忘了 bump
版本文件，workflow 在 29 秒的版本校验那步挂掉，于是远端有一个 v0.4.0 tag、却没有
v0.4.0 release。这种情况下：

- 新版本号要**大于最高的那个 tag**（不是大于最后一个成功的 release），否则版本序
  看着倒退；
- 那个死 tag 顺手删掉：`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`。

版本号有歧义时（比如"patch bump"的基准是版本文件还是最高 tag）**问用户**，别自己挑
——发错的版本号删不干净。

## 2. 预检

```bash
git status --short          # 必须只剩这次要发的改动
pnpm test
pnpm exec tsc --noEmit -p tsconfig.json
```

## 3. bump 四个文件，一个都不能漏

| 文件 | 位置 |
| --- | --- |
| `package.json` | 顶层 `"version"` |
| `src-tauri/tauri.conf.json` | 顶层 `"version"` ← **workflow 只校验这一个** |
| `src-tauri/Cargo.toml` | `[package]` 下的 `version`（第 3 行） |
| `src-tauri/Cargo.lock` | `name = "mdnotate"` 那个 `[[package]]` 块的 `version` |

前两个漏了 → workflow 直接失败（或发出版本号错误的产物）。
`Cargo.lock` 漏了 → CI 不管，但本地下次 `cargo build` 会自动改写它，工作区凭空变脏。

```bash
V=0.4.1
sed -i '' "s/\"version\": \"$OLD\"/\"version\": \"$V\"/" package.json src-tauri/tauri.conf.json
sed -i '' "3s/^version = \"$OLD\"\$/version = \"$V\"/" src-tauri/Cargo.toml
# Cargo.lock 用行号定位，先 grep -n '"mdnotate"' 找到 [[package]] 块
```

改完核一遍：

```bash
grep -n '"version"\|^version' package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
```

## 4. commit → tag → push，顺序不能换

版本 bump 和功能改动放**同一个 commit**（tag 指向的那个 commit 必须已经带着新版本号）。

```bash
git add -A && git commit -F - <<'EOF'
feat: <这次发的内容，中文，说清为什么这么做>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF

git tag v$V
git push origin master     # 先推 commit
git push origin v$V        # 再推 tag，这一下才真的开始发布
```

先推 tag 后推 commit 的话，Actions 会在一个远端还不存在的 commit 上排队。

## 5. 盯着它跑完

```bash
gh run list --limit 1
gh run view <id> --json jobs -q '.jobs[0].steps[] | "\(.conclusion // .status)\t\(.name)"'
gh run watch <id>          # 或者直接守着
```

跑完确认三件事：

```bash
gh release list --limit 3                            # release 出来了，带 dmg
gh run view <id> --log | grep -i "cask\|tap"         # cask bump 成没成
git -C ~/Code/homebrew-tap pull && grep -n 'version\|sha256' ~/Code/homebrew-tap/Casks/mdnotate.rb
```

`TAP_PUSH_TOKEN` 没配的话 cask 那步只会打印一句跳过，需要手动 bump
`reorx/homebrew-tap` 的 `Casks/mdnotate.rb`（version + dmg 的 sha256）。

## 6. 失败了怎么收拾

workflow 挂了 → **tag 是脏的，必须删掉重来**，不要在同一个 tag 上 force push
（Actions 对 force push 的 tag 不一定重跑，且已经 clone 过 tap 的话状态更乱）：

```bash
gh run view <id> --log-failed          # 先看清挂在哪一步
git push --delete origin v$V
git tag -d v$V
# 修，commit，重新 tag、push
```

常见死法：

- **版本校验挂（~30 秒）**：忘了 bump `tauri.conf.json`。
- **签名/公证挂（几分钟后）**：`MACOS_CERT_P12` / `MACOS_CERT_PASSWORD` /
  `NOTARY_KEY` / `NOTARY_KEY_ID` / `NOTARY_ISSUER_ID` 里有过期或缺失的。源文件在
  `~/Sync/apple-developer/`，背景见
  `../vocalflow-mac/kb/notes/2026-08-10-macos-developer-id-signing-guide.md`。
- **测试挂**：本地跑过就不会，跑之前别跳过第 2 步。

## 相关

- `workflow_dispatch` 手动触发只构建 + 上传 artifact，不发 release——想验证签名链路
  而不真发版时用它。
- cask 的 zap 列表引用 identifier `top.ideachat.mdnotate`，identifier 改了要同步。
- 本地验证打包产物：`open src-tauri/target/release/bundle/macos/mdnotate.app`。
  **绝不要**把未签名产物拷进 `/Applications`（原因见 AGENTS.md 开发命令那节）。
