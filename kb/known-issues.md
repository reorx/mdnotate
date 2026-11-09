# Known Issues

> 当前 app 里会影响使用或系统稳定、还有待处理的问题。有意的设计取舍、明确不做的功能、改不了的限制不记在这里。只反映最新状态——解决了就删掉条目，经过记到 `kb/sessions/`。

## 发布：0.15.0 的 app 未附离线公证票据

- 记录：2026-11-09（发布后验证，`tmp/2026-11-09-window-frame/distribution-check.log`）
- Apple 已接受公证，在线 Gatekeeper 返回 `Notarized Developer ID`，但发布 dmg 内的 app 经 `stapler validate` 检查没有附带票据，`syspolicy_check distribution` 报 `Notary Ticket Missing`。新机器离线安装时无法通过本地票据完成公证验证。CI 显示 `Stapling app...`，目前的签名检查没有验证票据，因而仍发布成功。
- 对下载的临时 app 执行 `xcrun stapler staple` 后，票据验证和全部分发检查通过。后续应在打包 dmg 前显式验证 app 票据，并对最终 dmg 内的 app 再验一次；已发布的 0.15.0 产物不覆盖，修复后用新版本交付。

## 编辑：从 Dock 退出、注销或关机时，未保存的编辑直接丢失

- 记录：2026-10-21（编辑模式开发时查 tao 0.35.3 源码确认；`kb/plans/2026-10-21-edit-mode.md`）
- 有窗口处于编辑模式且有未保存改动时，Dock 菜单「退出」、注销、关机都走 `terminate:`。tao 的 app delegate 没实现 `applicationShouldTerminate:`，app 当场退出，不弹保存确认。⌘Q 已改成自己的菜单项，不受影响。
- 处理方向：在 Rust 侧给 NSApp 的 delegate 补 `applicationShouldTerminate:`（返回 `NSTerminateLater`，逐窗确认后 `replyToApplicationShouldTerminate:`），或等 tao 支持。

## 窄窗口：顶栏标题与 Edit 操作区重叠

- 记录：2026-11-01（Obsidian 图片验收，macOS 26.7.1，截图 `tmp/2026-11-01-obsidian-images/tauri-narrow.png`）
- 窗口缩至允许的 600px 时，居中标题 `test.md` 与 Edit 按钮重叠。两侧栏全开还会把正文压得很窄；图片仍在正文列内正确缩放，无页面横向溢出。
- 处理方向：给顶栏标题与操作区明确的可用宽度约束，并考虑窄窗口侧栏的收起策略。
