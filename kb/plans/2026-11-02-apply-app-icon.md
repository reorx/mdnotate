---
created: 2026-11-02
tags:
  - app-icon
  - macos
  - brief
---

# 任务说明：把定稿图标应用为 mdnotate 的 App 图标

- **执行者**：Codex，在 Herdr 的独立 tab 里。
- **位置**：`/Users/reorx/Code/mdnotate`，当前 checkout 的 `master` 分支。不建分支，不建 worktree。
- **说明由谁写**：Claude 代用户写。下面“已定的决定”表里标“用户”的是用户定的，不要改；标“Claude”的是 Claude 定的，用户没逐条确认。你有更好的理由可以不同意，在总结里写明。
- **开工前先读**：
  - `AGENTS.md`：项目规则。
  - `kb/docs/app-icon.md`：图标画的是什么、源文件在哪。
  - `kb/docs/verification.md` 的“打包产物”和“测完要收拾”两节。
  - `kb/docs/macos-integration.md` 里“不要把未签名产物拷进 /Applications”那一段。
  - `design/app-icon/icons.mjs`。

## 目标

`src-tauri/icons/` 里的全部文件改由 `design/app-icon/icons.mjs` 生成，替换现在的 Tauri 默认图标。16 / 32 px 用单独画的简化版。生成过程是一条可重复运行的命令。打包出来的 `.app` 在 Finder 里显示新图标。

## 完成标准

1. 一条命令（建议 `node design/app-icon/build-icons.mjs`，同时在 `package.json` 加一个 `icons` script）从 `icons.mjs` 重新生成 `src-tauri/icons/` 的全部文件。连跑两次，`git status` 没有新的改动。
2. 用 `iconutil -c iconset` 解开 `src-tauri/icons/icon.icns`：`icon_16x16`、`icon_16x16@2x`、`icon_32x32` 三档是简化版，其余各档是主图，每档像素尺寸都正确。
3. `src-tauri/icons/` 的文件集合和 `tauri.conf.json` 的 `bundle.icon` 引用不变：文件名一样，内容换新。
4. `mise exec -- pnpm tauri build --bundles app` 成功。`qlmanage -t -s 512 -o <dir> <打包出的 .app>` 生成的缩略图是新图标。打包产物在 `~/Library/Caches/cargo-target/release/bundle/macos/`，本机的 cargo target-dir 不在 `src-tauri/target/`。
5. 验完对打包产物执行过 `lsregister -u`（完整路径见 `kb/docs/verification.md`）。
6. `kb/docs/app-icon.md` 的“网格与小尺寸”和“应用到 App”两节写成做完以后的现状：怎么生成、生成了哪些文件、小尺寸用在哪几档。
7. `index.html` 的 favicon 换成新图标，`mise exec -- pnpm build` 通过。

## 已定的决定

| 问题 | 决定 | 谁定的 |
|---|---|---|
| 用哪个图标 | 定稿“纸页荧光笔”，即 `icons.mjs` 的 `mdnotate()`，导出为 `design/app-icon/mdnotate.svg`。主图一个像素都不改 | 用户 |
| 源头 | `icons.mjs` 是唯一源头；`src-tauri/icons/` 和导出的 SVG 都是生成物，不手改 | Claude |
| 小尺寸 | 在 `icons.mjs` 里加一个简化版：去掉细正文线，只留标题条、高亮条（连同压在上面的深色字线）和评论气泡，元素加粗加大，保持主图的颜色和构图；导出为 `design/app-icon/mdnotate-small.svg`。用在 `.icns` 的 16、16@2x、32 三档，64 px 起用主图。理由：这三档的细线会糊成灰色，macOS 在小尺寸下直接用对应档位，不会从大图缩 | Claude |
| 工具 | 渲染 PNG 用本机 Homebrew 的 `resvg`（`/opt/homebrew/bin/resvg`），`.icns` 用系统自带的 `iconutil`，Windows / Linux 那些文件（`icon.ico`、`Square*Logo.png`、`StoreLogo.png`）可以交给 `pnpm tauri icon <1024 png> -o src-tauri/icons`。不新增 npm 依赖。理由：一年改一两次的工具，不值得给项目加依赖。脚本开头检查 `resvg` 是否存在，不存在就报错并提示 `brew install resvg` | Claude |
| `tauri icon` 多出来的东西 | 如果它额外生成 `android/`、`ios/` 等目录或文件，删掉。这是 macOS-only 的 App，保持现有的文件集合 | Claude |
| `.icns` | 用 `iconutil -c icns` 从自己组装的 iconset 生成，覆盖 `tauri icon` 产出的那份，这样小尺寸档才是简化版 | Claude |
| 浏览器 favicon | `public/favicon.svg` 用主图 SVG（由脚本一起导出），`index.html` 改为引用它，删掉 `public/vite.svg`。`public/tauri.svg` 不动 | Claude |

## 范围

- **`design/app-icon/`**：`icons.mjs` 加简化版并在 `ICONS` 里登记；新增 `build-icons.mjs`，按顺序导出 SVG、渲染 PNG、组装 iconset、生成全部图标文件。英文注释，风格和 `icons.mjs`、`export.mjs` 一致。
- **`src-tauri/icons/`**：全部重新生成。
- **前端**：`index.html` 和 `public/` 的 favicon。
- **文档**：`kb/docs/app-icon.md` 两节（见完成标准 6），记得把 frontmatter 的 `updated` 写成当天。

## 不做的事

- 不改两个备选（`alternatives/` 下的图和它们在 `icons.mjs` 里的画法），也不改主图的设计。
- 不改 reorx-apps 仓库，它是另一个项目。
- 不发版：不 bump version、不打 tag、不 push。
- 不把打包产物拷进 /Applications，也不 `open` 运行它；看图标用 `qlmanage` 就够了。
- 不用 computer-use 或 agent-desktop 去看 Dock。用户在这台 Mac 上工作，桌面操作会打断他。
- 不改 `tauri.conf.json` 里图标以外的配置。

## 怎么做

- 这是资源生成，不是业务逻辑，不需要先写 vitest 测试。验证靠完成标准里的检查和下面的对比图。
- 把 iconset 里的每一档（16、32、64、128、256、512、1024）拼成一张对比图，浅色底和深色底各一行，16 和 32 再放大四倍（最近邻）各放一份，用来看小尺寸版是否比主图缩小的效果更清楚。用 `magick` 拼图即可。
- 非交互 shell 跑 pnpm 用 `mise exec -- pnpm ...`。
- 自己启动的进程，用完都结束掉。

## 约束

- 只在本仓库里改：`design/app-icon/`、`src-tauri/icons/`、`index.html`、`public/`、`package.json`（只加 script，不加依赖）、`kb/docs/app-icon.md`，以及你写的 session 总结。
- **`AGENTS.md`、`kb/next-up.md`、`kb/known-issues.md` 不要改**，Claude 会在你完成后统一更新。需要改的地方写进总结。
- 范围外发现的问题不要顺手修，写进总结的“范围外发现”一节。
- `git add` 只加你改的文件，用一个提交，提交信息用中文，风格参考 `git log`（例如 `feat: ...`）。不 push。

## 完成后留下

1. 一个提交。
2. session 总结 `kb/sessions/2026-11-02-apply-app-icon.md`，格式参考 `kb/sessions/` 下已有的文件。写清楚生成命令、验证结果（各项完成标准逐条打勾）、对比图和 qlmanage 缩略图的路径、你和这份说明不一致的决定及理由、需要 Claude 改 `AGENTS.md` 的地方、范围外发现。
3. 对比图和缩略图放在 `tmp/2026-11-02-apply-app-icon/`。
4. 最后的回复要短：提交哈希、总结路径，以及你自己拿主意的地方。
