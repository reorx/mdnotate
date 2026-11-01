---
created: 2026-11-01
tags:
  - reader
  - obsidian
  - images
---

# 显示 Obsidian 图片嵌入，支持 JPG 与 WebP

## PRD

### 背景与目标

用户用 mdnotate 阅读 Obsidian 笔记时，希望直接看到 `![[image.jpg|xxx]]` 引用的图片，包括 WebP 图片，无需改写笔记。支持图片位于笔记旁边、相对路径或 Obsidian 仓库附件目录的情况。

### 语法与图片查找

- `![[image.jpg]]`、`![[image.webp]]` 显示对应图片。
- `![[image.jpg|xxx]]` 中的文字用作替代文本；`|300` 指定宽度，`|300x200` 指定宽高。图片不撑破正文列。
- 优先使用明确路径和笔记附近的图片；在 Obsidian 仓库内，也能查找附件目录中的图片。存在无法唯一确定的同名图片时给出提示，不随机挑选。
- 标准 Markdown 图片继续工作，并共用本地图片加载能力。
- 原始内容、源码视图、编辑和复制保持原文；代码块、行内代码中的嵌入示例保持文字。

### 异常情况与范围边界

- 找不到图片、无法读取、格式损坏或同名歧义时，显示可理解的提示，其他正文照常阅读。
- 本次针对本地笔记及其仓库附件，不扩展 SSH 附件读取或给剪切板文档猜测本地目录；这些来源遇到本地嵌入时说明无法定位。
- 不实现笔记嵌入、PDF/音视频嵌入或完整 Obsidian 链接系统。
- 图片加载状态变化不能使标注错位；旧渲染方式下的标注须经既有兼容或失效处理，不能静默高亮到错误位置。

### 验收标准

1. 本地 JPG、WebP 用有无后缀的 Obsidian 语法均能实际解码显示。
2. 宽度、宽高、文字后缀正确；窄窗口内无页面横向溢出。
3. 相对路径、带空格或中文的文件名、仓库附件目录均可用；同名歧义不会显示错误图片。
4. 标准 Markdown 图片可用，代码示例、源码、编辑与复制不被改写。
5. 缺失和损坏图片的错误不会阻断正文或改变可标注文本偏移。
6. 切换文档不会串图，图片前后新建标注可在重开后恢复，旧标注不会错位。

## Tech Design

### 现状

- `src/components/Reader.tsx` 用 `ReactMarkdown`、`remarkGfm`、`rehypeListNumbers` 渲染正文，当前自定义组件只有表格容器，没有图片解析或加载层。正文先拆 Front Matter，再经 `convertBoxTables`。
- `src/lib/recent-docs.ts` 的 `OpenDoc` 提供 `kind`、`source`、`contentHash`；本地文档的 source 是路径，SSH 与剪切板不能作为本地基准目录。
- `src-tauri/src/lib.rs` 的 `read_local_file` 仅读取 UTF-8 文本。`src-tauri/tauri.conf.json` 没有启用 asset protocol，`src-tauri/Cargo.toml` 的 tauri features 为空；不能直接把磁盘路径放进 img src 并期待 WebView 读取。
- `annotationContentHash` 当前拼接 Front Matter 和列表编号版本；`preListNumbersHash` 用于旧列表编号标注迁移。`src/lib/open-doc.ts` 在打开时生成哈希，`src/lib/edit-session.ts` 在保存时生成哈希，Reader 会触发旧列表标注迁移。
- `tests/list-numbers.test.tsx` 已有通过真实 Markdown 管线测试渲染逻辑的先例，无需新增组件单测。

### 方案

将语法识别、磁盘图片定位、图片加载展示分开。纯语法和路径规则各自可测，Reader 只接入插件与图片组件。采用有限范围的 Rust 读取 command 加浏览器 Blob URL，避免给整个磁盘开放 asset protocol，也避免 WebP 被按文本读取或错误标成 JPEG。

**语法处理**：新增 `src/lib/obsidian-images.ts`（拟建），提供插件与纯解析规则。仅将支持的图片嵌入转换成 image 节点，保留原始路径、替代文本和尺寸信息；至少覆盖 jpg/jpeg/png/gif/webp，大小写不敏感。不得对全文做无上下文正则替换。实现时先验证 remark 文本节点方案对转义、文件名下划线和 GFM 表格中的竖线是否保真；不保真就使用语法扩展，不能靠破坏代码、链接或表格规避。只增加实际需要的直接依赖，用 pnpm add。普通双链和非图片嵌入保持原样。

**查找规则**：新增 `src-tauri/src/images.rs`（拟建）。笔记目录向上找到最近含 `.obsidian` 目录的祖先作为仓库根；无仓库则只处理明确路径和笔记相对路径。优先匹配笔记相对的确切文件，其次仓库根相对的确切文件；只对 Obsidian 图片嵌入做仓库查找，按完整路径后缀匹配，裸文件名按 basename 匹配。唯一命中可用，多命中返回明确歧义。排除 `.obsidian`、`.git`、不跟随目录符号链接，避免循环和无限扫描。无需读取 Obsidian 配置文件：有限仓库搜索覆盖附件目录。标准 Markdown 图片不额外猜测仓库路径。

**读取与展示**：在 `lib.rs` 注册异步图片 command，阻塞文件扫描放到 blocking task，不占 UI 线程。以来源文档路径和图片引用为输入，验证文件类型及读取大小上限（建议 25 MiB），返回匹配 MIME 的二进制内容，优先使用 Tauri 二进制 response，类型或状态信息必要时独立返回。仅读取支持的图片，不将任意文件内容送进 WebView。新增前端加载模块和小型图片组件（拟建 `src/lib/doc-image.ts`、`src/components/DocImage.tsx`），建立并及时 revoke Blob URL；文档切换、卸载、请求竞态不得导致串图。对同一文档重复引用去重，仓库查找避免每张图片重复全量遍历；缓存生命周期限于文档加载，刷新后可重新发现文件。

组件承接普通 Markdown 和转换后的 Obsidian image 节点，按 doc.kind 决定本地加载或远程 URL；保持 react-markdown 的 URL 安全限制，不全局放行任意 scheme。HTTP(S) 图片保持原行为，SSH/剪切板的相对图片显示定位不可用。错误提示和加载占位统一带 `not-annotatable`，尺寸属性及缩放不插入可标注文字。样式沿用现有正文与主题规则；宽高指定时图片不超出正文列。

### 数据与兼容

- 不修改原文、docId、数据库表或已发布 migration。
- 对可能包含图片嵌入的 Markdown 添加 `:obsidian-images-v1` 渲染后缀，检测逻辑与识别规则尽量共用；普通 Markdown 和纯文本保持原哈希。若使用保守候选检测，明确记录代码示例文档可能被额外失效的限制，并优先采用准确检测。
- 后缀放在现有列表版本之后，使新图片布局不被 `preListNumbersHash` 误识别成可以只迁移编号的布局。旧图片语法对应标注走既有失效提示；没有图片的旧列表迁移维持原行为。测试覆盖打开与保存两条哈希路径及组合 Front Matter 情况。
- 不在图片加载成功或失败时改变可标注文本；否则网络和磁盘状态都会影响锚点。

### 实施步骤

- [x] 阅读 AGENTS.md 和相关模块注释；修改前阅读 `kb/docs/reader-ui.md`、`annotations-and-export.md`、`theme-and-typography.md`、`opening-documents.md`、`verification.md`。需要操作桌面时遵守全局桌面验收说明。
- [x] 先写 TypeScript 行为测试：语法、尺寸、转义、代码排除、标准 Markdown 共存、哈希兼容；确认失败再实现插件与纯规则。
- [x] 先写 Rust 图片解析与读取测试：临时仓库夹具、附件目录、查找优先级、歧义、缺失、WebP MIME/字节、大小限制与符号链接；确认失败再实现 command。
- [x] 接入图片组件和 Reader，覆盖 Blob URL 生命周期与过期请求规则；不要为了方便更改原文或开放全盘资源协议。
- [x] 跑针对性测试后跑前端完整测试及构建、app Rust 测试；进行浏览器及 Tauri 图片显示验收。
- [x] 更新本计划勾选状态、`kb/docs/reader-ui.md`、`kb/docs/annotations-and-export.md` 和 AGENTS.md 必要的路由/不变量说明，记录验收结果。
- [x] 清理本次测试资源，在当前分支提交代码和计划、文档为同一提交；不创建分支或 worktree，不发布、不推送。

### 测试与验证

1. 语法行为测试通过真实 Markdown 渲染管线，覆盖 JPG/WebP、文字与尺寸后缀、多个嵌入、段落/列表/GFM 表格、中文和空格文件名、转义、行内与围栏代码、标准图片、非图片双链。表格中的竖线按 GFM 转义写法验证。
2. Rust 单测用真正图片字节和临时文件系统验证 MIME 与定位规则；损坏图片在展示端验证错误提示，不能只断言 HTML 中存在 img。
3. 哈希与标注回归覆盖图片前后文本、Front Matter、列表编号及纯文本，保证旧图片布局不能进入仅迁移编号的分支。
4. 运行 `mise exec -- pnpm test`、`mise exec -- pnpm build`；按项目要求先构建 CLI 与 dist，再运行 `cargo test --manifest-path src-tauri/Cargo.toml`，不使用 `--workspace`。不主动跑 formatter/linter。
5. 实机验收前执行 `agent-inspect-session.sh`，context 超过 40% 时按项目规定通过 Herdr 新 tab 验收（优先 astra）。浏览器验语法、缩放、错误、实际 JPG/WebP 解码（naturalWidth > 0）；浏览器 mock 不能作为本地 Tauri 通路成功的证据。
6. Tauri dev 打开真实临时仓库中的笔记，确认相邻 JPG、附件目录 WebP、中文路径、损坏/缺失/歧义和切换文档。通过 agent-desktop 操作前读其 desktop/platform skills 及 `~/.claude/docs/DESKTOP_APP_TESTING.md`；若权限阻挡，准确报告哪些项目未实测，不声称已完成端到端验证。
7. 图片前后建立标注、重新打开并检查；加载失败提示不进入标注和搜索正文。截图归档到 `tmp/2026-11-01-obsidian-images/` 并在结果中给出路径。只清理本次创建的进程和 browser 会话，按项目说明执行适当范围的 mac-dev-cleanup。

### 风险与待定

- WKWebView 对 WebP 的实际解码依赖系统版本；不能仅凭扩展名或 Chromium 测试判定 macOS 上可用，验收记录实际系统和结果。
- remark 在插件阶段可能已处理转义和强调，语法识别方案需先用测试确定；若使用陌生依赖，按项目要求查 Context7。
- 大仓库全盘搜索开销与重复引用需在实现中控制，但不引入持久化索引或新的设置面板。
- 旧图片嵌入由文字变图片会改变偏移，接受既有失效机制；不要让列表迁移错误保留这些偏移。

执行方式：用户已确认包含仓库附件查找；计划完成后用 Herdr 新 tab、Codex 默认模型在当前目录和当前分支实施。

## 实施与验收结果（2026-11-01）

- 使用 micromark inline construct + mdast image 节点，真实 Markdown 管线通过了下划线、中文/空格、转义、代码、列表与 GFM 表格测试；未对原文做正则替换。Context7 在本会话没有可用工具，接口依据已安装依赖的类型与源码确认。
- 新增批量定位 command 与二进制读取 command：每批只扫描一次最近仓库，笔记附近、仓库根的确切路径优先，再做唯一后缀匹配；忽略 `.git` / `.obsidian`，不跟随扫描中的符号链接，扫描上限 100000 条目录项，图片读取上限 25 MiB，校验扩展名与文件签名。
- 文档加载期间复用请求和规范化图片路径，刷新/换文档重建 session；Blob MIME 与格式对应，过期结果不会发布，离开文档统一回收 URL。
- 前端全量 482 测试通过；TypeScript + Vite 构建通过（仍有大 chunk 提示）；先构建 CLI 与 dist 后 app Rust 52 测试通过。未运行 formatter 或 lint。
- 浏览器：JPG/WebP 均实际解码，naturalWidth=64；300x200 尺寸正确，600px 窗口下等比缩小无横向溢出，标准图片正常，错误提示不进入 collectAnnotatableText。宽窄窗口的可标注文本完全一致。
- Tauri：macOS 26.7.1 (25G241)，通过真实临时 Obsidian 仓库验证相邻 JPG、附件目录 WebP、中文/空格路径、标准图片、损坏/缺失/歧义提示。通过 ⌘O 在同一窗口切换另一文档后再打开，图片及两条高亮正确恢复；SQLite 验证两条标注的 quote/偏移与渲染版本。注入一条旧图片布局哈希的测试标注后重开，确认仅该条被删除并出现失效提示。
- 实机工具最初遇到 AX 不可见与 CoreGraphics 无 display，wake-screen 后恢复，截图与鼠标划词已实际完成，没有因此遗留的实机未验证项。模拟请求完成顺序的竞态由单测覆盖。
- 600px 且两侧栏全开时图片仍在正文列内缩放；验收同时发现既有顶栏标题和 Edit 重叠，已单独记录到 kb/known-issues.md，未扩展本次改动范围。
- 截图与验收脚本归档：`tmp/2026-11-01-obsidian-images/`（gitignore）；主要截图：browser-wide.png、browser-narrow.png、tauri-images.png、tauri-other.png、tauri-annotations-reopened.png、tauri-narrow.png、tauri-legacy-discard.png。
