---
name: release
description: mdnotate 的发版流程：定版本号、bump 四处版本文件、打 tag 触发 GitHub Actions 构建签名公证的 universal dmg、发 GitHub Release、更新 Homebrew cask。用户提到发版 / 发新版本 / release / ship / bump version / 打 tag / 出 dmg，或者在收拾一次没成的发布（tag 推了却没有 release、签名或公证挂了、brew 装到的还是旧版本、cask 没更新），都先读这个 skill 再动手 —— push tag 是不可逆的，版本号或顺序错了只能删 tag 重来。
---

# mdnotate 发版 SOP

push 一个 `v*` tag 会触发 `.github/workflows/release.yml`：跑测试 → 校验 tag 与
`tauri.conf.json` 的 version → macOS runner 构建 universal dmg（Developer ID 签名 +
公证 + staple）→ 发 GitHub Release → 改写 `reorx/homebrew-tap` 的 `Casks/mdnotate.rb`。
全程约 8 分钟。

## 这个流程只有一个不可逆动作

`git push origin vX.Y.Z`。在那之前所有事都能改；在那之后，版本号就被占住了 ——
即使 workflow 当场失败、什么产物都没发出来，那个 tag 仍然记在 origin 上，删掉它是
一次要跟用户交代的额外动作。

所以推 tag 之前有两件事值得停下来：

- **版本号有任何歧义就问用户**，别自己挑一个"最合理"的。歧义的典型来源见第 2 步。
- **确认这次要发的改动都已经 commit 了**，tag 指向的 commit 必须已经带着新版本号。

其余步骤该做就做，不必逐步请示。

## 1. 先核对现实

```bash
scripts/release-status.sh
```

一屏打出版本文件、本地 tag、origin 上的 tag、每个 tag 有没有 release、以及它的
workflow 结论。之所以要一起看，是因为这几者会对不上，而 `gh release list` 单独看
最有迷惑性：**tag 推了但 workflow 挂了的话，那个版本号有 tag、没 release**，只看
release 列表会以为它还空着。

脚本会把这种"死 tag"单独列出来，并给出删除命令。删之前确认那个版本确实没发出去过
（有 release 的 tag 不能删，用户可能已经装了）。

## 2. 定版本号

规则只有一条：**新版本号要大于最高的那个 tag，而不是大于最后一个成功的 release**。
理由就是上一条——tag 一旦推出去就占住了号。

需要问用户的情况：

- 最高 tag 和最后一个成功 release 不是同一个（有死 tag），这时"patch bump"的基准
  是哪个，只有用户知道他想不想认那个失败的号；
- 版本文件里的号落后于 tag（说明上次发版忘了 bump）；
- 用户说的是 "patch"/"minor" 而这次改动的性质明显对不上（比如一堆 feature 说 patch）
  —— 提一句，然后照他说的做。

> 2026-08-13 真实发生过：v0.4.0 的 tag 推上去了，但那个 commit 忘了 bump 版本文件，
> workflow 在 29 秒的版本校验那步失败。于是远端有 v0.4.0 tag、却没有 v0.4.0 release，
> 而版本文件还停在 0.3.0。最后走的是 v0.4.1 并删掉死 tag。

## 3. 预检

```bash
git status --short   # 只剩这次要发的改动
pnpm test
pnpm exec tsc --noEmit -p tsconfig.json
```

CI 也会跑测试，但那时 tag 已经推出去了 —— 在本地挂掉只是重跑一次，在 CI 挂掉是删
tag 重来。

## 4. bump 版本号

```bash
scripts/bump-version.sh 0.4.2
```

四处版本号（`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` /
`src-tauri/Cargo.lock`）一次改齐并自校验。别手工 sed：漏掉的代价不对称 ——

- 漏 `tauri.conf.json`：workflow 在版本校验那步失败，而 tag 已经推出去了；
- 漏 `Cargo.lock`：CI 不管，但本地下次 `cargo build` 会自动改写它，工作区凭空变脏。

脚本只改文件，不 commit、不打 tag。

## 5. commit → tag → push

版本 bump 和功能改动放**同一个 commit**：tag 指向的那个 commit 必须已经带着新版本号，
否则第 4 步白做。

```bash
git add -A && git commit -F - <<'EOF'
feat: <这次发的内容，中文，说清为什么这么做>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF

git tag v0.4.2
git push origin master     # 先推 commit
git push origin v0.4.2     # 再推 tag，这一下才真的开始发布
```

顺序不能反：先推 tag 的话，Actions 会在一个 origin 上还不存在的 commit 上排队。

## 6. 盯着它跑完，然后确认三件事

```bash
gh run list --limit 1
gh run view <id> --json jobs -q '.jobs[0].steps[] | "\(.conclusion // .status)\t\(.name)"'
gh run watch <id> --exit-status
```

跑完（约 8 分钟）核对：

```bash
gh release list --limit 3     # 新 release 在，带 dmg
scripts/release-status.sh     # 版本文件 / tag / release 全对上
git -C ~/Code/homebrew-tap pull && head -5 ~/Code/homebrew-tap/Casks/mdnotate.rb
```

cask 那步依赖 `TAP_PUSH_TOKEN` secret，没配的话 workflow 只打印一句跳过、不算失败，
需要手动 bump `reorx/homebrew-tap` 的 `Casks/mdnotate.rb`（version + dmg 的 sha256）。

## 7. workflow 挂了

**删 tag 重来，不要在同一个 tag 上 force push。** Actions 对 force push 的 tag 不保证
重跑，而且如果它已经跑到 clone tap 那一步，状态会更难理清。

```bash
gh run view <id> --log-failed      # 先看清挂在哪一步
git push --delete origin v0.4.2 && git tag -d v0.4.2
# 修 → commit → 重新 tag → push
```

按失败发生的时间点判断死因：

| 什么时候挂 | 大概率是 |
| --- | --- |
| ~30 秒 | 版本校验：`tauri.conf.json` 没 bump 或与 tag 不一致 |
| 1~2 分钟 | 测试没过（第 3 步跳过了） |
| 几分钟后 | 签名 / 公证：`MACOS_CERT_P12`、`MACOS_CERT_PASSWORD`、`NOTARY_KEY`、`NOTARY_KEY_ID`、`NOTARY_ISSUER_ID` 里有过期或缺失的 |

签名凭据源文件在 `~/Sync/apple-developer/`，背景见
`../vocalflow-mac/kb/notes/2026-08-10-macos-developer-id-signing-guide.md`。

## 相关

- `workflow_dispatch` 手动触发只构建 + 传 artifact，不发 release —— 想验证签名链路而
  不真发版时用它（`gh workflow run release.yml`）。
- cask 的 zap 列表引用 identifier `top.ideachat.mdnotate`，identifier 改了要同步。
- 本地验证打包产物用 `open src-tauri/target/release/bundle/macos/mdnotate.app`。
  **绝不要**把未签名产物拷进 `/Applications` —— 它会顶掉签名版并静默失去文档 handler
  资格，原因见 `AGENTS.md` 的「开发命令」一节。
