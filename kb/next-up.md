# Next up

> 接下来要做的事，按时间排。做完一项就删掉，结果记到条目指定的 kb 文档，这里不留记录。

## 屏幕可截图、用户方便时

- **0.16.0 一键 Export and Copy 的原生实机补验**（2026-11-17）：0.16.0 已发布并升级本机（`/Applications/mdnotate.app`），浏览器模式已验，原生窗口里的点击还没验——当时显示器不可截图（`screencapture` 报 `could not create image from display`，`wake-screen` 卡住不返回），没法驱动窗口。做法：先 `pbpaste > 备份`，用独立 HOME 启动安装版（`HOME=<临时目录> /Applications/mdnotate.app/Contents/MacOS/mdnotate <测试.md>`，不碰真实库）划一个词加评论，点顶栏 Export and Copy，`pbpaste` 应与侧栏 Export 页面内容一致，再还原剪贴板。写剪贴板走的是与旧 Export 页「Copy」同一个 `writeClipboardText`（Tauri clipboard-manager，权限早已在 capabilities 里），风险低。
  → 结果记到 `kb/docs/annotations-and-export.md`；备份剪贴板与测试文档在 `tmp/2026-11-17-quick-export-rerun/`

## 用户方便在 Tauri 里实机操作时

- **窗口 frame 的冷启动补验（正式版）**：本机已在 2026-11-17 随 0.16.0 升级（含 0.15.0 的窗口 frame 功能；dev 实机已全部通过）。待补：`open -a /Applications/mdnotate.app <file.md>` 确认冷启动只有一个文档窗口，移动缩放后退出重开能恢复，最后把 app 开回来。
  → 结果记到 `kb/sessions/2026-11-09-window-frame.md`；dmg、Homebrew 缓存、脚本与验收材料已准备在 `tmp/2026-11-09-window-frame/`
- **标注导入的 WKWebView / SQLite 补验**（浏览器往返、即时高亮、草稿保留、存储故障已验）：导入默认格式 → 编辑评论 → 重开同一文档，确认 SQLite 保留；中文组字时 Enter / Esc 不提交或退出导入。未改变数据库 schema 或写入接口。
  → 结果记到 `kb/plans/2026-11-02-import-annotations.md`；浏览器材料在 `tmp/2026-11-02-import-annotations/`
- **编辑模式人工验收**：`pnpm tauri dev`，按 `tmp/2026-10-21-edit-mode/acceptance-report.md` 第 3 节的 14 项逐条走（样例文件在同目录 `manual/`）。重点：原生三按钮对话框的 Return / Esc 落点、关窗与 ⌘Q 逐个确认（含两个窗口都有改动、中途 Cancel 停止退出）、⌘Q 关完所有窗口后 app 确实退出、中文输入法组字时 Enter / Esc。
  → 结果记到 `kb/plans/2026-10-21-edit-mode.md` 实施步骤第 11 步；发现的问题进 `kb/known-issues.md`
- **有序列表编号与侧栏评论的 WKWebView 验收**（浏览器模式已验过，截图在 `tmp/2026-10-29-list-numbers-panel-comments/`）：① 从编号开始划词再 ⌘C，粘贴出来是「1. Install…」带空格（WebKit 的复制序列化和 Chrome 可能不同）；② 打开一篇升级前就有标注、含有序列表的文档，标注位置不偏、没有「discarded」提示（真 SQLite 走 `rebaseAnnotations`）；③ 侧栏评论框里中文输入法组字时 Enter / Esc 不误触发。
  → 结果记到 `kb/docs/reader-ui.md`「有序列表的编号是文字」一节；发现的问题进 `kb/known-issues.md`
