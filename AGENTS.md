# mdnotate — Agent 参考卡

**Markdown Annotate**：Tauri v2 桌面应用，作为本地 `.md` 文件的默认打开方式，用于阅读 + 划词高亮/评论，最后按模板导出为 Markdown 引用块。也能通过 `mdnotate://` 链接打开、以及经 ssh 读取远端机器上的文件。**只读，不提供编辑功能。**

## 技术栈

Tauri v2 + React 19 + Vite 7 + TypeScript + Tailwind v4 + zustand。pnpm 管理依赖，Node 版本由 `mise.toml` 固定为 24。Markdown 渲染用 react-markdown + remark-gfm；标注用 `@recogito/text-annotator`（SPANS renderer）。

扁平单包结构（**不是** monorepo）。

## 目录结构

```
src/lib/          纯逻辑 + hook：annotations（数据模型、失效判定与导出序列化）、
                  annotation-markers（评论图标的落点几何，纯规则）、
                  template（导出模板渲染）、typography（阅读排版模型与校验）、toc（heading slug）、
                  recent-docs（文档模型 + 剪切板标题/预览等纯规则）、
                  db（共享 SQLite 连接）、recents-db、annotations-db（两张表的 IO）、
                  open-doc（打开文档的唯一入口）、annotate（改动标注的唯一入口）、
                  window-doc（本窗口装着哪个文档，向 Rust 汇报 + 写窗口标题）、
                  path-input（手输/粘贴路径的归一化规则）、
                  doc-locator（本地/ssh/链接的语法与格式判定，纯逻辑）、
                  clipboard、use-text-annotator（recogito 封装）、settings、theme（偏好解析与落地）、
                  default-app、tauri-env、sample-doc
src/components/   Home（首页）、OpenFileCard、ClipboardCard、RecentList、DefaultAppCard、
                  ActionCard（首页三张卡片共用的壳 + CardNote/CardButton）、
                  Reader（Markdown + 目录 + 标注容器）、Toc、AnnotationList、AnnotationPopup、
                  CommentMarkers（正文里的评论图标层）、ExportView、SettingsView
src/store.ts      zustand 全局状态
src-tauri/src/    lib.rs（文件打开路由 + 多窗口路由 + commands + SQLite migration，
                  含 choose_target 的 #[cfg(test)] 单测）、
                  default_app.rs（LaunchServices FFI）、main.rs
tests/            vitest 行为测试，只覆盖 src/lib 的纯逻辑
                  （Rust 侧的纯规则用 cargo test，见 lib.rs / default_app.rs）
kb/               知识库（sessions / plans / notes / docs …）
```

## 开发命令

```bash
pnpm tauri dev     # 运行应用
pnpm dev           # 只跑前端；无 Tauri 后端时的降级（Recent 走 localStorage，
                   #   首页有 DEV-only 的「Open the sample document」入口）
pnpm test          # vitest
pnpm tauri build   # 产出 .app 与 .dmg（无签名凭据时是 ad-hoc 产物，只能原地运行）
pnpm build:signed  # scripts/build-signed.sh：构建 + Developer ID 签名 + 公证 + staple，
                   #   凭据读 ~/Sync/apple-developer/secrets.env，产物可安装进 /Applications
```

- ⚠️ **不要把 `pnpm tauri build` 的未签名产物拷进 /Applications**：它只有 linker-signed 的 ad-hoc 签名（resources 没有 seal，`codesign --verify` 必挂），macOS 会静默取消它作为文档 handler 的资格 —— 症状是 app 内显示已是 .md 默认应用、Finder 双击却打开别的 app，且「打开方式」选择器里 mdnotate 灰掉不可选；还会顶掉 brew 装的签名版。本地验证打包产物直接 `open src-tauri/target/release/bundle/macos/mdnotate.app`；要装进 /Applications 用 `pnpm build:signed` 的产物或 `brew reinstall --cask mdnotate`。

## 关键设计与约束

- **开发方法论**：新功能走 BDD（先写 `tests/` 下的行为测试再实现），bug 修复走 TDD。纯逻辑必须放在 `src/lib/` 并有测试覆盖；组件层不写单测。
- **文件打开路由**：macOS `RunEvent::Opened`、argv、single-instance 转发、窗口 DragDrop 四条路径全部收敛到 `lib.rs` 的 `open_spec()`，由它决定**去哪个窗口**（见下条）。送达有两条腿：webview 还没起来的窗口只能把 spec 留在它自己的 `pending` 槽里等它来取，已经起来的直接 `emit_to`（**不是 `emit`** —— 广播会让每个窗口都换文档）。前端必须**先注册 listener 再 drain pending**（`take_pending_doc`），而 drain 这个动作同时就是「我在听了」的登记，两件事在同一把锁里完成，所以不存在「刚放进槽、窗口已经取完」的缝。single-instance 的 `argv[1]` 是相对路径，要用回调的 `cwd` 拼接。**事件载荷不是纯路径，而是 `doc-locator` 能读的 spec**：绝对路径、`host:path`、或整条 `mdnotate://` 链接。
- **一个文档一个窗口**：外部打开（Finder 双击 / `open` / 链接 / argv）遵循三条规则，纯逻辑是 `choose_target()`，有 `cargo test` 覆盖：**①已经开着这个文档的窗口 → 送回那个窗口**（两个窗口读同一文档会往同一批标注行里各写各的，互相看不见对方，这是必须避掉的数据打架）；**②还停在首页的空窗口 → 就地填进去**；**③否则开新窗口**，label `doc-N`（`main` 来自 config，N 从 1 递增且不复用），位置从最前面那个窗口 `+28px` 级联，撞到工作区边缘就回到左上角重来。拖拽是例外：丢在哪个窗口就在哪个窗口开（规则①仍优先）。窗口内的入口（Recent / 对话框 / 路径框 / 剪切板）一律原地替换，否则窗口只增不减。
- **再次打开 = 刷新**：规则①送回去的是完整的一次打开，不是单纯聚焦 —— 文件会重读，所以在别处编辑过的文档双击一下就能看到新内容（代价是滚动位置回到顶部，且内容真变了的话旧标注按既有的 `doc_hash` 规则被丢弃并提示）。正因为「已开着」和「空窗口」两条最后做的是同一件事，`Target` 只有 `Deliver` 和 `Spawn` 两个分支，没有单独的 `Focus`。
- **多窗口的三个必配套项**：① `capabilities/default.json` 的 `"windows"` 必须写成 `["main", "doc-*"]`（支持 glob），漏了新窗口就是**零权限**——SQL、对话框、`setTheme`/`setTitle` 全部静默失效；② `core:window:allow-set-title` 和 `allow-set-theme` 一样**不在 `core:default` 里**（`core:window:default` 只有只读那批）；③ 窗口关闭时 `WindowEvent::Destroyed` 要把注册表条目删掉，否则它会永远替一个没人在读的文档占位。
- **窗口状态注册表**：Rust 侧 `Windows(Mutex<HashMap<label, WindowEntry>>)` 记录每个窗口装着哪个 docId、是否已被占用、webview 是否在听、以及待取的 spec —— **一把锁盖住全部四项是有意的**，拆成两把就会出现「窗口在决策中途起来了、文档被放进它已经取空的槽里」。前端这边是 `lib/window-doc.ts` 的 `announceDoc()`：读 store 里当前的 doc，汇报 docId 给 Rust 并把窗口标题设成文档名（标题栏是 Overlay 隐藏的，但 ⌘\` 切换和 Mission Control 靠它区分窗口）。它在 `open()` 成功后调一次，另一处是 `openLocator` 的 `catch`——**失败路径必须回报**：窗口在路由的那一刻就被乐观地标成「装着这个文档」了，读失败若不纠正，再打开同一个文档就只会聚焦这个根本没打开成功的窗口。（写在 `catch` 不是 `finally`：成功时 `open()` 已经报过，放 `finally` 会让每次正常打开都多一次 IPC + `setTitle`。）
- **Rust 侧只认得本地文件的 docId**：`file_doc_id()` 是 `src/lib/recent-docs.ts` 里 `fileDocId` 的第二份实现（`file:<canonical>`），和扩展名列表属于同一类无法避免的跨语言重复。链接和 `host:path` 的语法只在 `doc-locator` 里，Rust 不解析，所以**它们算不出 docId、也就享受不到规则①**：同一个远端文档用链接开两次会得到两个窗口。这是明确接受的取舍。
- **冷启动的文档比窗口来得早**：Tauri 的 config 窗口是在它自己的 `setup()` 里建的，而 `setup()` 挂在 `RuntimeRunEvent::Ready` 上；macOS 双击文档启动 app 时 `application:openURLs:` **先于** Ready 到达。所以早到的文档不能当场路由（那时 `webview_windows()` 是空的，会开一个新窗口，然后 config 窗口再空着弹出来 —— 实测过的 bug），要先攒在 `ColdStart` 缓冲里，等 `.setup()`（Tauri 建完窗口才调）再逐个 `open_spec`。缓冲用 `Mutex<Option<Vec<_>>>`：`Some` 即「还在启动中」，标志位和缓冲区是同一个东西。
- **多窗口下没有同步的两件事**：设置/主题改动只作用于当前窗口（各窗口 store 独立，重启后一致）；A 窗口打开文档不会刷新 B 窗口的 Recent 列表。数据库并发写没问题（sqlx 默认 WAL + 5s busy_timeout），每个 webview 各有一个连接池。
- **URL scheme**：`mdnotate://open?path=<spec>`。**路径必须走 query 参数**——macOS 的 `application:openURLs:`（tao `app_delegate.rs`）会先把每条 URL 喂给 `url::Url::parse`，解析不了的直接丢弃且毫无提示，而 `mdnotate://host:path/…` 正是解析不了的那种（authority 里的 `:Sync` 被当成端口）。链接里的 `&` 和 `#` 必须写成 `%26` / `%23`，否则 query 被截断；`doc-locator` 检测到多余的 query key 或 fragment 会明确报错而不是打开半截路径。Rust 侧**不解析链接**，原样转发给前端，语法只在 `doc-locator` 里实现一次、测一次。
- **ssh 远端文件**：spec 用 scp 写法 `host:path`（`host` 是 `~/.ssh/config` 里的 alias，冒号后相对于远端 home，`host:/abs` 才是绝对路径）。判定规则只有一条：**第一个 `/` 之前有没有冒号**——所以 `/notes/2026:08:11.md` 仍是本地文件。读取是 `lib.rs` 的 `read_remote_file`，直接 `/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 <host> cat -- '<quoted>'`：白捡整个 ssh 配置（alias / Include / ProxyJump / ControlMaster 复用），代价是必须自己做 shell 单引号转义。**这个 command 必须是 `#[tauri::command(async)]`**，普通同步 command 跑在主线程上，10 秒的 ConnectTimeout 会把窗口冻住。stdout 按 8MB 封顶读取，超了要 `kill()` 子进程——只停止读取会让 `cat` 卡在写满的管道上，`wait()` 跟着死锁。退出码 255 是 ssh 自己连不上（提示去终端跑一次 `ssh <host>`），其它退出码是远端 `cat` 的错误。
- **ssh 的认证前提**：GUI 启动的 app 拿不到 shell 环境，但 macOS 的 launchd 会给每个进程注入 `SSH_AUTH_SOCK`，且用户 config 里的 `ControlMaster auto` + `ControlPersist yes` 让已有的 master socket 直接复用——已验证：`open mdnotate://…` 冷启动能读到远端文件。没有 agent 身份也没有 master socket 时 `BatchMode` 会立刻失败（不是挂起），这是有意的。
- **文件关联与 scheme 注册**：`tauri.conf.json` 的 `bundle.fileAssociations` 与手写的 `src-tauri/Info.plist` 共同生效——`CFBundleDocumentTypes` 管 `.md` 关联，`CFBundleURLTypes` 管 `mdnotate://` scheme。两者都只在打包后的 .app 里生效。document type 是**两条**：一条按 `LSItemContentTypes`（daringfireball UTI）claim，一条只按 `CFBundleTypeExtensions` claim——macOS 规则是条目里有 `LSItemContentTypes` 就忽略同条目的扩展名列表，而 `.md` 的 UTI 绑定是机器相关的（见下条），缺了扩展名那条 mdnotate 会在别的 UTI 赢得绑定的机器上从 Finder「打开方式」选择器里灰掉。
- **可打开的格式**：`.md/.markdown/.mdown/.mkd` 按 Markdown 渲染；`.txt/.text/.log/.json/.yaml/.yml/.toml/.ini/.conf/.csv/.tsv` 以纯文本原样显示（`Reader` 的 `.prose-plain`，等宽 + `pre-wrap`，标注照常可用，目录显示「No headings」）；其余一律在联网之前就拒绝。扩展名列表在 `doc-locator.ts`（有测试）和 `lib.rs` 各一份——后者是 DragDrop 在前端看到文件之前就要筛选，属于无法避免的重复，改动要同步。文件关联仍然只注册 `.md/.markdown`，不去抢 `.txt`。
- **默认 App 状态**：空状态界面的 `DefaultAppCard` 显示 mdnotate 是否为 `.md` 默认打开方式。Rust 侧 `default_app.rs` 直接 FFI 调 LaunchServices（`LSCopyDefaultRoleHandlerForContentType` / `LSSetDefaultRoleHandlerForContentType` / `LSCopyApplicationURLsForBundleIdentifier`）。**UTI 不能硬编码**：`.md` 实际映射到哪个 UTI 是机器相关的——iA Writer / Typora 这类编辑器会**导出**自己的 markdown UTI（`net.ia.markdown` / `io.typora.markdown`）并可能赢得扩展名绑定，把默认 handler 设在 `net.daringfireball.markdown` 名下就会「读回来显示已是默认、Finder 双击却打开别人」（`mdls` 的 kMDItemContentType 是 Spotlight 缓存，可能显示旧绑定，别信它）。所以 `markdown_utis()` 用 `UTTypeCreatePreferredIdentifierForTag` 逐台机器解析 `.md`/`.markdown` 当前绑定的 UTI，设置时全部写入，`is_default` 要求全部指向自己。**关键：设置是异步且需用户确认的**——macOS 自己弹「Use "mdnotate" / Keep "X"」对话框，LS 调用立刻返回 `noErr` 且此时读回来仍是旧 handler（对不存在的 bundle id 也返回 `noErr`）。所以前端点完按钮进入 `awaiting`，轮询 `markdown_default_app_status` 等结果，超时才提示走 Finder ⌘I。macOS 26 上验证：未确认前无论新旧 API（`NSWorkspace.setDefaultApplication` 也一样）都不会改动关联。
- **默认 App 的 dev 限制**：`tauri dev` 跑的是未打包二进制，`app_registered` 取决于系统里是否已注册过某个 mdnotate.app；要完整验证需 `pnpm tauri build` 后运行 .app。浏览器模式下 `default-app.ts` 有 DEV-only stub 便于调 UI。
- **拖拽窗口不能靠 tauri 自带的 `data-tauri-drag-region`**：macOS 26 (Tahoe) 上顶栏拖不动窗口，与「文件名居中」那次改动无关。tauri 的链路是 `drag.js` → **async** 的 `start_dragging` command → 事件循环 user message → tao 的 `drag_window`，跑到最后一步时 `NSApp.currentEvent` 已经变成 LeftMouseDragged，而 Tahoe 的 `performWindowDragWithEvent:` 对非「活的 LeftMouseDown」直接静默忽略（旧系统容忍过期事件，所以以前能拖）。替代方案是 `lib.rs` 的 `start_window_drag` + `lib/window-drag.ts`：**这个 command 必须是同步的**（同步 command 跑在主线程、mousedown 还在分发中），在光标当前位置合成一个新的 LeftMouseDown 再交给 `performWindowDragWithEvent:`；前端在 **capture 阶段**监听 mousedown，否则会被 drag.js 的 `stopImmediatePropagation` 饿死。双击不拦，留给 drag.js 变成最大化。`data-tauri-drag-region` 属性保留，现在由我们自己读。
- **视图切换是覆盖而不是替换**：export / settings / home 以 `absolute inset-0` 的不透明层盖在 Reader 之上（`App.tsx` 的 `overlay`），**Reader 从不卸载** —— 否则回到文档时 scroll position、annotator 实例、渲染好的 markdown 全部从头再来（原来的三元切换正是这个 bug）。两个配套细节缺一不可：Reader 根节点的 `relative z-0` 建一个层叠上下文，不然 z-20 的标注弹窗会浮在覆盖层之上；被盖住时挂 `inert`（React 19 支持布尔属性），把整棵子树移出 tab 顺序和读屏。
- **三栏布局不许横向滚动**：Reader 根节点必须带 `min-w-0` —— 它是外层 flex 的 item，`min-width: auto` 会让整行按「两侧栏 + 正文最长不可断行内容」的 min-content 撑开，整个窗口跟着横向溢出（曾经的 bug）。侧栏宽度存在 `settings.panels`（`lib/panels.ts` 管默认值与 clamp，160–480px），分隔线（`Reader` 的 `PanelResizeHandle`）就是拖拽手柄：拖动时写 store、松手才落盘，双击重置默认。侧栏另有 `max-w-[40%]` 上限，窗口再窄正文也至少留 20%。正文滚动容器是 `overflow-x-hidden`，超宽内容一律自己内部滚动 —— `pre` 本来就是，表格靠 ReactMarkdown 的 `components.table` 包一层 `overflow-x-auto`（只包 div 不动文本节点，标注偏移不受影响）。
- **标注侧栏**：右侧的 `AnnotationList`，默认隐藏，`addAnnotation` 时自动打开（store 的 `annotationsOpen`），toolbar 最右的 `PanelRight` 是开关。条目按文档顺序 —— store 里的 annotations 本来就是排好序的，不要在组件里再排一次。点击用 recogito 的 `scrollIntoView(id, 滚动容器)` 跳转，**滚动容器要显式传**，库自己是从 annotator 容器往上找第一个真的在滚动的祖先。哪一条算 active 由两个来源合成：面板里点了谁、文本里打开了哪个 view 弹窗，后者优先（点高亮时 marker 要跟着走）。条目的引用文字恒定带琥珀底（`amber-100`），active 的那条加深到 `amber-200` + 左侧 `amber-500` 竖条 + 整条 `amber-50` 底 —— 加深这一下和 `highlightStyle()` 里 selected 提高不透明度是同一个动作。有评论的条目在评论行首带同一个图标，**不放引用行末尾**：引用是 `line-clamp-3`，被截断时行尾的东西会跟着被裁掉。
- **弹窗只有一种编辑态**：点已有高亮直接进评论输入框（没有只读态），底部左边 Delete、右边 Cancel / Save；Enter 保存、Shift+Enter 换行、Esc 与点外部一律**丢弃**改动（和 draft 的行为对齐，`dismissPopup` 是两种 kind 共用的出口）。保存空串 = 退回纯高亮。新划的选区仍先给 Highlight / Comment 两个按钮。
- **正文里的评论图标是自己画的**：`CommentMarkers` 是 annotator 容器内独立的一层，**不能塞进库的高亮层** —— 那层每次重画都 `innerHTML = ''` 整个重建，而且整层带 `mix-blend-mode`，图标的颜色会被混掉。同步靠 `anno.renderer.on('onRedraw')`（公开 API，滚动 / resize / 状态变化后都会发），位置从 `[data-annotation]` span 的 rect 现算，落点规则在 `annotation-markers.ts`（最下面那行的最右端，有测试）。两个必配套项：① `onRedraw` 每个滚动帧都发，所以 setState 前必须过 `sameMarkers` 比一次，否则滚动全程重渲染；② 加/删评论不移动任何矩形，光靠 `onRedraw` 的时序不保险，另挂一个 `annotations` 变化的 effect 兜底。图标层必须带 `not-annotatable`：库的 pointerup 里有一条「target 在 `.not-annotatable` 内就直接返回、不清空选区」，靠它点图标才能 `setSelected(id)` 把弹窗开起来。
- **recogito 约束**：必须 `renderer: 'SPANS'`；库在鼠标松开时立即创建 draft，未提交的 draft 要在选区移动/外部点击/dismiss 时删除；`popupRef` 与 `setPopup` 同步写入；弹窗需带 `not-annotatable` class。view 弹窗用 `[data-annotation]` overlay span 的 rect 定位。`setSelected(id)` 走的是同一条 `selectionChanged`，所以程序化打开弹窗和点高亮是同一条路径。
- **标注数据模型**：highlight 与 comment 是同一结构，`comment === null` 即纯高亮；UI 区分，数据层不区分。锚点是渲染文本的字符偏移（`start`/`end` + `quote`）。
- **打开文档的唯一入口**：`src/lib/open-doc.ts`。文件关联 / 链接 / 对话框 / 拖拽 / 剪切板 / Recent / DEV sample 全部走它，保证「打开」与「记入 Recent」不会脱节。它写 store 在前、写库在后 —— 数据库出问题不该拦住阅读。**唯一的例外是读标注**：标注必须随文档一起进 store（见下），所以 `open()` 会先 await 它，但读失败只是裸开文档 + banner，绝不把文档挡在门外。从字符串进来的一律走 `openSpec()`（unwrap 链接 → 按需 `homeDir()` → `parseLocator` → `openLocator`）。**慢的那次不许盖掉快的那次**：每个公开入口先在 `createLatest()`（`lib/latest.ts`，有测试）领一张号再去取内容，`open()` 写 store 前验号，过期的直接丢弃 —— 否则点了一个 ssh 文档（最长 10 秒 ConnectTimeout）又改点一个本地文档时，姗姗来迟的那个会把屏幕换回你已经不要的内容。号是 module 级的，而 module 级即窗口级。
- **本地路径以「真身」为准**：`read_local_file` 除内容外还返回 `canonicalize()` 后的路径，`openLocator` 用它来算 id 和 source。否则 `/tmp/a.md` 与 `/private/tmp/a.md` 会变成两条 Recent、两套标注 —— OS 递过来的路径本来就是 canonical 的，链接和输入框里的不是。
- **文档模型 `OpenDoc`**：`id`（同时是 recogito 的 documentKey 和 Recent 主键）/ `kind`（`file` / `ssh` / `clipboard`）/ `title`（标题栏）/ `source`（导出模板 `{{filePath}}` 的值：本地是全路径，远端是 `host:path`，剪切板是派生标题）/ `content` / `format` / `contentHash`。取代了原来一人分饰三角的 `filePath`。入口只构造 `NewDoc`，`contentHash` 由 `open-doc` 统一盖章。
- **Recent 与 SQLite**：`tauri-plugin-sql`，库文件 `sqlite:mdnotate.db`（`~/Library/Application Support/<identifier>/`），schema 由 `lib.rs` 的 `migrations()` 声明，前端 `Database.load` 时执行。**去重规则编码在 `id` 里** —— 本地文件是 `file:<绝对路径>`，远端是 `ssh:<host>:<path>`（host 必须进 id：两台机器上的同一路径是两个文档），剪切板是 `clip:<内容 hash>` —— 所以三种类型共用一条 `ON CONFLICT(id) DO UPDATE` upsert。上限 50 条，插入后按 `opened_at` 裁剪。剪切板正文存在 `body` 列；**远端文件和本地文件一样不存 body**，每次打开都重新拉取（内容变了 `contentHash` 对不上，旧标注按既有规则丢弃），所以离线读不了。列表查询不 select `body`。
- **`sql:allow-execute` 不在 `sql:default` 里**，capabilities 必须单独加，漏了要到第一次写入才报错。
- **migration 的 SQL 文本是被 checksum 的**：sqlx 对每条已应用的 migration 存 sha384，源码里改动 SQL 字符串（**包括缩进**）会让 `Database.load` 直接失败，整个前端从此读不到库。所以 `migrations()` 里旧条目的字符串是冻结的，只能往后追加新 version。`src/lib/db.ts` 是唯一的连接（`Database.load` 每次调用都会新开一个 pool，且 migration 只在首次 load 跑）。
- **剪切板探测**：没有剪切板变化事件，`ClipboardCard` 在挂载时和 window focus 时各读一次（focus 正是用户从别处复制完回来的时刻）。读不到与空剪切板等同处理。内容必须**多于 `MIN_CLIPBOARD_CHARS`（200）字符**才算可读文档（`describeClipboard` 返回 `too-short`，按钮禁用、不显示预览）——复制一个词/一条 URL 不该点亮卡片。
- **路径输入框**：`OpenFileCard` 里除了系统对话框还有一个手输/粘贴的入口，接受绝对路径、`host:path` 和整条 `mdnotate://` 链接。路径永远不按空格切分，只 trim 两端；**`path-input.ts` 只负责脱掉"方言"外衣**：终端拖拽的 `\ ` 转义、外层单/双引号（引号内的反斜杠按 shell 语义保持字面）、`file://` URL（百分号解码，坏转义原样保留）；`mdnotate://` 链接原样放行，交给 `doc-locator` 按 URL 语义解码。**它意味着什么则全在 `doc-locator.ts`**——原先的 `pathInputError` 已并入 `parseLocator`，不要再造第二个校验器。`~` 仍由 `expandHome` 处理，`needsHome()` 决定要不要花一次 IPC 去问 `homeDir()`；远端路径里的 `~/` 是被剥掉而不是展开的（路径进远端 shell 前会被单引号包住，`~` 不会展开）。
- **标注持久化**：`annotations` 表，`doc_id` 外键指向 `recent_docs.id` 且 `ON DELETE CASCADE`（sqlx 默认开 `PRAGMA foreign_keys`，级联真的会触发）。**代价是 Recent 的 50 条裁剪会连带销毁标注**，这是明确选择的行为。改标注走 `src/lib/annotate.ts` 这一个漏斗：先写 store 后写库，写库失败只出 banner。写入用 `ON CONFLICT(id) DO UPDATE` 只更新 comment/updated_at —— quote 与偏移在提交那一刻就固定了。
- **标注失效判定**：每条标注存一份创建时的 `doc_hash`（`hashText(content)`）。偏移是渲染文本的字符偏移，文件在外部被改过就会全部错位，而 recogito 的 `reviveTextSelector` 只按偏移数文本节点、**不校验 quote**，会静默高亮到错的句子。所以打开时 hash 不匹配的直接删除并提示丢弃条数（纯规则在 `annotations.ts` 的 `splitStaleAnnotations`，有测试）。剪切板文档的 id 本身就是内容 hash，天然永远匹配。
- **标注必须与文档同时进 store**：`use-text-annotator` 只在 effect 创建时 `setAnnotations` 一次（deps 只有 `enabled`/`documentKey`），异步晚到的标注不会被渲染，所以 `openDoc(doc, annotations)` 是一次性写入的。
- **排版**：`src/App.css` 的 `.prose-dense`，默认刻意紧凑（15px / 1.6 行高），追求信息密度而非留白。字号 / 行高 / 栏宽三项可在设置页调，**Markdown 与纯文本各存一套**（key 就是 `DocFormat`，设置页两个 tab，打开设置时默认停在当前文档的那一套）。传导链路只有一条：`typography.ts` 的 `typographyVars()` → 三个 `--prose-*` 自定义属性 → Reader 的滚动容器 inline style（设置页的预览块用同一个函数，所见即所得）。**默认值只写在 `DEFAULT_TYPOGRAPHY` 一处，CSS 里不留第二份**，所以 `.prose-dense` / `.prose-plain` / `.prose-column` 用的是不带 fallback 的 `var()` —— 新增渲染 prose 的地方必须挂在一个提供了这三个变量的节点下。`.prose-dense` 内部全是 `em`，动根字号整套层级自动等比缩放；`pre` 的行高是 `calc(var(--prose-line-height) - 0.1)`，当初刻意的是那 0.1 的差，不是绝对值。栏宽单位是 rem（不随字号联动），滑块最右一格越界即 `'full'`（`widthFromSlider`），左右 `px-8` 内边距恒定不参与调节。
- **设置的读写**：`settings.ts` 是通用 kv —— `loadSettings()` / `saveSettings(patch)`，底层一个 key 一个 entry（plugin-store，浏览器降级 localStorage 存 JSON），加新设置项不会重写旧的。读回来一律过 `mergeSettings` 逐字段校验（typography 走 `clampTypography`，越界值 clamp、坏类型退默认、按 step 精度取整）：**手改坏 settings.json 不该让阅读器打不开**。store 里对应的是整个 `settings` 对象 + `updateSettings(patch)`。排版滑块是即时生效 + 防抖 200ms 落盘，`SettingsView` 卸载时会 flush 未落盘的改动，否则「拖完立刻点 Back」会丢最后一次。
- **深色模式靠反转调色板，不靠 `dark:` 变体**：Tailwind v4 的颜色都编译成 `var(--color-*)`，所以 `App.css` 的 `.dark` 块重新定义整条 `neutral-*` 阶梯就一次性翻转了全部约 130 处颜色 class，组件的 className **一处没改**。成立的前提是本项目把 neutral 当作一条严格的「离页面底色多远」的阶梯用（50 侧栏 / 100 hover / 200-300 边框 / 400-500 弱文字 / 700-800 强文字）——新写组件用同一套阶梯就自动有深色，**不要**再去补 `dark:`。三类例外：① `bg-white` 既是页面底也是琥珀按钮上的 `text-white`，`--color-white` 动不得，所以拆出 `bg-page`（页面底 + 内凹的输入框）和 `bg-raised`（浮在上面的弹窗 / 选中的分段）两个 `@theme` token；② `amber-50/100/200`、`red-50/200` 是底色，`amber-700`/`red-700` 是它们上面的字，深色下两头对调；③ 只做纯前景的（amber-400/500/600、white）原样不动 —— 想在深浅两色下都成立的淡色前景写 `amber-500/30` 这种带透明度的，**不要**去借 `amber-200` 这类会被翻转的档位（评论图标的填充就是这么来的）。`.prose-*` 的颜色则全部抽成 `:root` 里的 `--prose-*` 变量，`.dark` 给第二套。唯一用到 `dark:` 的地方是 disabled 按钮的不透明度：同一个 40% 压得住白底、压不住近黑的底。
- **主题的三处副作用**：`lib/theme.ts` 是唯一出口 —— `<html>` 上的 `.dark` class（驱动样式表）、`color-scheme`（驱动样式表够不着的滚动条 / 光标 / range 轨道）、以及 Tauri 的 `getCurrentWindow().setTheme()`（驱动原生右键菜单、文本选择菜单、traffic light；`null` 才是「跟随系统」）。**`core:window:allow-set-theme` 不在 `core:default` 里**，和 `sql:allow-execute` 同一类坑。`setTheme('dark')` 会连带把 webview 的 `prefers-color-scheme` 也改成 dark，但只有 `preference === 'system'` 时才去读那个 query，而那时 `setTheme(null)` 正让它跟随系统，所以不会自锁。
- **主题必须在第一帧就对**：真正的设置在异步 IPC 后面，所以 `theme` 额外在 `localStorage` 存一份同步可读的镜像，`main.tsx` 在 React 渲染前就 `applyTheme()`，消除冷启动闪白。**代价是 store 的初始 `settings.theme` 必须从这份缓存种子（而不是 `DEFAULT_SETTINGS`）**：同步主题的 effect 会把当前值写回缓存，若它带着默认值 `system` 先跑一轮，就会在 `loadSettings()` 读到之前把真实偏好覆盖掉 —— 浏览器模式下缓存就是存储，偏好会被永久抹掉。缓存的 key 和 JSON 编码与 `settings.ts` 的浏览器降级完全一致，两条路径写的是同一个东西（有测试锁住）。
- **深色下的高亮**：recogito 的高亮层是 `mix-blend-mode: multiply`，在深色底上等于隐形（暗乘暗只会更暗），`.dark` 里必须换成 `screen`；不透明度也要跟着提（`highlightStyle()`）。改样式用 `anno.setStyle()` 热更新（内部会 `redraw(true)`），**不要**因为主题变了去重建 annotator —— 那会丢掉草稿和选区。库还全局注入了一条 18% 蓝的 `::selection`，深色下几乎看不见，也在 `.dark` 里盖掉了。
- **浏览器降级**：`src/lib/tauri-env.ts` 的 `isTauri` 判断，让 UI 可以在纯浏览器里迭代（示例文档 / localStorage / navigator.clipboard）。**深色模式的验收可以走这条路**：`pnpm dev` + agent-browser，`agent-browser set media dark|light` 直接模拟系统偏好（headless Chrome 默认就是 dark）。

## 发布

push `v*` tag 触发 `.github/workflows/release.yml`：macOS runner 构建 universal dmg，Developer ID 签名 + 公证 + staple（Tauri CLI 根据 `APPLE_CERTIFICATE` / `APPLE_API_KEY` 等环境变量自动完成），发布到本仓库 GitHub Release。tag 必须与 `tauri.conf.json` 的 `version` 一致（workflow 会校验）。workflow_dispatch 手动触发只出 artifact 不发 release。签名凭据 secrets 命名与 vocalflow-mac 一致，源文件在 `~/Sync/apple-developer/`；签名背景知识见 `../vocalflow-mac/kb/notes/2026-08-10-macos-developer-id-signing-guide.md`。

**Homebrew cask**：`brew install --cask reorx/tap/mdnotate`，cask 定义在 `reorx/homebrew-tap` 仓库（本地 `~/Code/homebrew-tap`）的 `Casks/mdnotate.rb`。发版时 workflow 的「Bump Homebrew cask」步骤用 sed 改写 version / sha256 后推送 tap 仓库；依赖 `TAP_PUSH_TOKEN` secret（对 homebrew-tap 有 contents:write 的 fine-grained PAT），未配置只是跳过，需手动 bump。cask 的 zap 列表引用 identifier `top.ideachat.mdnotate`，identifier 变了要同步。

## 测试提示

agent-browser 用合成 PointerEvent 无法触发 recogito 选区；必须用真实 CDP 鼠标序列：`mouse move` → `mouse down` → 中间点 `mouse move` → 终点 `mouse move` → `mouse up`。

浏览器模式下 `navigator.clipboard.readText()` 会被权限拒绝，剪切板 UI 恒显示 empty；调 UI 时用 `eval` 覆盖 `navigator.clipboard` 再 `dispatchEvent(new FocusEvent('focus'))` 触发重读。

Tauri 窗口没法用 agent-browser 驱动（不开 CDP）；`screencapture` 与 System Events 基本被 TCC 挡死（截图全黑 / AX 报 0 窗口），**UI 改动只能靠人眼验收**。验证 Rust + SQLite 侧改用：`pnpm tauri dev` 起实例 → 用 `src-tauri/target/debug/mdnotate '<spec>'` 触发 single-instance 转发（spec 可以是路径、`host:path`、或 `mdnotate://open?path=…`，argv 分支认链接）→ `sqlite3` 直接查库断言。注意路径会被 `canonicalize`，`/tmp/x.md` 落库是 `file:/private/tmp/x.md`。

**窗口行为可以自动验收，不必靠人眼**：`CGWindowListCopyWindowInfo`（pyobjc 的 `Quartz`，本机已装）不吃 AX 权限就能拿到窗口数量、坐标、以及**前后顺序**（返回顺序即 front-to-back，用来断言「已开的文档被聚焦」），本机还给了 Screen Recording 权限所以窗口标题也读得到 —— 标题就是文档名，正好用来断言哪个窗口装着哪个文档。脚本见 `tmp/multiwindow/list-windows.py`。**冷启动只能用打包产物验**：`pnpm tauri build --bundles app` → `open -a <built app> <file.md>`（不用 `lsregister -f`，`open -a` 直接指定 bundle 就能走 LaunchServices 的 `application:openURLs:`），且必须先 `pkill` 掉 dev 实例——两者 identifier 相同，single-instance 会把文档转发给 dev 实例。**测完记得 `lsregister -u <built app>`**：`open -a` 会把这个未签名产物注册进 LaunchServices，留着它可能顶掉 `/Applications` 里签名版的 `.md` 关联。

**改了 Rust 又改了前端时不要信 HMR**：Rust 重建会重启 app、webview 重新加载，两边很容易错位成"前端是新的、二进制是旧的"，症状是某一类打开方式静默失败。遇到解释不通的现象先 `pkill -f "tauri dev"` 整个重启一遍再下结论。

验证真正的 `mdnotate://` scheme 必须用打包产物：`pnpm tauri build --bundles app` → `lsregister -f <app>`（在 `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/`）→ `open 'mdnotate://open?path=…'`。冷启动（app 没跑）和热启动（已在跑）是两条不同的代码路径，都要试。

前端不碰库时先怀疑 `Database.load` 挂了（连接 promise 被 memo，一次失败之后全线静默）。判断办法：`lsof -p <pid> | grep mdnotate.db` 看有没有句柄，`_sqlx_migrations` 看版本停在哪。要模拟应用侧写入，需要真实的 docId / contentHash：这些函数用了无扩展名 import，`node` 直接跑会 `ERR_MODULE_NOT_FOUND`，得借 vitest 的 resolver —— `tmp/doc-hash.test.ts` 就是干这个的（`DOC_SPEC=… DOC_TEXT_FILE=… DOC_OUT=… pnpm exec vitest run tmp/doc-hash.test.ts --config /dev/null`，注意 vitest 的 `include` 只认 `tests/`，所以要 `--config /dev/null`）。

## 文档

- `kb/sessions/` — 历史 session 总结，了解某次改动的来龙去脉时查阅
