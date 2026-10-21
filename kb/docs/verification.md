---
created: 2026-09-28
updated: 2026-10-21
tags:
  - testing
  - verification
  - runbook
---

# 验收手册

写给改完代码要验证它的人（多半是 agent）：每类改动该走哪条验证路线、哪些工具在这台机器上不管用、测完要收拾什么。

文中 `tmp/` 下的脚本只存在于开发机本地（`tmp/` 已 gitignore），换机器要重写。

## 先选路线

| 改了什么 | 怎么验 |
|---|---|
| `src/lib` 的纯逻辑 | `pnpm test` |
| 界面（不依赖 Tauri 后端） | `pnpm dev` + agent-browser，浏览器模式 |
| Rust + SQLite | `pnpm tauri dev` 起实例 → 用 debug 二进制转发文档 → 查库 |
| 窗口数量、位置、聚焦 | 窗口列表脚本 |
| 冷启动、文件关联 | 打包产物 + `open -a` |
| `mdnotate://` 链接 | 真正注册在系统里的那份 app |
| `mdnotate` 命令 | `cargo test -p mdnotate-cli`，符号链接解析另走 `tmp/smoke-cli.sh` |
| 命令的签名 | `tmp/verify-cli-signing.sh` |

**Tauri 窗口没法用 agent-browser 驱动**（不开 CDP）。截图和 System Events 基本被系统权限挡死：截图全黑，辅助功能报 0 个窗口。所以 Tauri 窗口里的界面改动只能靠人眼验收；能在浏览器模式里验的，尽量在浏览器模式里验。

## 浏览器模式

只跑前端时，Recent 走 `localStorage`，首页有仅开发可见的示例文档入口。

**划词**：agent-browser 的合成指针事件触发不了标注库的选区，必须用真实的鼠标序列：

```
mouse move → mouse down → mouse move（中间点）→ mouse move（终点）→ mouse up
```

**剪切板**：浏览器里读剪切板会被权限拒绝，卡片恒显示空。调界面时用 `eval` 覆盖 `navigator.clipboard`，再派发一次窗口 focus 事件触发重读。

**深色模式**：`agent-browser set media dark|light` 模拟系统偏好。headless Chrome 默认就是深色。

## Rust 与数据库

1. `pnpm tauri dev` 起实例。
2. 用 debug 二进制 `<target-dir>/debug/mdnotate '<spec>'` 触发 single-instance 转发。spec 可以是路径、`host:path`、或 `mdnotate://open?path=…`。target-dir 默认是 `src-tauri/target/`，但本机 `~/.cargo/config.toml` 全局设成了 `~/Library/Caches/cargo-target`。
3. `sqlite3` 直接查库断言。

注意：

- dev 的库在 `~/Library/Application Support/top.ideachat.mdnotate.dev/`，不是正式版的目录。
- 路径会被规范化：`/tmp/x.md` 落库是 `file:/private/tmp/x.md`。

### 前端不碰库

先怀疑数据库连接挂了。连接是被记住的，一次失败之后全线静默。

- `lsof -p <pid> | grep mdnotate.db` —— 有没有文件句柄
- 查 `_sqlx_migrations` 表 —— 版本停在哪

### 模拟应用侧写入

需要真实的 docId 和内容哈希。这些函数用了无扩展名 import，`node` 直接跑会报模块找不到，得借 vitest 的解析器：

```bash
DOC_SPEC=… DOC_TEXT_FILE=… DOC_OUT=… pnpm exec vitest run tmp/doc-hash.test.ts --config /dev/null
```

vitest 的 `include` 只认 `tests/`，所以要 `--config /dev/null`。

## 窗口行为

窗口行为可以自动验收。`CGWindowListCopyWindowInfo`（pyobjc 的 Quartz，本机已装）不需要辅助功能权限就能拿到：

- 窗口数量与坐标；
- **前后顺序**：返回顺序就是从前到后，用来断言「已开的文档被聚焦」；
- 窗口标题：本机给了屏幕录制权限所以读得到。标题就是文档名，用来断言哪个窗口装着哪个文档。

脚本是 `tmp/multiwindow/list-windows.py`。

## 打包产物

```bash
pnpm tauri build --bundles app
```

### 冷启动

冷启动只能用打包产物验：

```bash
open -a <built app> <file.md>
```

- `open -a` 直接指定 app 包就会走系统的文档打开流程，不需要先注册。
- **必须先退出 /Applications 里装着的那份。** 打包产物和它 identifier 相同，single-instance 会把文档转发给先起来的那个。dev 实例用的是 `.dev` identifier，不参与这场撞车。
- 冷启动（app 没在跑）和热启动（已在跑）是两条不同的代码路径，都要试。

### 链接

`open 'mdnotate://…'` **验不了未安装的构建产物**。scheme 的 handler 是系统里注册的那份（通常是 /Applications 里的），它起来后发现已有实例，把空参数转发过去就退出了，链接直接丢失。

要验 scheme，先把打包产物注册进系统：

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f <app>
open 'mdnotate://open?path=…'
```

### 默认 App

dev 构建下这张卡片永远显示未注册，只能用打包产物验。

## 测完要收拾

- **`lsregister -u <built app>`**。`open -a` 和 `lsregister -f` 都会把未签名产物注册进系统，留着它可能顶掉 /Applications 里签名版的 `.md` 关联。
- **不要把未签名产物拷进 /Applications**，原因见 `macos-integration.md`。
- 杀干净 dev 实例（见下）。
- 释放 agent-browser 会话。
- 如果为了验证退出了用户正在用的 app，验完把它开回来。

## 两个会误导判断的坑

### `pkill -f "tauri dev"` 杀不干净

它只杀 CLI 父进程。真正在跑的 `target/debug/mdnotate` 会继续活着，并占着 dev 的 socket。症状是下一次 `tauri dev` 起来的实例收不到转发 —— 文档悄悄进了那个看不见的旧实例。

```bash
pkill -f "tauri dev"; pkill -f "target/debug/mdnotate"
```

### 同时改了 Rust 和前端时不要信热更新

Rust 重建会重启 app、webview 重新加载，两边很容易错位成「前端是新的、二进制是旧的」。症状是某一类打开方式静默失败。

遇到解释不通的现象，先整个重启一遍再下结论。

## 唯一的组件测试

`tests/ime-keys.dom.test.tsx` 是唯一的组件测试，而且刻意只有这一个。

「组件层不写单测」的例外仅限于「浏览器到底派发了什么」这类事实。jsdom 尊重键盘事件的组字标志，所以整条输入法序列可以原样回放，不需要真机输入法。它的测试环境靠文件顶部的注释单独切到 jsdom，全局仍是 node。

要测别的东西，回到 `src/lib` + 纯函数那条路。
