---
created: 2026-09-28
tags:
  - multi-window
  - routing
  - menu
  - tauri
---

# 多窗口与文档路由

写给要改「文档从外面进来之后去哪个窗口」的人：Finder 双击、`open`、链接、argv、拖拽、菜单 ⌘N / ⌘O 各自怎么走，以及哪些地方改错了不会报错、只会悄悄多出一个窗口或丢掉一篇文档。窗口拿到文档之后怎么读，见 `opening-documents.md`。

## 四条外部入口，一个路由函数

macOS 的 `RunEvent::Opened`、argv、single-instance 转发、窗口 DragDrop 四条路径全部收敛到 `lib.rs` 的 `open_spec()`，由它决定去哪个窗口。

事件载荷不是纯路径，而是 `doc-locator` 能读的 **spec**：绝对路径、`host:path`、或整条 `mdnotate://` 链接。Rust 不解析链接，原样转发给前端。single-instance 转发来的 `argv[1]` 是相对路径，要用回调给的 `cwd` 拼接。

送达有两条腿：

- webview 已经起来的窗口：直接 `emit_to`。不能用 `emit` —— 广播会让每个窗口都换文档。
- webview 还没起来的窗口：spec 留在它自己的 `pending` 槽里等它来取。

前端必须**先注册 listener 再 drain pending**（`take_pending_doc`）。drain 这个动作同时就是「我在听了」的登记，两件事在同一把锁里完成，所以不存在「刚放进槽、窗口已经取完」的缝。

## 一个文档一个窗口

外部打开（Finder 双击 / `open` / 链接 / argv）按三条规则选窗口，纯逻辑是 `choose_target()`：

1. **已经开着这个文档的窗口 → 送回那个窗口。** 两个窗口读同一文档会往同一批标注行里各写各的、互相看不见，这是必须避掉的数据打架。
2. **还停在首页的空窗口 → 就地填进去。**
3. **否则开新窗口。** label 是 `doc-N`（`main` 来自 config，N 从 1 递增且不复用）；位置从最前面那个窗口 `+28px` 级联，撞到工作区边缘就回到左上角重来。

两个例外：

- **拖拽**：丢在哪个窗口就在哪个窗口开（规则 1 仍优先）。
- **窗口内的入口**（Recent / ⌘O 面板 / 路径框 / 剪切板）一律原地替换当前窗口，否则窗口只增不减。想要新窗口就先 ⌘N。

### 再次打开 = 刷新

规则 1 送回去的是完整的一次打开，不是单纯聚焦：文件会重读，所以在别处编辑过的文档双击一下就能看到新内容。代价是滚动位置回到顶部，内容真变了的话旧标注会被丢弃并提示（见 `annotations-and-export.md`）。

正因为「已开着」和「空窗口」两条最后做的是同一件事，`Target` 只有 `Deliver` 和 `Spawn` 两个分支，没有单独的 `Focus`。

### 远端文档和链接享受不到规则 1

Rust 侧只算得出本地文件的 docId：`file_doc_id()` 是前端 `fileDocId` 的第二份实现（`file:<canonical 路径>`）。链接和 `host:path` 的语法只在 `doc-locator` 里，Rust 不解析，所以同一个远端文档用链接开两次会得到两个窗口。这是明确接受的取舍。

## 窗口状态注册表

Rust 侧 `Windows(Mutex<HashMap<label, WindowEntry>>)` 记录每个窗口的四件事：装着哪个 docId、是否已被占用（`taken`）、webview 是否在听（`ready`）、待取的 spec（`pending`）。

**一把锁盖住全部四项是有意的。** 拆成两把就会出现「窗口在决策中途起来了、文档被放进它已经取空的槽里」。

窗口关闭时 `WindowEvent::Destroyed` 要把注册表条目删掉，否则它会永远替一个没人在读的文档占位。

前端这边是 `announceDoc()`：读 store 里当前的文档，把 docId 汇报给 Rust，并把窗口标题设成文档名。标题栏是 Overlay 隐藏的，但 ⌘\` 切换和 Mission Control 靠标题区分窗口。

它在两处被调用：打开成功之后，以及打开失败的 `catch` 里。**失败路径必须回报** —— 窗口在路由的那一刻就被乐观地标成「装着这个文档」了，读失败若不纠正，再打开同一个文档就只会聚焦这个根本没打开成功的窗口。写在 `catch` 而不是 `finally`：成功时已经报过一次，放 `finally` 会让每次正常打开都多一次 IPC 和一次 `setTitle`。

## 冷启动：文档比窗口来得早

Tauri 的 config 窗口是在它自己的 `setup()` 里建的，而 `setup()` 挂在事件循环的 Ready 上。macOS 双击文档启动 app 时，`application:openURLs:` **先于** Ready 到达。

早到的文档如果当场路由，会发现一个窗口都没有，于是开一个新窗口，随后 config 窗口再空着弹出来。所以它们先攒在 `ColdStart` 缓冲里，等 `.setup()`（Tauri 建完窗口才调）再逐个路由。

缓冲是 `Mutex<Option<Vec<_>>>`：`Some` 即「还在启动中」，标志位和缓冲区是同一个东西。

## 新窗口的权限

多窗口有两个配置必须到位，漏了不报错：

- `capabilities/default.json` 的 `"windows"` 是 `["main", "doc-*"]`（支持 glob）。漏了的话新窗口是**零权限** —— SQL、对话框、`setTheme` / `setTitle` 全部静默失效。
- `core:window:allow-set-title`、`core:window:allow-set-theme` 不在 `core:default` 里（`core:window:default` 只有只读那批），`sql:allow-execute` 不在 `sql:default` 里。后者要到第一次写入才报错。

## 窗口之间不同步的两件事

- 设置 / 主题改动只作用于当前窗口。各窗口的 store 独立，重启后一致。
- A 窗口打开文档不会刷新 B 窗口的 Recent 列表。

数据库并发写没有问题：sqlx 默认 WAL + 5 秒 busy_timeout，每个 webview 各有一个连接池。

## File 菜单

File 里是 `New Window ⌘N` / `Open… ⌘O` / 分隔线 / `Close Window ⌘W`。

做法是**在 `Menu::default()` 上打补丁**（找到 text 为 `"File"` 的子菜单，把两项插到最前面），不是整个重建。重建的话要自己记得：

- 带上 `WINDOW_SUBMENU_ID` / `HELP_SUBMENU_ID`，macOS 靠这两个 id 把原生窗口列表和 Help 搜索框接上去；
- 自己拼 About 面板的 `package_info` 和 `copyright`；
- 保住 Edit 子菜单里的 Select All ⌘A，正文的 ⌘A 实现以它存在为前提。

`"File"` 是 Tauri 硬编码的英文，所以有兜底：找不到就自己建一个 File 插到 index 1。升级 Tauri 后菜单栏值得瞄一眼 —— 真变了会看到两个 File，而不是 ⌘O / ⌘N 悄悄消失。

菜单 id 字符串只出现在 `menu.rs` 里，`run()` 只认 `MenuAction` enum。

**建窗口那一支要包 `run_on_main_thread`**：macOS 上建窗口必须在主线程，而 Tauri 没承诺菜单事件在哪个线程投递。其它建窗口的调用点本来就在主线程，这是唯一需要顾虑的一处。

### ⌘N 的空窗口不能标 `taken`

注册表条目由纯函数 `spawn_entry()` 产出。⌘N 开出来的空窗口正是规则 2 里「还停在首页的那个」，标成 `taken` 之后，从 Finder 双击的下一篇文档会另开一个窗口而不是填进去。不报错、日志里也没有，只是凭空多一个窗口。

### ⌘O 弹的是自己的面板

⌘O 不开系统文件选择框。这个 app 打开文档的主力路径是「粘一条路径或 `host:path`」和 prefix + 文件名，系统选择框够不着远端文件，也够不着记住的目录；它退居为面板里落区的点击行为。

- `open_dialog()` 只往**当前窗口** `emit_to` 一条 `open-dialog`。广播会让每个窗口都弹一个。
- 一个窗口都没有时（macOS 上关完窗口 app 还活着）就开一个空窗口 —— 首页本来就是这张面板。
- 面板不是第五种 view，而是和 `view` 平行的开关 `openDialog`：它盖在一切之上，header 也包括在内。
- **「打开成功要关掉面板」只写在 store 的 `openDoc` 里一处。** 路径输入、prefix + suffix、剪切板、Recent、系统选择框、拖进来的文件、面板开着时从 Finder 送进来的文档，全都收敛到这一个调用。组件层没有相关代码，也不传 `onOpened` 回调。
- 面板里的落区只管高亮，**JS 不在 drop 里自己打开文件**。文件已经由 Rust 的窗口事件打开了，再开一次就是开两遍。
- 面板开着时，正文的 ⌘F 和 ⌘A 都要停用，否则 ⌘F 会滚动背后的正文、⌘A 会选中背后的整篇文档。
- 面板自己的 Esc 挂在 document 的**冒泡**阶段。prefix 补全框的 Esc 在下拉打开时会 `stopPropagation()`；挂在 capture 阶段会抢在它前面，把整个面板连下拉一起关掉。

## 代码位置

- `src-tauri/src/lib.rs` —— `open_spec` / `choose_target` / `spawn_entry` / `Windows` / `ColdStart`，前两者的规则有 `#[cfg(test)]` 单测
- `src-tauri/src/menu.rs` —— 菜单补丁与兜底
- `src-tauri/capabilities/default.json` —— 窗口权限
- `src/lib/window-doc.ts` —— `announceDoc()`
- `src/App.tsx` —— listener 注册与 pending drain
- `src/components/OpenDialog.tsx`、`src/store.ts` —— ⌘O 面板；`tests/open-dialog.test.ts` 锁住「只在 `openDoc` 里关面板」
