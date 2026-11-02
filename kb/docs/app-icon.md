---
created: 2026-11-02
tags:
  - design
  - app-icon
  - macos
---

# App 图标

写给要改 mdnotate 的图标、把它重新生成成 App 图标文件，或者想换一个图标方向的人：图标画的是什么、颜色从哪来、源文件在哪、留着哪些备选。

## 画的是什么

整个图标就是一页纸：一条标题、五行正文，其中一行被琥珀色荧光笔划过，右侧页边一个橙色评论气泡指回这一行。对应 mdnotate 做的三件事：读、划线、写评论。

颜色取自 App 界面本身：荧光笔是 App 里高亮的琥珀色，气泡是 Export 按钮的橙色，底是纸色。用户打开 App 之前和之后看到的是同一套颜色。reorx 工作室的 Forge 品牌只当作配色上的浅参考（鲜活、有温度），单个 App 的图标不套品牌色和造型。

正文栏故意收窄，把位置让给评论气泡。气泡在 Dock 尺寸下要能看出是一个对话框，在 32 px 下至少是一个清楚的橙点。气泡一缩小，图标就退化成“一页纸”，批注的意思就没了。

## 网格与小尺寸

图标按 Apple 的 macOS 图标模板画：1024 画布，主体 824 见方、四周内缩 100、圆角 185.4，带向下的投影。reorx 的其他 App 图标也是这套网格，放进 Dock 里大小一致。

缩到 16 / 32 px 时，细的正文线会糊成灰色，只剩纸色底、黄条和橙点。要在这两档更清楚，做法是单独画一版小尺寸（去掉细正文线，只留标题、高亮条和气泡），打进 `.icns` 的 16 / 32 px 档；macOS 在小尺寸下会直接用这一档，不会从大图缩。

## 源文件

图标是用代码画的 SVG，源头只有一个：`design/app-icon/icons.mjs`。改完运行 `node design/app-icon/export.mjs`，导出：

- `design/app-icon/mdnotate.svg` —— 定稿
- `design/app-icon/alternatives/page-bubble.svg`、`design/app-icon/alternatives/riso-hash.svg` —— 两个备选

导出的 SVG 不要手改，下次导出会被覆盖。

## 备选

两个方向留着原样，想换方向时从这里接着迭代：

- **批注页**（`page-bubble.svg`）：一页文档和一个对话气泡合成一个白色剪影，蓝底，页里一行高亮。各个尺寸里它最清楚，但蓝色不是 mdnotate 的颜色，“文档 + 气泡”也是评论类 App 的通用画法。
- **套印**（`riso-hash.svg`）：Markdown 的 `#` 被荧光黄划过，角上一张粉色便签，三种油墨按套印叠色，纸面带颗粒。最有个性、最难撞车；风险是 `#` 会被读成话题标签或 Slack 频道。

看过但没有留下的方向：

- 引号 `>`（导出格式本身）：第一眼像终端图标，也没有“批注”的意思。
- 划词（深色页面里的选区和两个手柄）：手柄在小尺寸下像滑杆。
- 批注页的结构换成定稿的颜色（橙色页面、暖橙底、石墨页面三种）：都成立，但定稿这种带页边气泡的纸页更像 mdnotate 本身。
- 套印换成一对引号：不如 `#` 好认，两个引号乍看像数字 66。

## 应用到 App

打包用的图标文件在 `src-tauri/icons/`，由 `src-tauri/tauri.conf.json` 的 `bundle.icon` 引用，macOS 用的是其中的 `icon.icns`。这些文件目前还是 Tauri 的默认图标，尚未从 `mdnotate.svg` 生成。

mdnotate 在 reorx-apps 网站上的图标是另一份文件（reorx-apps 仓库的 `src/content/apps/mdnotate/icon.svg`），换图标时要一起换。

## 相关文件

- `design/app-icon/icons.mjs`、`design/app-icon/export.mjs`
- `src-tauri/icons/`、`src-tauri/tauri.conf.json`（`bundle.icon`）
- `src/App.css` —— App 界面的琥珀色与橙色
