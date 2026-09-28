---
created: 2026-09-28
tags:
  - macos
  - launchservices
  - file-association
  - default-app
  - window-drag
---

# macOS 集成：文件关联、默认 App 与窗口拖拽

写给要动 `.md` 文件关联、「设为默认 App」卡片或顶栏拖拽的人。这几处的共同点是：macOS 的行为和文档写的不一样，调用成功不代表生效，而且多数只能在打包后的 app 上验证。

## 文件关联与 scheme 注册

两处配置共同生效，且都只在打包后的 .app 里生效：

- `tauri.conf.json` 的 `bundle.fileAssociations`
- 手写的 `src-tauri/Info.plist`：`CFBundleDocumentTypes` 管 `.md` 关联，`CFBundleURLTypes` 管 `mdnotate://` scheme

**document type 有两条，缺一不可：**

1. 一条按内容类型（UTI）声明。
2. 一条只按扩展名声明。

原因是 macOS 的规则：一个条目里只要写了内容类型，同条目的扩展名列表就被忽略。而 `.md` 绑定到哪个 UTI 是机器相关的（见下）。缺了只按扩展名的那条，在别的 UTI 赢得绑定的机器上，mdnotate 会从 Finder「打开方式」里灰掉。

## 默认 App

首页的卡片显示 mdnotate 是否为 `.md` 的默认打开方式，并提供一键设置。Rust 侧直接调 LaunchServices 的 C 接口。

### UTI 不能硬编码

`.md` 实际映射到哪个 UTI 是机器相关的。iA Writer、Typora 这类编辑器会**导出**自己的 markdown UTI，并可能赢得扩展名绑定。把默认 handler 设在通用的 markdown UTI 名下，结果是「读回来显示已是默认，Finder 双击却打开别人」。

所以每台机器现查 `.md` / `.markdown` 当前绑定的 UTI，设置时全部写入，判断是否默认时要求全部指向自己。

`mdls` 显示的内容类型是 Spotlight 的缓存，可能是旧绑定，不要用它判断。

### 设置是异步的，且要用户确认

调用设置接口后，macOS 会自己弹「使用 mdnotate / 保留 X」的对话框。而接口**立刻返回成功**，此时读回来仍是旧 handler；对不存在的 bundle id 也照样返回成功。

所以前端点完按钮进入等待状态，轮询当前状态等结果，超时才提示用户走 Finder 的「显示简介」手动设置。

在 macOS 26 上验证过：用户确认之前，无论新旧接口都不会改动关联。

### 开发时的限制

dev 构建跑的是未打包的二进制，又用着 `.dev` 的 identifier，这张卡片永远显示未注册。完整验证需要打包后运行 .app。浏览器模式下有一个仅开发可见的假实现，用来调界面。

## 不要把未签名的构建拷进 /Applications

`pnpm tauri build` 在没有签名凭据时产出的是 ad-hoc 签名，Resources 没有被封存，签名校验必然失败。把它放进 /Applications 的后果：

- macOS 静默取消它作为文档 handler 的资格。症状是 app 内显示已是默认应用，Finder 双击却打开别的 app，「打开方式」里 mdnotate 灰掉不可选。
- 它还会顶掉 brew 装的签名版。

本地验证打包产物就在原地打开。要装进 /Applications，用 `pnpm build:signed` 的产物，或 `brew reinstall --cask mdnotate`。

## 窗口拖拽

顶栏拖动窗口**不能靠 Tauri 自带的拖拽区域**。在 macOS 26 (Tahoe) 上它拖不动。

原因在时序。Tauri 的链路是：前端脚本 → 异步 command → 事件循环 → 原生拖拽调用。跑到最后一步时，系统当前事件已经从「鼠标按下」变成「鼠标拖动」，而 Tahoe 对不是「活的鼠标按下」的事件直接静默忽略。旧系统容忍过期事件，所以以前能拖。

替代做法：

- Rust 侧一个**同步**的 command。同步 command 跑在主线程，此时鼠标按下事件还在分发中。它在光标当前位置合成一个新的鼠标按下事件，再交给原生拖拽调用。**这个 command 改成异步就失效。**
- 前端在 **capture 阶段**监听鼠标按下。否则会被 Tauri 自己的拖拽脚本抢先拦掉。
- 双击不拦，留给 Tauri 的脚本处理成最大化。
- `data-tauri-drag-region` 属性保留在元素上，由我们自己的监听读取。

## 代码位置

- `src-tauri/Info.plist`、`src-tauri/tauri.conf.json` —— 文件关联与 scheme
- `src-tauri/src/default_app.rs` —— LaunchServices 调用、UTI 解析
- `src/lib/default-app.ts`、`src/components/DefaultAppCard.tsx` —— 等待与轮询（`tests/default-app.test.ts`）
- `src-tauri/src/lib.rs` 的 `start_window_drag`、`src/lib/window-drag.ts`（`tests/window-drag.test.ts`）
