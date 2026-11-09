---
created: 2026-11-09
tags:
  - window
  - persistence
  - macos
---

# 记住用户调整的窗口大小与位置

## 概要

窗口原来每次使用默认尺寸，位置只从前窗级联。本次在 Rust 侧保存用户最后调整的 logical frame，新建 main 和 doc-N 共用建窗流程：恢复尺寸位置、按显示器工作区纠正越界、按 28pt 逐个避让。创建窗口时登记实际 frame，启动与程序级联事件不会覆盖偏好，避免位置逐次漂移。

## 修改的文件

- `src-tauri/src/window_frame.rs`：布局、容差比较、存储值校验、各窗口已知 frame 和 Rust store 持久化。
- `src-tauri/src/lib.rs`、`tauri.conf.json`：统一 `build_window()`，setup 首先创建 main，接入移动、缩放和销毁事件。
- `kb/docs/window-routing.md`、`data-storage.md`、`AGENTS.md`：更新窗口与存储规则；验收文档同步本机可用的原生测试工具。
- 四处版本文件：通过 bump 脚本统一升级至 0.15.0。

## 验证

- BDD：先写 13 个行为测试，确认全部失败，再实现直到通过；覆盖多屏选择、逐个避让、回绕、越界、尺寸过大、缺失显示器、容差及非法存储值。
- Rust app：65 个测试通过；CLI：111 个测试通过；前端：36 个文件、512 个测试通过；前端生产构建及 TypeScript 检查通过。
- 原生 dev：main 恢复为 240,160 / 900×640；alpha 填入 main，beta、gamma 分别为 268,188 和 296,216，均保持尺寸；持久化值不变。
- 通过辅助功能把 gamma 移至 350,220、缩为 960×680，store 自动保存；重启 main 恢复该 frame，新窗口为 378,248，store 不漂移。
- x=6000 的记录被恢复到主屏 x=1404，尺寸保留，原记录不被覆盖；无记录时恢复系统定位和 1080×800 默认尺寸。
- 截图、窗口 JSON、脚本和执行日志归档在 `tmp/2026-11-09-window-frame/`。测试后已停止 dev、Vite 进程并还原 dev frame 文件原先不存在的状态。

## 注意事项

main 的 config 必须保留 `create: false`，由 setup 在 drain 冷启动文档之前创建。所有窗口必须走 `build_window()`。记住的是外框原点和内容尺寸，按各窗口及各显示器自己的缩放因子换算 logical points。不要查询 `is_maximized()`，避免 tao 为判断 zoom 临时改 style mask。

当前机器 `agent-desktop` 的辅助功能与截图权限可用，原生 frame 可自动验收；操作前按 PID 分清 dev 与正式版，先 `wake-screen`。测试脚本同时清理自己的进程组，避免 Vite 子进程占着 1420 端口。

## 遗留问题

0.15.0 的 Release 和 Homebrew cask 已发布，SHA-256 为 `d723b97306e7c929087dcb7ca47e2ce12938f265c70aafe42f4df64b6a25482f`。CI 成功，但下载的 app 缺少离线公证票据：Apple 已接受公证，在线 Gatekeeper 通过；手动给临时 app 附票据后全部分发检查通过。已记入 known-issues，后续需修复发布流程对票据的检查，不覆盖已发布产物。

本机正式版仍在运行，已按发布文档请求用户自行 ⌘Q 退出。升级和打包冷启动检查等待这一步，安装时会为本机 app 附上票据。

## 相关文档

- [窗口路由](../docs/window-routing.md) — 更新 frame、建窗与冷启动规则。
- [数据存储](../docs/data-storage.md) — 更新 Rust 管理的 window.json。
- [验收手册](../docs/verification.md) — 参考并更新原生测试方式。
- [发布流程](../docs/release.md) — 依据其预检、发布和本机升级步骤执行。
