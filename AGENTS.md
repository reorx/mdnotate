# mdnotate — Agent 参考卡

**Markdown Annotate**：Tauri v2 桌面应用，作为本地 `.md` 文件的默认打开方式，用于阅读 + 划词高亮/评论，最后按模板导出为 Markdown 引用块。**只读，不提供编辑功能。**

## 技术栈

Tauri v2 + React 19 + Vite 7 + TypeScript + Tailwind v4 + zustand。pnpm 管理依赖，Node 版本由 `mise.toml` 固定为 24。Markdown 渲染用 react-markdown + remark-gfm；标注用 `@recogito/text-annotator`（SPANS renderer）。

扁平单包结构（**不是** monorepo）。

## 目录结构

```
src/lib/          纯逻辑 + hook：annotations（数据模型、失效判定与导出序列化）、
                  template（导出模板渲染）、toc（heading slug）、
                  recent-docs（文档模型 + 剪切板标题/预览等纯规则）、
                  db（共享 SQLite 连接）、recents-db、annotations-db（两张表的 IO）、
                  open-doc（打开文档的唯一入口）、annotate（改动标注的唯一入口）、
                  path-input（手输/粘贴路径的归一化规则）、
                  clipboard、use-text-annotator（recogito 封装）、settings、
                  default-app、tauri-env、sample-doc
src/components/   Home（首页）、OpenFileCard、ClipboardCard、RecentList、DefaultAppCard、
                  ActionCard（首页三张卡片共用的壳 + CardNote/CardButton）、
                  Reader（Markdown + 目录 + 标注容器）、Toc、AnnotationPopup、
                  ExportView、SettingsView
src/store.ts      zustand 全局状态
src-tauri/src/    lib.rs（文件打开路由 + commands + SQLite migration）、
                  default_app.rs（LaunchServices FFI）、main.rs
tests/            vitest 行为测试，只覆盖 src/lib 的纯逻辑
kb/               知识库（sessions / plans / notes / docs …）
```

## 开发命令

```bash
pnpm tauri dev     # 运行应用
pnpm dev           # 只跑前端；无 Tauri 后端时的降级（Recent 走 localStorage，
                   #   首页有 DEV-only 的「Open the sample document」入口）
pnpm test          # vitest
pnpm tauri build   # 产出 .app 与 .dmg
```

## 关键设计与约束

- **开发方法论**：新功能走 BDD（先写 `tests/` 下的行为测试再实现），bug 修复走 TDD。纯逻辑必须放在 `src/lib/` 并有测试覆盖；组件层不写单测。
- **文件打开路由**：macOS `RunEvent::Opened`、argv、single-instance 转发、窗口 DragDrop 四条路径全部收敛到 `lib.rs` 的 `open_path()`。Rust 侧存 `PendingOpen` 队列 + emit `open-file` 事件；前端必须**先注册 listener 再 drain pending**。single-instance 的 `argv[1]` 是相对路径，要用回调的 `cwd` 拼接。
- **文件关联**：`tauri.conf.json` 的 `bundle.fileAssociations` 与手写的 `src-tauri/Info.plist`（`CFBundleDocumentTypes`）共同生效。
- **默认 App 状态**：空状态界面的 `DefaultAppCard` 显示 mdnotate 是否为 `.md` 默认打开方式。Rust 侧 `default_app.rs` 直接 FFI 调 LaunchServices（`LSCopyDefaultRoleHandlerForContentType` / `LSSetDefaultRoleHandlerForContentType` / `LSCopyApplicationURLsForBundleIdentifier`），UTI 用 `net.daringfireball.markdown`（`.md` 与 `.markdown` 都归它）。**关键：设置是异步且需用户确认的**——macOS 自己弹「Use "mdnotate" / Keep "X"」对话框，LS 调用立刻返回 `noErr` 且此时读回来仍是旧 handler（对不存在的 bundle id 也返回 `noErr`）。所以前端点完按钮进入 `awaiting`，轮询 `markdown_default_app_status` 等结果，超时才提示走 Finder ⌘I。macOS 26 上验证：未确认前无论新旧 API（`NSWorkspace.setDefaultApplication` 也一样）都不会改动关联。
- **默认 App 的 dev 限制**：`tauri dev` 跑的是未打包二进制，`app_registered` 取决于系统里是否已注册过某个 mdnotate.app；要完整验证需 `pnpm tauri build` 后运行 .app。浏览器模式下 `default-app.ts` 有 DEV-only stub 便于调 UI。
- **recogito 约束**：必须 `renderer: 'SPANS'`；库在鼠标松开时立即创建 draft，未提交的 draft 要在选区移动/外部点击/dismiss 时删除；`popupRef` 与 `setPopup` 同步写入；弹窗需带 `not-annotatable` class。view 弹窗用 `[data-annotation]` overlay span 的 rect 定位。
- **标注数据模型**：highlight 与 comment 是同一结构，`comment === null` 即纯高亮；UI 区分，数据层不区分。锚点是渲染文本的字符偏移（`start`/`end` + `quote`）。
- **打开文档的唯一入口**：`src/lib/open-doc.ts`。文件关联 / 对话框 / 拖拽 / 剪切板 / Recent / DEV sample 全部走它，保证「打开」与「记入 Recent」不会脱节。它写 store 在前、写库在后 —— 数据库出问题不该拦住阅读。**唯一的例外是读标注**：标注必须随文档一起进 store（见下），所以 `open()` 会先 await 它，但读失败只是裸开文档 + banner，绝不把文档挡在门外。
- **文档模型 `OpenDoc`**：`id`（同时是 recogito 的 documentKey 和 Recent 主键）/ `kind` / `title`（标题栏）/ `source`（导出模板 `{{filePath}}` 的值：文件是全路径，剪切板是派生标题）/ `content` / `contentHash`。取代了原来一人分饰三角的 `filePath`。入口只构造 `NewDoc`，`contentHash` 由 `open-doc` 统一盖章。
- **Recent 与 SQLite**：`tauri-plugin-sql`，库文件 `sqlite:mdnotate.db`（`~/Library/Application Support/<identifier>/`），schema 由 `lib.rs` 的 `migrations()` 声明，前端 `Database.load` 时执行。**去重规则编码在 `id` 里** —— 文件是 `file:<绝对路径>`，剪切板是 `clip:<内容 hash>` —— 所以两种类型共用一条 `ON CONFLICT(id) DO UPDATE` upsert。上限 50 条，插入后按 `opened_at` 裁剪。剪切板正文存在 `body` 列（文件不存，重开时从磁盘重读）；列表查询不 select `body`。
- **`sql:allow-execute` 不在 `sql:default` 里**，capabilities 必须单独加，漏了要到第一次写入才报错。
- **migration 的 SQL 文本是被 checksum 的**：sqlx 对每条已应用的 migration 存 sha384，源码里改动 SQL 字符串（**包括缩进**）会让 `Database.load` 直接失败，整个前端从此读不到库。所以 `migrations()` 里旧条目的字符串是冻结的，只能往后追加新 version。`src/lib/db.ts` 是唯一的连接（`Database.load` 每次调用都会新开一个 pool，且 migration 只在首次 load 跑）。
- **剪切板探测**：没有剪切板变化事件，`ClipboardCard` 在挂载时和 window focus 时各读一次（focus 正是用户从别处复制完回来的时刻）。读不到与空剪切板等同处理。内容必须**多于 `MIN_CLIPBOARD_CHARS`（200）字符**才算可读文档（`describeClipboard` 返回 `too-short`，按钮禁用、不显示预览）——复制一个词/一条 URL 不该点亮卡片。
- **路径输入框**：`OpenFileCard` 里除了系统对话框还有一个手输/粘贴绝对路径的入口。路径永远不按空格切分，只 trim 两端；`path-input.ts` 负责把各种"方言"归一：终端拖拽的 `\ ` 转义、外层单/双引号（引号内的反斜杠按 shell 语义保持字面）、`file://` URL（百分号解码，坏转义原样保留）。`~` 由 `expandHome` 单独处理，只有真的以 `~` 开头时才去 IPC 问 `homeDir()`。非绝对路径在提交时就地报错，不进 `openFilePath`。
- **标注持久化**：`annotations` 表，`doc_id` 外键指向 `recent_docs.id` 且 `ON DELETE CASCADE`（sqlx 默认开 `PRAGMA foreign_keys`，级联真的会触发）。**代价是 Recent 的 50 条裁剪会连带销毁标注**，这是明确选择的行为。改标注走 `src/lib/annotate.ts` 这一个漏斗：先写 store 后写库，写库失败只出 banner。写入用 `ON CONFLICT(id) DO UPDATE` 只更新 comment/updated_at —— quote 与偏移在提交那一刻就固定了。
- **标注失效判定**：每条标注存一份创建时的 `doc_hash`（`hashText(content)`）。偏移是渲染文本的字符偏移，文件在外部被改过就会全部错位，而 recogito 的 `reviveTextSelector` 只按偏移数文本节点、**不校验 quote**，会静默高亮到错的句子。所以打开时 hash 不匹配的直接删除并提示丢弃条数（纯规则在 `annotations.ts` 的 `splitStaleAnnotations`，有测试）。剪切板文档的 id 本身就是内容 hash，天然永远匹配。
- **标注必须与文档同时进 store**：`use-text-annotator` 只在 effect 创建时 `setAnnotations` 一次（deps 只有 `enabled`/`documentKey`），异步晚到的标注不会被渲染，所以 `openDoc(doc, annotations)` 是一次性写入的。
- **排版**：`src/App.css` 的 `.prose-dense`，刻意紧凑（15px / 1.6 行高），追求信息密度而非留白。
- **浏览器降级**：`src/lib/tauri-env.ts` 的 `isTauri` 判断，让 UI 可以在纯浏览器里迭代（示例文档 / localStorage / navigator.clipboard）。

## 发布

push `v*` tag 触发 `.github/workflows/release.yml`：macOS runner 构建 universal dmg，Developer ID 签名 + 公证 + staple（Tauri CLI 根据 `APPLE_CERTIFICATE` / `APPLE_API_KEY` 等环境变量自动完成），发布到本仓库 GitHub Release。tag 必须与 `tauri.conf.json` 的 `version` 一致（workflow 会校验）。workflow_dispatch 手动触发只出 artifact 不发 release。签名凭据 secrets 命名与 vocalflow-mac 一致，源文件在 `~/Sync/apple-developer/`；签名背景知识见 `../vocalflow-mac/kb/notes/2026-08-10-macos-developer-id-signing-guide.md`。

## 测试提示

agent-browser 用合成 PointerEvent 无法触发 recogito 选区；必须用真实 CDP 鼠标序列：`mouse move` → `mouse down` → 中间点 `mouse move` → 终点 `mouse move` → `mouse up`。

浏览器模式下 `navigator.clipboard.readText()` 会被权限拒绝，剪切板 UI 恒显示 empty；调 UI 时用 `eval` 覆盖 `navigator.clipboard` 再 `dispatchEvent(new FocusEvent('focus'))` 触发重读。

Tauri 窗口没法用 agent-browser 驱动（不开 CDP）；`screencapture` 与 System Events 还可能被 TCC 挡住（截图全黑 / AX 报 0 窗口）。验证 Rust + SQLite 侧改用：`pnpm tauri dev` 起实例 → 用 `target/debug/mdnotate <file.md>` 触发 single-instance 转发 → `sqlite3` 直接查库断言。注意路径会被 `canonicalize`，`/tmp/x.md` 落库是 `file:/private/tmp/x.md`。

前端不碰库时先怀疑 `Database.load` 挂了（连接 promise 被 memo，一次失败之后全线静默）。判断办法：`lsof -p <pid> | grep mdnotate.db` 看有没有句柄，`_sqlx_migrations` 看版本停在哪。要模拟应用侧写入，用 `tmp/doc-hash.mjs <file>` 算出真实的 docId / contentHash 再 seed 行。

## 文档

- `kb/sessions/` — 历史 session 总结，了解某次改动的来龙去脉时查阅
