---
created: 2026-08-10
tags:
  - tauri
  - react
  - markdown
  - annotation
  - bootstrap
---

# 从零搭建 mdnotate：Tauri Markdown 阅读与标注应用

## 概要

本次 session 从空目录开始搭建 mdnotate（Markdown Annotate）——一个作为本地 `.md` 文件默认打开方式的 Tauri 桌面应用，用于阅读 Markdown 并对选中文字做高亮 + 评论，最后按可配置模板导出为 Markdown 引用块。

起点是两个参考项目：`../writer-computer`（Tauri v2 + React 的 Markdown 编辑器，借鉴其项目结构与文件关联/打开路由方案）和 `../vibe-reader-hn`（最近实现了划词高亮与评论，借鉴其基于 `@recogito/text-annotator` 的标注实现）。先并行派出两个 Explore agent 摸清两边的实现细节，再据此设计 mdnotate 的架构：不照搬 writer-computer 的 pnpm monorepo 与 vite-plus 工具链，简化为扁平单包 + 标准 pnpm/vite；标注部分则几乎完整移植 vibe-reader-hn 的 `use-text-annotator` hook（含其踩过的坑：必须用 SPANS renderer、draft 生命周期管理、`popupRef` 同步写入）。

开发按 CLAUDE.md 的 BDD 要求进行：先为三个纯逻辑模块（annotations / template / toc）写 21 个 vitest 行为测试，再实现到测试全绿。随后实现 Rust 端的文件打开路由与 React UI，最后用原生应用 + agent-browser 双路验证，过程中发现并修复了 3 个 bug（详见"注意事项"）。最终产出可运行的 `.app` 与 `.dmg`，全流程（打开文件 → 划词高亮/评论 → 改模板 → 导出复制 → 删除标注 → 目录跳转与滚动高亮）均实测通过。

## 修改的文件

### 配置与脚手架

- `package.json` — 由 `create-tauri-app` 脚手架改名为 `mdnotate`，加 `test` 脚本；依赖加 react-markdown、remark-gfm、@recogito/text-annotator、zustand、lucide-react、tailwindcss v4、tauri 的 dialog/store/clipboard 插件
- `mise.toml` — `mise use node@24` 生成，固定 Node 版本
- `vite.config.ts` — 加 `@tailwindcss/vite` 插件与内联 vitest 配置（`environment: node`，只跑 `tests/**/*.test.ts`）
- `tsconfig.json` — target/lib 由 ES2020 提到 ES2022（`String.replaceAll` 需要）
- `index.html` — 标题改为 mdnotate
- `README.md` — 重写为项目说明（功能、开发命令、目录结构）
- `.gitignore` — 追加 `tmp/`、`src-tauri/gen/`

### Rust 端

- `src-tauri/tauri.conf.json` — productName/identifier、窗口 1080x800 且 `label: "main"`、`bundle.fileAssociations` 注册 md/markdown
- `src-tauri/Info.plist` — 新建，`CFBundleDocumentTypes` 声明 md/markdown 为 Viewer、`LSHandlerRank: Default`（tauri.conf 的 fileAssociations 会自动 merge 此文件）
- `src-tauri/Cargo.toml` — crate 改名 mdnotate/mdnotate_lib，加 dialog、store、clipboard-manager、single-instance 四个插件
- `src-tauri/src/lib.rs` — 核心：`PendingOpen` 状态、`resolve_markdown_path` 路径解析、`open_path` 统一入口，四条打开路径（macOS `RunEvent::Opened`、非 macOS argv、single-instance 转发、窗口 DragDrop）全部收敛到它；两个 command：`read_markdown_file`、`take_pending_file`
- `src-tauri/src/main.rs` — 改调用 `mdnotate_lib::run()`
- `src-tauri/capabilities/default.json` — 加 dialog/store/clipboard 权限

### 前端核心逻辑（先写测试后实现）

- `tests/annotations.test.ts` / `tests/template.test.ts` / `tests/toc.test.ts` — 21 个行为测试
- `src/lib/annotations.ts` — `Annotation` 类型（highlight 即 `comment === null` 的 annotation）、recogito 双向转换、不可变列表操作、`annotationsToMarkdown` 导出序列化
- `src/lib/template.ts` — `DEFAULT_TEMPLATE` 与 `renderTemplate`（`{{filePath}}` / `{{annotations}}`）
- `src/lib/toc.ts` — `slugify`（保留 Unicode 字母，支持中文标题）与 `buildToc`（重名标题加数字后缀去重）
- `src/lib/use-text-annotator.ts` — 移植自 vibe-reader-hn 的标注 hook，加了 `documentKey` 参数（换文件时重建 annotator）和 `positionForView`（用高亮 overlay span 定位 view 弹窗）
- `src/lib/settings.ts` — 模板持久化，Tauri 下走 plugin-store，浏览器下降级到 localStorage
- `src/lib/tauri-env.ts` / `src/lib/sample-doc.ts` — 新建，浏览器开发模式的环境判断与示例文档

### 前端 UI

- `src/store.ts` — zustand store（filePath / content / view / sidebarOpen / annotations / template）
- `src/App.tsx` — 重写：顶栏（目录开关、打开文件、Export Annotation、设置）、三视图切换、启动时先注册 `open-file` 监听再 drain pending file
- `src/App.css` — 重写：Tailwind v4 import + `.prose-dense` 紧凑阅读排版
- `src/components/Reader.tsx` — Markdown 渲染 + 目录侧边栏 + 标注容器，DOM 派生的 heading id 与 scroll-spy
- `src/components/Toc.tsx` — 目录列表，按 level 缩进，当前项高亮
- `src/components/AnnotationPopup.tsx` — draft 态（Highlight / Comment）与 view 态（评论展示 + 编辑 + 删除）
- `src/components/ExportView.tsx` — 模板渲染结果只读文本框 + 复制按钮
- `src/components/SettingsView.tsx` — 模板编辑、保存、重置

## 注意事项

### 文件打开路由必须收敛到单一 resolver

macOS 上一个文件可能通过四条路径进来：Finder 双击（`RunEvent::Opened`）、命令行 argv、second instance 转发、窗口拖放。它们的时序完全不同——`RunEvent::Opened` 在冷启动时可能早于 webview 创建。解法是 Rust 侧维护一个 `PendingOpen` 队列，同时 emit `open-file` 事件；前端**先注册 listener 再 drain pending**，避免两者之间到达的事件丢失。这是从 writer-computer 学来的 pattern（它做得更彻底，是 per-window 队列）。

### recogito 标注的几个硬性约束

- 必须用 `renderer: 'SPANS'`，不能用 `CSS_HIGHLIGHTS`——后者每次重绘调用 `CSS.highlights.clear()`，多实例会互相擦除
- 库在**鼠标松开时立即创建** annotation（draft），用户还没确认。必须在选区移动、外部 pointerdown（capture 阶段）、dismiss 三处删除未提交的 draft
- `popupRef` 要与 `setPopup` **同步写入**，否则 action 内部触发的 `cancelSelected()` 会读到过期 draft 并删掉刚提交的标注
- 弹窗要加 `not-annotatable` class，否则点击弹窗本身会被选区处理器捕获

### 三个实测发现的 bug

1. **single-instance 相对路径**：转发过来的 `argv[1]` 是相对第二实例 cwd 的，直接当路径用会读不到文件。必须用回调传入的 `cwd` 拼接。
2. **view 弹窗定位落到 (0,0)**：点击已有高亮时 `clickAnnotation` 的坐标未必可用（合成事件、或事件顺序问题）。改为查询 SPANS renderer 渲染的 `[data-annotation="<id>"]` overlay span 的 rect 来定位，点击坐标只作 fallback。
3. **scroll-spy 末尾失效**：最后几个 heading 永远无法滚到视口顶部，导致点击目录跳转后高亮不跟随。加了"滚到底则激活最后一项"的修正；但必须同时判断 `scrollHeight > clientHeight`，否则短文档（不滚动）会一直误激活最后一项。

### 测试与验证方法

- agent-browser 无法用合成 PointerEvent 驱动 recogito 的选区处理器（库依赖真实事件顺序）。有效方式是 `mouse move` → `mouse down` → 中间点 `mouse move` → 终点 `mouse move` → `mouse up` 的真实 CDP 拖拽。
- 为了能在浏览器里开发调试 UI，加了 `isTauri` 判断：无后端时加载内置示例文档、剪贴板走 `navigator.clipboard`、设置走 localStorage。这让 UI 迭代不必每次编译 Rust。

## 遗留问题

- **标注不持久化**：关闭应用或切换文件即清空。按需求"导出即目的"这是可接受的，但数据结构（字符偏移 + quote）已经支持持久化，后续若要"重开文件恢复标注"，加一层按文件路径 key 的存储即可（vibe-reader-hn 是存进 IndexedDB 的 history record）。
- **标注锚点脆弱**：`start`/`end` 是渲染文本的字符偏移，文件内容一旦变化就会错位。没有做 fuzzy 匹配回退。
- **无 dark mode**：目前只有浅色主题。
- **应用未签名**：`tauri build` 产出的 `.app`/`.dmg` 没有 code signing 与 notarization，分发给他人需要手动绕过 Gatekeeper。
- **只支持单文件、单窗口**：没有目录浏览，也没有 writer-computer 那样的多窗口 per-window 状态。
