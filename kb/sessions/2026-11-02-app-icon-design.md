---
created: 2026-11-02
tags:
  - design
  - app-icon
---

# 设计 mdnotate 的 App 图标并归档源文件

## 概要

mdnotate 发布出去的一直是 Tauri 的默认图标，reorx-apps 网站上用的是一张深蓝底的占位图。这次出了两轮方案，做成可比较的 artifact 页面（https://claude.ai/artifact/6dE7cc2iz1m38kJ2A8MHWH，私有）：每个方案都有大图、64 / 32 / 16 px 显示效果、16 px 原像素放大，还能切换放进浅色 / 深色 Dock（两边是用户已上线的 flotify、gaplesspaste、vocalflow、txtrr 等）和“打开方式”菜单里看。

参考了三样东西：mdnotate 的功能（读、划线、评论、导出引用块）、用户已上线 App 图标的手感、App 界面里的琥珀色。用户中途明确：Forge 品牌对单个 App 只是浅参考，不必套品牌色和造型。

第一轮五个方向：A 纸页荧光笔、B 引用符 `>`、C 批注页（页面 + 气泡剪影，蓝底）、D 套印 `#`、E 划词。用户的反馈：D 留作备选并再出一个替代版；A 和 C 继续；C 的蓝色不要，A 的配色最能代表 mdnotate。第二轮出了 C 结构配 A 颜色的三种配色（纸底橙页、暖橙底纸页、纸底墨页）、放大了页边气泡的 A2、用引号代替 `#` 的 D2。用户最终选 A2，只保留 C 和 D 的原版作为备选，其余不进项目。

图标应用到 App（生成 `src-tauri/icons/`）按用户要求不在本 session 做，交给 Codex 在新的 Herdr tab 里完成。

## 修改的文件

- `design/app-icon/icons.mjs`：新建。用代码画定稿 A2 和备选 C、D 的 SVG，共用 Apple 图标模板的主体、投影和裁切。
- `design/app-icon/export.mjs`：新建。把 icons.mjs 里的图导出成 SVG。
- `design/app-icon/mdnotate.svg`、`design/app-icon/alternatives/page-bubble.svg`、`design/app-icon/alternatives/riso-hash.svg`：导出结果。
- `kb/docs/app-icon.md`：新建。图标画的是什么、颜色来源、网格与小尺寸、源文件、备选和没留下的方向。
- `AGENTS.md`：目录结构加 `design/app-icon/`，文档索引加 `kb/docs/app-icon.md`。

## 注意事项

- 本机用 Homebrew 的 `resvg` 把 SVG 渲染成 PNG，`magick` 拼对比图。归档前把三个 SVG 重新渲染成 256 px，和评审时的图逐像素比对，差异为 0。
- 浅色图标在浅色 Dock 上要靠 `rgba(0,0,0,.07)` 的细描边和投影撑轮廓。
- 小尺寸判断要看原像素：浏览器里把 SVG 缩到 16 px 会按 Retina 渲染，比 .icns 里真实的 16 px 清楚得多。对比页用 resvg 出的 16 px PNG 放大四倍看。
- 对比页的源文件和两轮所有方案的生成脚本在 `tmp/2026-11-02-app-icon/`（不进仓库）。

## 遗留问题

- `src-tauri/icons/` 仍是 Tauri 默认图标，由 Codex 在新 tab 里从 `design/app-icon/mdnotate.svg` 生成并验证；完成后要更新 `kb/docs/app-icon.md` 的“应用到 App”一节。
- 16 / 32 px 的简化版还没画，建议和应用图标一起做。
- reorx-apps 网站上的 mdnotate 图标和 accent 色（`#24364d`）还是旧占位，属于另一个仓库，等 App 图标落地后再换。

## 相关文档

- [App 图标](../docs/app-icon.md) —— 本次 session 新建
