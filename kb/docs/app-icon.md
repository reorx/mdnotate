---
created: 2026-11-02
updated: 2026-11-02
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

小尺寸版去掉细正文线，只留加粗加大的标题条、高亮条（含上面的深色字线）和评论气泡，保持主图的纸色、琥珀色、橙色及构图。它由同一个源文件里的 `mdnotateSmall()` 绘制，导出为 `design/app-icon/mdnotate-small.svg`。

`.icns` 的 `icon_16x16`（16 px）、`icon_16x16@2x` 和 `icon_32x32`（均为 32 px）使用小尺寸版；`icon_32x32@2x`（64 px）起的各档使用定稿主图。macOS 可直接选择对应档位，让小图中的标题、高亮和气泡保持清楚。独立的 `src-tauri/icons/32x32.png` 也使用小尺寸版。

## 源文件

图标是用代码画的 SVG，源头只有一个：`design/app-icon/icons.mjs`。改完运行 `node design/app-icon/export.mjs`，导出：

- `design/app-icon/mdnotate.svg` —— 定稿
- `design/app-icon/mdnotate-small.svg` —— 小尺寸版
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

在 macOS 上运行一条命令，从 `icons.mjs` 重新生成 App 图标和浏览器 favicon：

```bash
mise exec -- pnpm icons
```

脚本是 `design/app-icon/build-icons.mjs`，也可直接运行 `node design/app-icon/build-icons.mjs`。需要项目已安装 pnpm 依赖、本机有系统自带的 `iconutil` 和 Homebrew 的 `/opt/homebrew/bin/resvg`（`brew install resvg`）。不增加 npm 依赖。

生成过程导出主图和小尺寸 SVG，用 resvg 渲染 PNG，再用 Tauri 生成跨平台文件、用 iconutil 组装含小尺寸版的 `.icns`。`src-tauri/icons/` 保持原来的 16 个文件：

- `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png`（512 px）
- `icon.icns`、`icon.ico`
- `Square30x30Logo.png`、`Square44x44Logo.png`、`Square71x71Logo.png`、`Square89x89Logo.png`、`Square107x107Logo.png`、`Square142x142Logo.png`、`Square150x150Logo.png`、`Square284x284Logo.png`、`Square310x310Logo.png`、`StoreLogo.png`

`src-tauri/tauri.conf.json` 的 `bundle.icon` 引用保持不变，macOS 使用 `icon.icns`。除了上述三个 `.icns` 档位和独立的 `32x32.png`，其它资源均从主图生成。Tauri 额外生成的移动端目录和 `64x64.png` 在临时目录中清理，不进入图标目录。重复运行不会改变生成物的内容。

`public/favicon.svg` 与定稿主图 SVG 内容相同，由同一脚本生成；`index.html` 引用它。`public/tauri.svg` 保留原样。

mdnotate 在 reorx-apps 网站上的图标是另一份文件（reorx-apps 仓库的 `src/content/apps/mdnotate/icon.svg`），换图标时要一起换。

## 相关文件

- `design/app-icon/icons.mjs`、`design/app-icon/export.mjs`、`design/app-icon/build-icons.mjs`
- `src-tauri/icons/`、`src-tauri/tauri.conf.json`（`bundle.icon`）
- `src/App.css` —— App 界面的琥珀色与橙色
