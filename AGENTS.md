# mdnotate — Agent 参考卡

**Markdown Annotate**：Tauri v2 桌面应用（macOS），作为本地 `.md` 文件的默认打开方式，用于阅读 + 划词高亮/评论，最后按模板导出为 Markdown 引用块。也能通过 `mdnotate://` 链接打开、经 ssh 读取远端文件，并附带一个 `mdnotate` 命令行。**只读，不提供编辑功能。**

本文件只放规则和指路；每条规则背后的完整理由在 `kb/docs/`（见文末索引）和代码注释里。

## 技术栈

Tauri v2 + React 19 + Vite 7 + TypeScript + Tailwind v4 + zustand。pnpm 管理依赖，Node 由 `mise.toml` 固定为 24。Markdown 渲染用 react-markdown + remark-gfm；标注用 `@recogito/text-annotator`。存储是 `tauri-plugin-sql`（SQLite）+ `tauri-plugin-store`。

扁平单包结构（**不是** monorepo）；Rust 侧是一个两成员的 cargo workspace（app + CLI）。

## 目录结构

```
src/lib/          纯逻辑 + hook，按主题：
  打开文档     open-doc（唯一入口）、doc-locator（spec / 链接语法、格式判定）、path-input、
               path-prefix、recent-docs（文档模型与 docId）、latest、window-doc、clipboard
  标注         annotate（改标注的唯一入口）、annotations、use-text-annotator（recogito 封装）、
               popup-position、annotation-markers、template（导出模板）
  阅读器       search + use-doc-search + find-painter（⌘F）、use-select-all（⌘A）、
               keys（按键谓词）、toc、doc-info、panels、window-drag、
               box-table（CLI 框线表格 → GFM 表格，只喂渲染器、不动 store）
  存储与设置   db（唯一连接）、recents-db / annotations-db / path-prefixes-db、
               settings、theme、typography
  其它         default-app、cli-install、tauri-env、sample-doc
src/components/   Home 与它的卡片（OpenFileCard / ClipboardCard / DefaultAppCard / CliInstallCard，
                  共用 ActionCard 的壳）、PathEntry + PrefixCombobox（首页与 ⌘O 面板共用）、
                  OpenDialog、RecentList、Reader（正文 + 两侧栏）、Toc、AnnotationList、
                  AnnotationPopup、CommentMarkers、FindBar、StatusBar、DocTitle、
                  ExportView、SettingsView
src/store.ts      zustand 全局状态，每个窗口一份
src/App.css       样式与深色调色板；find-highlight.css 单独装 ::highlight() 规则
src-tauri/src/    lib.rs（文档路由、窗口注册表、commands、migrations）、menu.rs、
                  channel.rs（dev identifier）、default_app.rs、cli_install.rs
src-tauri/cli/    `mdnotate` 命令，独立 crate `mdnotate-cli`
scripts/          build-cli.sh、build-signed.sh、bump-version.sh、release-status.sh
skills/           /mdnotate 与 /mdnotate-last 两个 Agent Skill（用前要 symlink，见 skills/README.md）
tests/            vitest，覆盖 src/lib 的纯逻辑
kb/               知识库：docs / notes / sessions / plans
```

## 开发命令

```bash
pnpm tauri dev     # 运行应用（dev 构建用独立的 identifier 与数据目录）
pnpm dev           # 只跑前端，浏览器降级模式，用来迭代 UI
pnpm test          # vitest
cargo test --manifest-path src-tauri/Cargo.toml                  # app 的 Rust 单测（要先有 dist/ 和构建好的 CLI）
cargo test --manifest-path src-tauri/Cargo.toml -p mdnotate-cli  # CLI 的全部测试，几秒跑完
./scripts/build-cli.sh   # 单独构建 CLI；dev 与 build 都会自动调它
pnpm tauri build   # 产出 .app 与 .dmg，无签名凭据时是 ad-hoc 产物，只能原地运行
pnpm build:signed  # 构建 + 签名 + 公证，产物可安装进 /Applications
```

## 开发约定

- 新功能走 BDD（先写 `tests/` 下的行为测试再实现），bug 修复走 TDD。
- **纯逻辑必须放在 `src/lib/` 并有测试；组件层不写单测。** 两个例外：`ime-keys.dom.test.tsx`（回放浏览器的组字事件序列）和 `open-dialog.test.ts`（store 的一条规则）。
- Rust 侧的纯规则用 `#[cfg(test)]` 单测，写在所在文件里。
- TS / Rust 源码的注释是英文且很详尽，单个文件内的坑都写在原处：改一个文件前先读它的模块注释。

## 必须知道的规则

下面每条都是「不打开任何文档也可能改坏」的东西。多数改坏了**不报错**。

### 打开文档与窗口

- **入口各只有一个。** 外部进来的文档（Finder / argv / single-instance / 拖拽）全部经 `lib.rs` 的 `open_spec()`；前端一律经 `open-doc.ts`，字符串走 `openSpec()`。不要另开一条路，否则「打开」与「记入 Recent」会脱节。
- **传递的是 spec，不是路径**：绝对路径、`host:path`、或整条 `mdnotate://open?path=…` 链接。语法只在 `doc-locator.ts` 实现，Rust 不解析链接。链接的路径必须走 query 参数。
- **往窗口发事件用 `emit_to`，不用 `emit`。** 广播会让每个窗口都换文档 / 都弹面板。
- **前端先注册 listener，再 drain pending。**
- **一个文档一个窗口**（`choose_target()`）：已开着的送回原窗口并重读；停在首页的空窗口就地填入；否则开新窗口 `doc-N`。窗口内的入口一律原地替换。
- **⌘N 开出的空窗口不能标 `taken`**，否则下一篇文档会另开窗口而不是填进去。
- **打开失败也要 `announceDoc()`**：窗口在路由那一刻就被标成装着该文档了。
- **「打开成功关掉 ⌘O 面板」只写在 `store.ts` 的 `openDoc` 里**；落区的 drop 事件里 JS 不自己打开文件，Rust 已经开过了。
- **菜单是在 `Menu::default()` 上打补丁**，不要整个重建。
- **跨语言的重复要同步改**：可打开的扩展名（`doc-locator.ts` ↔ `lib.rs`）、本地文件的 docId（`recent-docs.ts` ↔ `lib.rs`）、shell 转义（`lib.rs` ↔ `cli/src/quote.rs`）。

细节在 `kb/docs/window-routing.md`（路由、注册表、冷启动、菜单、⌘O 面板）和 `kb/docs/opening-documents.md`（spec 与链接的写法、ssh 读取、格式、路径输入、prefix + suffix、剪切板）。改 `lib.rs` 的路由部分、`open-doc.ts`、`doc-locator.ts` 之前先读。

### 权限

`capabilities/default.json` 的 `"windows"` 必须是 `["main", "doc-*"]`，漏了新窗口就是零权限且静默失效。`sql:allow-execute`、`core:window:allow-set-title`、`core:window:allow-set-theme` 都不在各自的 default 集里，要单独声明。

### 数据

- **已发布的 migration 是冻结的**，SQL 字符串连缩进都不能改（sqlx 校验 checksum，变了整个库打不开）。只能追加新 version。
- **`src/lib/db.ts` 是唯一的数据库连接**，不要在别处 `Database.load`。
- **dev 的库在 `~/Library/Application Support/top.ideachat.mdnotate.dev/`**，查库断言要指到这里。
- Recent 上限 50 条，**裁剪会级联删除该文档的标注**；`path_prefixes` 故意不挂外键。两者都是有意的。
- 设置读回来一律过 `mergeSettings` 校验；加设置项要同时加校验。

细节在 `kb/docs/data-storage.md`：三张表的规则、dev identifier、设置存储。加表、加 migration、加设置项之前先读。

### 标注

- **标注的锚点是渲染文本的字符偏移，所以不许改动正文的文本节点。** 往正文里插元素（比如用 `<mark>` 做搜索高亮）会让所有标注错位；包一层容器可以。
- **改标注只走 `annotate.ts`**；标注必须和文档**一起**进 store（`openDoc(doc, annotations)`），晚到的不会被渲染。
- **标注层的 `documentKey` 是 `docId#contentHash`**，只写 docId 会在文档重开后按旧偏移高亮到错的句子。
- 内容哈希对不上的标注在打开时直接丢弃，这是有意的。
- recogito 必须用 `SPANS` renderer；我们放进标注容器的层都要带 `not-annotatable`；换主题用 `setStyle()`，不要重建标注层。
- 纯图标按钮用 `IconButton`，不手写裸 `<button>`。

细节在 `kb/docs/annotations-and-export.md`：失效判定、弹窗与落点、评论图标层、侧栏、两层导出模板的按行规则。改 `use-text-annotator.ts`、`template.ts` 或标注相关组件之前先读。

### 阅读器界面

- **键盘：keydown 里不许裸判 `e.key`，一律走 `src/lib/keys.ts`**（`isImeComposing` / `isSubmitEnter` / `isCancelEscape`）。输入法组字期间的 Enter / Esc 和普通按键长得一样。document 级的单键快捷键同样要判；带修饰键的组合不用。
- **`main.tsx` 里的 `watchComposition()` 不能删。** 删了真机上中文输入就坏，而测试依然全绿。
- **Reader 从不卸载**，其它视图是盖在上面的不透明层。所以 document 级快捷键要自己判断 `enabled`（`view === 'reader' && !openDialog`）。
- Reader 根节点的 `relative z-0` 和 `min-w-0` 都是必需的；正文不许横向滚动，超宽内容自己内部滚。
- **⌘F 用 CSS Custom Highlight API**，且只经 `find-painter.ts`：高亮对象只 `set()` 一次，之后只 `clear()` / `add()`，绝不 `delete()` 或重新 `set()`（WebKit 不重绘）。`::highlight()` 规则只能放在 `find-highlight.css`。
- **⌘A 是自己实现的**，在 capture 阶段拦（库也绑了 ⌘A，会把整篇建成标注）。
- **源码视图切换时三样东西要跟着重置**：搜索索引、目录构建、滚动 spy。

细节在 `kb/docs/reader-ui.md`：视图覆盖、三栏布局、源码视图、搜索的规范化文本、⌘A、输入法。改 `Reader.tsx`、搜索、或任何键盘处理之前先读。

### 样式

- **深色模式靠反转 neutral 色阶，不写 `dark:`。** 新组件沿用 neutral 阶梯（50 侧栏 / 100 hover / 200–300 边框 / 400–500 弱文字 / 700–800 强文字）就自动有深色。
- 页面底用 `bg-page`，浮层用 `bg-raised`，不用 `bg-white`。
- 两种主题下都要成立的淡色前景写带透明度的（`amber-500/30`），不借会被翻转的档位（`amber-200`）。
- **排版数值只有一份默认值**（`DEFAULT_TYPOGRAPHY`），CSS 里的 `var(--prose-*)` 没有 fallback：新增渲染正文的地方必须挂在提供这三个变量的节点下。
- 主题的副作用只经 `lib/theme.ts`；store 里主题的初始值必须来自缓存而不是默认值。

细节在 `kb/docs/theme-and-typography.md`。新写组件、调颜色之前先读。

### Rust command 与 macOS

- **会等人或等网络的 command 必须是 `#[tauri::command(async)]`**（`read_remote_file`、CLI 的安装 / 卸载）。同步 command 跑在主线程，会冻住窗口。
- **`start_window_drag` 反过来必须是同步的**，改成异步窗口就拖不动。顶栏拖拽不用 Tauri 自带的 drag region。
- 菜单事件里建窗口要包 `run_on_main_thread`。
- `.md` 绑定的 UTI 是机器相关的，不能硬编码；「设为默认 App」的系统调用立刻返回成功但并未生效，要轮询。
- **不要把 `pnpm tauri build` 的未签名产物拷进 /Applications**：macOS 会静默取消它的文档 handler 资格，还会顶掉 brew 装的签名版。

细节在 `kb/docs/macos-integration.md`：文件关联的两条 document type、默认 App、窗口拖拽。改 `Info.plist`、`default_app.rs`、`window-drag.ts` 之前先读。

### mdnotate CLI

- 独立 crate，包名 `mdnotate-cli`；**刻意不依赖 app 的 lib**，workspace 的 `default-members` 只有 app。
- 测试用 `-p mdnotate-cli`，**不能用 `--workspace`**。行为规格表就是 `dispatch.rs` 的测试。
- **`-h` 是 host 不是 help**；选项只在第一个位置参数之前识别。
- 交给 ssh 的远端命令必须是**一整个字符串、一次 `.arg()`**。
- 读 transcript 用 `serde_json::Value` 取字段，不反序列化成 struct。
- 产物 `src-tauri/resources/bin/mdnotate` 是构建产物（已 gitignore）。`build-cli.sh` 挂在 `beforeBuildCommand` / `beforeDevCommand`，**不能**挂 `beforeBundleCommand`。
- 走 `bundle.resources` 而不是 `externalBin`，所以 CLI 要在打包前自己签好。

细节在 `kb/docs/mdnotate-cli.md`：四种用法、远端推送、`last` 的 transcript 定位、打包与钥匙串、安装卡片的状态。改 `src-tauri/cli/`、`build-cli.sh`、`cli_install.rs` 之前先读。

## 验收

- **Tauri 窗口没法用 agent-browser 驱动**，截图和 System Events 也被 TCC 挡住。界面改动尽量在 `pnpm dev` 的浏览器模式里验，其余靠人眼。
- 浏览器模式里划词必须用真实鼠标序列（`mouse move → down → move → move → up`），合成事件无效。
- Rust + SQLite：起 `pnpm tauri dev`，用 `src-tauri/target/debug/mdnotate '<spec>'` 转发文档，再 `sqlite3` 查库。
- 冷启动、文件关联、链接只能用打包产物验；测完 `lsregister -u <built app>`。
- 杀 dev 实例要两条：`pkill -f "tauri dev"; pkill -f "target/debug/mdnotate"`。
- 同时改了 Rust 和前端、现象解释不通时，先整个重启再下结论。

完整步骤在 `kb/docs/verification.md`：各类改动的验证路线、窗口行为的自动断言、数据库连接的排查、测完要收拾什么。动手验收之前先读。

## 发布

push `v*` tag 触发 `.github/workflows/release.yml`：构建 universal dmg，签名 + 公证，发 GitHub Release，更新 Homebrew cask（`reorx/homebrew-tap`）。tag 必须与 `tauri.conf.json` 的 version 一致。

**发版一律走 `.claude/skills/release/`**，push tag 不可逆。版本号用 `scripts/bump-version.sh <版本号>` 改（四处一次改齐），状态用 `scripts/release-status.sh` 核对；不要手工 sed。

## 文档

`kb/docs/` —— 各子系统的现状与理由：

- `kb/docs/window-routing.md` —— 改多窗口路由、窗口注册表、冷启动、File 菜单、⌘O 面板时读
- `kb/docs/opening-documents.md` —— 改文档的读取、spec / 链接语法、ssh 远端、路径输入、prefix 补全、剪切板入口时读
- `kb/docs/annotations-and-export.md` —— 改标注、弹窗、评论图标、标注侧栏、导出模板时读
- `kb/docs/reader-ui.md` —— 改阅读页布局、⌘F、⌘A、源码视图、键盘与输入法处理时读
- `kb/docs/theme-and-typography.md` —— 新写组件、改颜色、主题或排版时读
- `kb/docs/data-storage.md` —— 加表、加 migration、加设置项，或要去库里查数据时读
- `kb/docs/macos-integration.md` —— 改文件关联、默认 App、窗口拖拽，或要安装构建产物时读
- `kb/docs/mdnotate-cli.md` —— 改 `mdnotate` 命令、它的打包签名、安装卡片、Agent Skill 时读
- `kb/docs/verification.md` —— 验收任何改动之前读

其它：

- `kb/notes/` —— 单个技术问题的专题笔记：`2026-08-16-ime-enter-escape.md`（输入法与按键判定）、`2026-09-17-css-highlight-repaint.md`（WebKit 高亮不重绘）
- `kb/sessions/` —— 历史 session 总结，了解某次改动的来龙去脉时查阅
- `kb/plans/` —— 开发计划
