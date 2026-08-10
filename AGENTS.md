# mdnotate — Agent 参考卡

**Markdown Annotate**：Tauri v2 桌面应用，作为本地 `.md` 文件的默认打开方式，用于阅读 + 划词高亮/评论，最后按模板导出为 Markdown 引用块。**只读，不提供编辑功能。**

## 技术栈

Tauri v2 + React 19 + Vite 7 + TypeScript + Tailwind v4 + zustand。pnpm 管理依赖，Node 版本由 `mise.toml` 固定为 24。Markdown 渲染用 react-markdown + remark-gfm；标注用 `@recogito/text-annotator`（SPANS renderer）。

扁平单包结构（**不是** monorepo）。

## 目录结构

```
src/lib/          纯逻辑 + hook：annotations（数据模型与导出序列化）、
                  template（导出模板渲染）、toc（heading slug）、
                  use-text-annotator（recogito 封装）、settings、tauri-env、sample-doc
src/components/   Reader（Markdown + 目录 + 标注容器）、Toc、AnnotationPopup、
                  ExportView、SettingsView
src/store.ts      zustand 全局状态
src-tauri/src/    lib.rs（文件打开路由 + commands）、main.rs
tests/            vitest 行为测试，只覆盖 src/lib 的纯逻辑
kb/               知识库（sessions / plans / notes / docs …）
```

## 开发命令

```bash
pnpm tauri dev     # 运行应用
pnpm dev           # 只跑前端；浏览器里会加载内置示例文档（无 Tauri 后端时的降级）
pnpm test          # vitest
pnpm tauri build   # 产出 .app 与 .dmg
```

## 关键设计与约束

- **开发方法论**：新功能走 BDD（先写 `tests/` 下的行为测试再实现），bug 修复走 TDD。纯逻辑必须放在 `src/lib/` 并有测试覆盖；组件层不写单测。
- **文件打开路由**：macOS `RunEvent::Opened`、argv、single-instance 转发、窗口 DragDrop 四条路径全部收敛到 `lib.rs` 的 `open_path()`。Rust 侧存 `PendingOpen` 队列 + emit `open-file` 事件；前端必须**先注册 listener 再 drain pending**。single-instance 的 `argv[1]` 是相对路径，要用回调的 `cwd` 拼接。
- **文件关联**：`tauri.conf.json` 的 `bundle.fileAssociations` 与手写的 `src-tauri/Info.plist`（`CFBundleDocumentTypes`）共同生效。
- **recogito 约束**：必须 `renderer: 'SPANS'`；库在鼠标松开时立即创建 draft，未提交的 draft 要在选区移动/外部点击/dismiss 时删除；`popupRef` 与 `setPopup` 同步写入；弹窗需带 `not-annotatable` class。view 弹窗用 `[data-annotation]` overlay span 的 rect 定位。
- **标注数据模型**：highlight 与 comment 是同一结构，`comment === null` 即纯高亮；UI 区分，数据层不区分。锚点是渲染文本的字符偏移（`start`/`end` + `quote`）。
- **标注不持久化**：仅存在于内存，切换文件或关闭应用即清空。
- **排版**：`src/App.css` 的 `.prose-dense`，刻意紧凑（15px / 1.6 行高），追求信息密度而非留白。
- **浏览器降级**：`src/lib/tauri-env.ts` 的 `isTauri` 判断，让 UI 可以在纯浏览器里迭代（示例文档 / localStorage / navigator.clipboard）。

## 测试提示

agent-browser 用合成 PointerEvent 无法触发 recogito 选区；必须用真实 CDP 鼠标序列：`mouse move` → `mouse down` → 中间点 `mouse move` → 终点 `mouse move` → `mouse up`。

## 文档

- `kb/sessions/` — 历史 session 总结，了解某次改动的来龙去脉时查阅
