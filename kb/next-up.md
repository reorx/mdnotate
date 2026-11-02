# Next up

> 接下来要做的事，按时间排。做完一项就删掉，结果记到条目指定的 kb 文档，这里不留记录。

## 用户方便在 Tauri 里实机操作时

- **标注导入的 WKWebView / SQLite 补验**（浏览器往返、即时高亮、草稿保留、存储故障已验）：导入默认格式 → 编辑评论 → 重开同一文档，确认 SQLite 保留；中文组字时 Enter / Esc 不提交或退出导入。未改变数据库 schema 或写入接口。
  → 结果记到 `kb/plans/2026-11-02-import-annotations.md`；浏览器材料在 `tmp/2026-11-02-import-annotations/`
- **编辑模式人工验收**：`pnpm tauri dev`，按 `tmp/2026-10-21-edit-mode/acceptance-report.md` 第 3 节的 14 项逐条走（样例文件在同目录 `manual/`）。重点：原生三按钮对话框的 Return / Esc 落点、关窗与 ⌘Q 逐个确认（含两个窗口都有改动、中途 Cancel 停止退出）、⌘Q 关完所有窗口后 app 确实退出、中文输入法组字时 Enter / Esc。
  → 结果记到 `kb/plans/2026-10-21-edit-mode.md` 实施步骤第 11 步；发现的问题进 `kb/known-issues.md`
- **有序列表编号与侧栏评论的 WKWebView 验收**（浏览器模式已验过，截图在 `tmp/2026-10-29-list-numbers-panel-comments/`）：① 从编号开始划词再 ⌘C，粘贴出来是「1. Install…」带空格（WebKit 的复制序列化和 Chrome 可能不同）；② 打开一篇升级前就有标注、含有序列表的文档，标注位置不偏、没有「discarded」提示（真 SQLite 走 `rebaseAnnotations`）；③ 侧栏评论框里中文输入法组字时 Enter / Esc 不误触发。
  → 结果记到 `kb/docs/reader-ui.md`「有序列表的编号是文字」一节；发现的问题进 `kb/known-issues.md`
