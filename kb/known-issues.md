# Known Issues

> 当前 app 里会影响使用或系统稳定、还有待处理的问题。有意的设计取舍、明确不做的功能、改不了的限制不记在这里。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

## 编辑：从 Dock 退出、注销或关机时，未保存的编辑直接丢失

- 记录：2026-10-21（编辑模式开发时查 tao 0.35.3 源码确认；`kb/plans/2026-10-21-edit-mode.md`）
- 有窗口处于编辑模式且有未保存改动时，Dock 菜单「退出」、注销、关机都走 `terminate:`。tao 的 app delegate 没实现 `applicationShouldTerminate:`，app 当场退出，不弹保存确认。⌘Q 已改成自己的菜单项，不受影响。
- 处理方向：在 Rust 侧给 NSApp 的 delegate 补 `applicationShouldTerminate:`（返回 `NSTerminateLater`，逐窗确认后 `replyToApplicationShouldTerminate:`），或等 tao 支持。

## 窄窗口：顶栏标题与 Edit 操作区重叠

- 记录：2026-11-01（Obsidian 图片验收，macOS 26.7.1，截图 `tmp/2026-11-01-obsidian-images/tauri-narrow.png`）
- 窗口缩至允许的 600px 时，居中标题 `test.md` 与 Edit 按钮重叠。两侧栏全开还会把正文压得很窄；图片仍在正文列内正确缩放，无页面横向溢出。
- 处理方向：给顶栏标题与操作区明确的可用宽度约束，并考虑窄窗口侧栏的收起策略。
