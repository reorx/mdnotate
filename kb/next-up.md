# Next up

> 接下来要做的事，按时间排。做完一项就删掉，结果记到条目指定的 kb 文档，这里不留记录。

## 用户方便在 Tauri 里实机操作时

- **编辑模式人工验收**：`pnpm tauri dev`，按 `tmp/2026-10-21-edit-mode/acceptance-report.md` 第 3 节的 14 项逐条走（样例文件在同目录 `manual/`）。重点：原生三按钮对话框的 Return / Esc 落点、关窗与 ⌘Q 逐个确认（含两个窗口都有改动、中途 Cancel 停止退出）、⌘Q 关完所有窗口后 app 确实退出、中文输入法组字时 Enter / Esc。
  → 结果记到 `kb/plans/2026-10-21-edit-mode.md` 实施步骤第 11 步；发现的问题进 `kb/known-issues.md`
