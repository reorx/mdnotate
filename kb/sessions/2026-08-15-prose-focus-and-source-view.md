---
created: 2026-08-15
tags:
  - reader
  - focus
  - keyboard-shortcut
  - recogito
  - status-bar
  - source-view
  - agent-browser
---

# 正文焦点与 ⌘A 收窄，正文底部状态栏与 Markdown 源码视图

## 概要

本次 session 做两件用户提出的优化：**① 点击正文后按 ⌘A 只选中正文，不再连侧栏一起选走**；**② 正文底部加一条状态栏**，显示字数与体积、提供复制原文按钮、提供一个眼睛按钮在渲染视图与 Markdown 源码视图之间切换（源码视图下标注功能整体失效）。

探查阶段发现第一项不只是"选区范围"的问题：`@recogito/text-annotator` **自己在 document 上绑了 `⌘+a` 热键**（`text-annotator.es.js` 里 `be = "⌘+a"`），回调会等下一个 `selectionchange` 再过 100ms，把整篇选区加成一条 annotation 并选中它——也就是说改动之前按一下 ⌘A，会弹出"要不要把整篇文档高亮"的 draft 弹窗。所以这次不是单纯收窄选区，而是必须把库的这个热键整个拿走。做法是在 **capture 阶段**监听 document keydown（库用 hotkeys-js 注册在冒泡阶段，capture 必然先跑），`stopImmediatePropagation()` 掐掉它，再自行 `preventDefault()` + 用 Range 圈住 `<article>`。

开工前就四个设计岔路问用户拍板，用户全选推荐项：**①「文字数量」取字符数**（复用既有 `countChars`，与标题栏信息浮层同口径）；**②源码视图是 Reader 的局部 state，换文档重置**，不进 settings；**③源码视图下两个侧栏照常显示但整体变灰且不可点**；**④阅读器在最上面时 ⌘A 一律选中正文**，不按焦点位置区别对待。

第二项的真正风险不在 UI 而在三处依赖于"渲染后 DOM"的缓存：⌘F 的搜索索引缓存的是**真实 DOM Text 节点**、TOC 的 heading id 是扫渲染结果打上去的、滚动 spy 每帧查 heading。切换视图时 `content` 没变但整棵 DOM 换了，这三处不跟着改就是静默 bug（尤其是"从源码视图切回来之后目录再也跳不动"）。三处都改了并逐一验证。

验收全部在浏览器模式（`pnpm dev` + agent-browser）自动完成，写了 5 个可重跑脚本；`tsc` / 322 个测试 / `vite build` 全绿。

## 修改的文件

### 新建

- `src/lib/use-select-all.ts` — ⌘A 的作用域。capture 阶段拦 document keydown；焦点在 input/textarea 里完全放行；`stopImmediatePropagation()` 无条件执行（掐库的热键），`preventDefault()` + 设选区只在阅读器位于最上面时执行
- `src/components/StatusBar.tsx` — 正文底部状态栏。左侧字数/体积（`useMemo` 按 content 缓存），右侧复制按钮（复用 `DocTitle` 那套 1.5s ✓ 反馈）与眼睛按钮；源码视图下多一句 "Annotations are off in source view" 提示；纯文本文档不渲染眼睛按钮

### 修改

- `src/lib/doc-info.ts` — 新增纯函数 `docStats(content)` → `{ chars, size }`，`docInfo()` 改为调它，字数与体积的口径一处定义
- `src/lib/use-doc-search.ts` — 选项 `content` 改名 `revision`：索引重置的判据从"内容变了"改为"屏幕上的文本被换掉了"。同步更新了那段解释"为什么 `revision` 不能进绘制 effect 依赖"的长注释
- `src/components/Reader.tsx` — `sourceView` 局部 state（`useEffect` 按 `docId` 重置）；annotator `enabled` 加 `&& !showingSource`；`articleRef` 挂到两个 `<article>` 分支；滚动容器加 `tabIndex={-1}` + `outline-none`；建 TOC 与滚动 spy 两个 effect 加 `showingSource` 依赖与短路；新增 `PanelContent` 包裹两个侧栏内容（`inert` + `opacity-50`）；挂上 `StatusBar` 与 `useSelectAll`
- `tests/doc-info.test.ts` — 先写的 `docStats` 行为测试（字符按 code point、体积按 UTF-8、千分位、空文档）
- `AGENTS.md` — 目录结构补 `use-select-all` / `doc-info` / `StatusBar`；关键设计与约束新增四条（⌘A、正文焦点、源码视图、状态栏）

## 注意事项

### capture 阶段是唯一能拿走库的快捷键的地方

`preventDefault()` 只取消默认行为，**不会**阻止同一事件的其它监听器。要让 recogito 的 `⌘+a` 回调根本不跑，只能 `stopImmediatePropagation()`；而它注册在 document 的冒泡阶段，所以我们必须在 capture 阶段。

两件事要分开决定：`stopImmediatePropagation()` **无条件**执行（即使 export / settings 盖着阅读器，背后也不该冒出一条整篇标注）；`preventDefault()` 只在阅读器位于最上面时执行，否则让原生 select all 在覆盖层里正常工作——背后的 Reader 挂着 `inert`，按规范不可被选中，所以原生行为正好只选覆盖层。

焦点在 input/textarea 时完全放行是安全的：hotkeys-js 的默认 filter 本来就跳过 INPUT/TEXTAREA/SELECT，库那边同样不会触发。

选区目标必须是 `<article>` 而不是 annotator 容器——后者还装着评论图标层和标注弹窗。

### 换掉渲染树时，三处 DOM 缓存必须一起失效

这是本次最容易漏的一类 bug，共同点是"缓存的东西是 DOM 节点或写在 DOM 上的属性，而缓存的判据是 content"：

1. `use-doc-search` 的 `segmentsRef` 存的是 `Text` 节点引用，切视图后全部指向已从文档中移除的节点；
2. TOC 的 heading id 是 effect 扫 `querySelectorAll('h1..h6')` 之后 `el.id = ...` 写上去的，切回渲染视图时 React 重建了 heading 元素，**新元素不带 id**，effect 不重跑就再也跳不动；
3. 滚动 spy 在源码视图下每次 heading 查找都落空，会把 TOC 第一条一直点亮。

判定索引是否真的重建，用"只在其中一个视图里存在的字符串"来测最干净：`## Getting` 在渲染视图 0/0、源码视图 1/1，`Highlight keeps`（源码里是 `**Highlight**`）正好相反。

### 侧栏"变灰且不可点"用 `inert`，不要逐个按钮加 disabled

`inert` 一个属性同时拿掉点击、hover 和 tab 顺序，与 `App.tsx` 盖住 Reader 时用的是同一个惯用法。关键细节：`inert` 连带的 `pointer-events` 穿透，所以套在 `<aside>` **里面**一层时，滚轮事件会落到 aside 上，侧栏自己仍然可以滚动。

### 源码视图直接复用 `.prose-plain`

"纯文本文档"和"Markdown 的源码"本来就是同一件事——按写出来的样子原样显示。所以 JSX 的分支条件写成 `format === 'markdown' && !showingSource`，两种情况共用一个 `<article className="prose-plain">` 分支，不需要三元嵌套。排版沿用当前文档 format 的设置（markdown 那套），这样切换时字号不跳。

### 浏览器模式的 localStorage 降级会跨测试轮次累积标注

调试时看到"一次划词却出现 3 条标注"，一度以为是切视图导致重复创建。实际是 `annotations-db.ts` 的浏览器降级把标注写进 localStorage，脚本跑三轮就攒了三条。**验收脚本开头应先 `localStorage.clear()`**。清空后重跑，全流程标注数恒为 1。

顺带一个观察：`document.querySelectorAll('[data-annotation]').length` 不能当标注总数用——recogito 的 SPANS renderer 只画视口内的，滚走了就是 0。要读数量应该看标注面板表头或导出按钮的徽标。

### agent-browser 的两个坑

- `find role button --name "X"` 是**子串匹配**：`--name "Highlight"` 会匹配到目录里的 "Highlighting" 条目并点它，直接把标注 draft 点没了。需要精确定位时改用 eval 取 `getBoundingClientRect()` 再走 `mouse move/down/up`。
- headless Chromium 没有 Edit 菜单，**原生 ⌘A select all 不会发生**，所以"覆盖层下 ⌘A 选中覆盖层"这半条在浏览器模式验不了，只能验到"库不会偷偷建整篇标注"。

### 验收产物

`tmp/2026-08-14-statusbar-source-view/` — 10 张截图（含深色模式、640px 窄窗、导出覆盖层下按 ⌘A）与 5 个可重跑脚本（`verify-source-view.sh` 走完整轮回、`verify-search-index.sh` 验索引重建、`verify-statusbar.sh` 验复制/覆盖层/深色、`verify-narrow.sh` 验窄窗不挤掉按钮、`bisect-duplicate.sh` 逐步定位标注数变化）。

## 遗留问题

- **⌘A 之后库内部仍留着一个"待提交选区"**：此时右键会把它提交成整篇高亮。没有对抗库——这与"鼠标划一段再右键"是同一条既有路径，且比改动前（⌘A 直接弹整篇 draft）严格更好。真要根治得靠 `setAnnotatingEnabled(false)` 前后夹一个 setTimeout，是靠时序赌运气的写法，不值得。
- **真实 Tauri 窗口未验**：窗口驱动不了、截图被 TCC 挡死，UI 只能人眼过。需要确认的三点：点正文后空格能否翻页、⌘A 的实际选区、深色下状态栏那条上边框。
- **切换视图时滚动位置不做映射**：两种视图内容高度差很多，切过去会落在一个无意义的位置。要做得靠"当前视口顶部对应源码第几行"的双向映射，成本不小。
- **源码视图用的是 markdown 那套排版设置**：刻意的（切换时字号不跳），但源码是等宽字体，理论上更适合 plain 那套的行高。若日后觉得别扭，改一行即可。
- **`AnnotationList` / `Toc` 的点击回调没有加 `showingSource` 短路**：完全依赖 `inert` 生效。若某天在不支持 `inert` 的环境里跑，点击会走进 `setActiveId` / `setPickedAnnotationId` 把条目点亮（但不会跳转，因为 querySelector 落空、annotator 已销毁）。属于纯视觉退化。
