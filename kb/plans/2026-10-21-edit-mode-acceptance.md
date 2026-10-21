---
created: 2026-10-21
tags:
  - editor
  - acceptance
  - verification
---

# 编辑模式验收（委托给新 tab 的 agent）

由主 session 的 Claude 编写。执行者：herdr 新 tab 里的 Claude agent，在 `/Users/reorx/Code/mdnotate` 当前分支 `master` 上工作（不开 worktree、不开新分支）。

开始前先读：

1. `AGENTS.md`（项目规则）
2. `kb/plans/2026-10-21-edit-mode.md`（PRD 的「验收标准」就是你要验的东西；Tech Design 说明实现）
3. `kb/docs/editing.md`（编辑模式的行为说明）
4. `kb/docs/verification.md`（这台机器上哪些验证手段可用、哪些被系统权限挡住）

## 目标

确认编辑模式按 PRD 工作；发现的 bug 当场修掉（TDD：能写成 `tests/` 里的测试就先写测试复现）。最后留下一份验收报告和截图，告诉主 session 哪些验过了、哪些只能人眼验。

## 完成标准

- 下面「范围」里每一项都有结论：通过 / 修复后通过 / 无法自动验证（写明原因）。
- `pnpm test`、`npx tsc --noEmit`、`cargo test --manifest-path src-tauri/Cargo.toml` 全绿。
- 报告写在 `tmp/2026-10-21-edit-mode/acceptance-report.md`，截图在同一目录。
- 起过的进程全部收掉（见「如何工作」）。

## 已定的决策（不要重新讨论）

| 问题 | 决定 | 谁定的 |
|---|---|---|
| 保存按钮 | 不要保存按钮；只有 ⌘S；未保存提示是标题后的「— Edited」 | 用户 |
| Edit / View 配色 | 阅读时蓝色 Edit（`bg-sky-600`），编辑时深色 View（`bg-neutral-800 text-page`，深色主题反转） | 用户 |
| 保存后标注 | 按引文精确匹配重新定位，多处取最近，找不到才丢弃并提示 | 用户 |
| 可编辑范围 | 只有本地文件；ssh / 剪切板按钮置灰 | 用户 |
| ⌘Q | 自定义 Quit 菜单项逐个关窗；Dock 退出不处理（已记 known-issues） | 用户 |
| 编辑器 | CodeMirror 6 自封装，⌘F / ⌘A 让给编辑器 | 主 session |
| 刷新按钮在编辑时 | 不置灰，按下走离开确认 | 主 session |

主 session 定的两项如果你在验收中发现明显不合理，可以在报告里提出不同意见，但不要自行改行为。

## 范围

### A. 浏览器模式（主要部分，不打扰用户桌面）

`pnpm dev` + agent-browser（headless）。首页有仅开发可见的示例文档入口。浏览器模式下保存是假写（直接成功），确认框降级为两次 `window.confirm`（第一次 OK = Save；否则第二次 OK = Don't Save，取消 = Cancel）。

1. 打开示例文档：Export 左边有蓝色 Edit；点击后正文变成编辑器（行号、Markdown 高亮），按钮原地变深色 View；Export 置灰；两侧栏变淡；状态栏显示「Editing · ⌘S to save」。截图。
2. 输入文字 → 标题出现「— Edited」；撤销回原样 → 消失；再改并 ⌘S → 消失。
3. 深浅主题（`agent-browser set media dark|light`）下编辑器配色正常（文字、行号、当前行、搜索面板）。各截一张。
4. 标注重新定位：回到 View，用真实鼠标序列（move → down → move → move → up，见 verification.md）划一句做 Highlight；进编辑，在那句**之前**插入一行文字，⌘S，点 View → 高亮仍在原来那几个字上。截图。再进编辑，改掉高亮句子里的一个字，⌘S → 错误条提示「1 annotation could not be found after saving and was removed」，View 后该高亮消失。
5. 未保存时点 View：三条路径都走一遍（Save → 保存并回到 View；Don't Save → 丢弃回到 View，内容是保存前的；Cancel → 留在编辑器，「— Edited」还在）。
6. 编辑器内：⌘A 选中全部文本（可用 `eval` 读 CodeMirror 选区长度对比文档长度）、⌘F 打开编辑器自己的搜索面板（不是阅读器的 FindBar）、⌘Z 撤销、Enter 在列表项后自动续列表。
7. 编辑中打开设置页再回来，编辑器内容和「— Edited」原样还在。

### B. Rust 写文件（无界面，补自动化测试）

给 `write_local_file` 补一个 `#[cfg(test)]` 测试，在临时目录里真实写文件：写入后内容一致、返回的 modified 与磁盘一致；`expected_modified` 与磁盘不同时返回 Conflict 且文件内容不变；`None` 时强制写入。写在 `src-tauri/src/lib.rs` 已有的 tests 模块里。

### C. Tauri dev（只做最小确认）

`pnpm tauri dev` 起一次，确认能编译、启动、终端里没有 panic 或权限报错（例如 `core:window:allow-destroy`、`dialog` 相关）。**不要**用 computer-use / System Events 去点 Tauri 窗口（会打断用户正在用的桌面，而且截图和辅助功能被 TCC 挡住），确认启动正常后立即关掉。真实写盘、原生三按钮对话框、关窗、⌘Q、⌘O / 拖拽 / Finder 重开、中文输入法这些留给用户人眼验收：在报告里列一份**简短的人工验收清单**（每项一行：怎么操作、期望看到什么）。

## 不做的事

- 不改产品行为和 PRD 里已定的决策；不加新功能。
- 不碰 `AGENTS.md`、`kb/docs/`、`kb/plans/`（含本文件）、`kb/known-issues.md`、`kb/next-up.md` —— 这些由主 session 在看过你的报告后更新。范围外发现的问题写进报告的「范围外发现」一节。
- 不 push、不打 tag、不发版。

## 如何工作

- 修 bug 走 TDD：纯逻辑问题先在 `tests/` 写失败的测试再修；界面问题修完在浏览器里复验。
- `pnpm dev` 的端口 1420 是 strictPort。先 `lsof -i :1420` 看用户是不是自己开着；被占了就用 `pnpm exec vite --port 1430`，不要杀用户的进程。
- 起 `pnpm tauri dev` 之前同样确认没有用户自己的 dev 实例在跑；收尾时杀干净：`pkill -f "tauri dev"; pkill -f "target/debug/mdnotate"`（只杀你起的）。
- 收尾：关掉你起的 vite；`mac-dev-cleanup --only browser --min-age 2` 释放 agent-browser 会话。

## 约束

- 只改 `src/`、`src-tauri/src/`、`tests/` 下与编辑模式相关的文件，以及 `tmp/2026-10-21-edit-mode/`。
- 每修一个问题一个提交，`git add` 只加你改的文件（主 session 可能在同一 checkout 提交）。提交信息结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不要合并、不要 push。

## 完成时留下

`tmp/2026-10-21-edit-mode/acceptance-report.md`，包含：

1. 每个范围项的结论（通过 / 修复后通过 / 无法自动验证 + 原因），附截图文件名；
2. 你做的修复：问题、原因、提交 hash；
3. 人工验收清单（C 节）；
4. 范围外发现；
5. 对主 session 决策的不同意见（如有）。

最后在终端里回复一句报告路径即可。
