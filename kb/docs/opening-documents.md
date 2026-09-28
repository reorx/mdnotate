---
created: 2026-09-28
tags:
  - open-doc
  - doc-locator
  - ssh
  - url-scheme
  - path-input
---

# 打开文档：写法、来源与入口

写给要改「一篇文档怎么被找到、读进来、摆上屏幕」的人：路径和链接怎么写、本地与 ssh 远端各怎么读、首页那几个入口各自的规则。文档进了 app 之后去哪个窗口，见 `window-routing.md`。

## 文档的三种来源

| 来源 | 写法 | docId | 导出时的 `{{filePath}}` |
|---|---|---|---|
| 本地文件 | 绝对路径 | `file:<canonical 路径>` | 全路径 |
| ssh 远端 | `host:path` | `ssh:<host>:<path>` | `host:path` |
| 剪切板 | —— | `clip:<内容 hash>` | 派生出的标题 |

文档模型 `OpenDoc` 的字段：`id`（同时是 Recent 主键）、`kind`、`title`（标题栏）、`source`（上表最后一列）、`content`、`format`、`contentHash`。各入口只构造 `NewDoc`，`contentHash` 由 `open-doc` 统一盖章。

去重规则编码在 id 里。host 必须进 id：两台机器上的同一路径是两个文档。

## 本地还是远端：只看一件事

**第一个 `/` 之前有没有冒号。** 所以 `/notes/2026:08:11.md` 仍是本地文件，判定不需要知道任何机器相关的事。

远端用 scp 写法：`host` 是 `~/.ssh/config` 里的 alias，冒号后相对于远端 home，`host:/abs` 才是绝对路径。

## 链接

`mdnotate://open?path=<spec>`

**路径必须走 query 参数。** macOS 会先把每条进来的 URL 喂给 URL 解析器，解析不了的直接丢弃且毫无提示，而 `mdnotate://host:path/…` 正是解析不了的那种 —— authority 里冒号后面那段被当成端口。

链接里的 `&` 和 `#` 必须写成 `%26` / `%23`，否则 query 被截断。`doc-locator` 检测到多余的 query key 或 fragment 会明确报错，而不是打开半截路径。

链接的语法只在 `doc-locator` 里实现一次、测一次，Rust 侧原样转发。

## 可打开的格式

- `.md` `.markdown` `.mdown` `.mkd` —— 按 Markdown 渲染。
- `.txt` `.text` `.log` `.json` `.yaml` `.yml` `.toml` `.ini` `.conf` `.csv` `.tsv` —— 以纯文本原样显示（等宽、保留换行）。标注照常可用，目录显示「No headings」。
- 其余一律拒绝，且在联网之前就拒绝。

扩展名列表有两份：`doc-locator.ts`（有测试）和 `lib.rs`。后者是因为拖拽要在前端看到文件之前就筛选，属于无法避免的重复，**改动要两边同步**。

文件关联只注册 `.md` / `.markdown`，不去抢 `.txt`。

## 读取

### 本地文件以「真身」为准

读本地文件时除内容外还返回 `canonicalize()` 后的路径，id 和 source 都用它算。否则 `/tmp/a.md` 与 `/private/tmp/a.md` 会变成两条 Recent、两套标注 —— OS 递过来的路径本来就是 canonical 的，链接和输入框里的不是。

### ssh 远端文件

读取就是一条命令：

```
/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 <host> cat -- '<quoted path>'
```

直接调系统的 ssh，白捡整个 ssh 配置（alias / Include / ProxyJump / ControlMaster 复用）。代价是必须自己做 shell 单引号转义。

- **这个 command 必须是异步的**（`#[tauri::command(async)]`）。同步 command 跑在主线程上，10 秒的连接超时会把窗口冻住。
- stdout 按 8MB 封顶读取，超了要杀掉子进程。只停止读取会让远端的 `cat` 卡在写满的管道上，等它退出的那一步跟着死锁。
- 退出码 255 是 ssh 自己连不上，提示用户去终端跑一次 `ssh <host>`；其它退出码是远端 `cat` 的错误。
- 远端文件和本地文件一样**不存正文**，每次打开都重新拉取，所以离线读不了。

**认证前提**：GUI 启动的 app 拿不到 shell 环境，但 macOS 的 launchd 会给每个进程注入 `SSH_AUTH_SOCK`，用户 ssh config 里的 `ControlMaster auto` + `ControlPersist yes` 让已有的 master socket 直接复用。冷启动经链接读远端文件已验证可行。既没有 agent 身份也没有 master socket 时，`BatchMode` 会立刻失败而不是挂起，这是有意的。

## 前端的唯一入口

文件关联、链接、⌘O 面板、拖拽、剪切板、Recent、开发用的示例文档，全部走 `open-doc`，保证「打开」与「记入 Recent」不会脱节。从字符串进来的一律走 `openSpec()`：脱掉链接外衣 → 按需问一次 home 目录 → 解析 → 读取。

三条规则：

- **写 store 在前、写库在后。** 数据库出问题不该拦住阅读。唯一的例外是读标注：标注必须随文档一起进 store，所以会先等它；但读失败只是裸开文档加一条提示，绝不把文档挡在门外。
- **慢的那次不许盖掉快的那次。** 每个入口先领一张号再去取内容，写 store 前验号，过期的直接丢弃。否则点了一个 ssh 文档（最长等 10 秒）又改点一个本地文档时，姗姗来迟的那个会把屏幕换回已经不要的内容。号是 module 级的，而 module 级即窗口级。
- **失败不换文档。** store 里的旧内容留着，只出提示。

### 刷新按钮

顶栏 Home 右边的刷新按钮，只在正看着文档时出现。「打开」这个动作会把文档摆回屏幕上，从设置页按下去等于把人踢出设置页。

刷新没有第二条链路：它只是拿当前文档的 `source` 再打开一次，所以内容哈希、失效标注、Recent、加载指示器全部沿用。剪切板文档的按钮置灰 —— 正文只在库里，重读只会拿回同样的字符。

## 首页的入口

### 路径输入框

接受绝对路径、`host:path` 和整条 `mdnotate://` 链接。路径永远不按空格切分，只 trim 两端。

职责分两层：

- `path-input` 只负责**脱掉方言外衣**：终端拖拽产生的 `\ ` 转义、外层单 / 双引号（引号内的反斜杠按 shell 语义保持字面）、`file://` URL（百分号解码，坏转义原样保留）。`mdnotate://` 链接原样放行。
- 路径**意味着什么**全在 `doc-locator`。不要再造第二个校验器。

本地路径里的 `~` 会展开，只有真用到时才花一次 IPC 去问 home 目录。远端路径里的 `~/` 是被剥掉而不是展开的：路径进远端 shell 前会被单引号包住，`~` 不会展开，而冒号后的相对路径本来就相对于远端 home。

### prefix + suffix

路径框下面还有一行：左边是记着用过的 prefix 的补全框，右边是文件名。拼出来的东西照常当作一条 spec 打开，这里没有第二套语法。

拼接规则：两半之间补一个 `/`，除非

- prefix 已经以 `/` 结尾，或 suffix 以 `/` 开头；
- **prefix 以 `:` 结尾**。这条是会静默开错文件的那个：`host:path` 相对于远端 home，`host:/path` 是远端根目录，冒号后多一个斜杠就换了个文件且不报错。

卡片下面那行拼接预览不是装饰 —— 自动补的斜杠落在哪，只有它看得见。

补全是不分大小写的**子串匹配**而不是前缀匹配：存下来的 prefix 都以 `~/`、`/` 或主机名开头，没人想为了找它把这几个字符再打一遍。以输入开头的排在前面；输入为空时 focus 就列出最近用过的几条。

只有真的打开成功了才记下这条 prefix，打不开的路径不该赖在补全列表里。成功后清空 suffix 但留着 prefix，同一个目录下的下一篇就是这么开的。

### 剪切板

系统没有剪切板变化事件，所以卡片在挂载时和窗口获得焦点时各读一次 —— 焦点回来正是用户从别处复制完的时刻。读不到与空剪切板等同处理。

内容必须多于 200 字符才算可读文档，否则按钮禁用、不显示预览。复制一个词或一条 URL 不该点亮卡片。

## 代码位置

- `src/lib/open-doc.ts` —— 唯一入口，`openSpec` / `reloadDoc`
- `src/lib/doc-locator.ts` —— spec 与链接的语法、格式判定（`tests/doc-locator.test.ts`）
- `src/lib/path-input.ts`、`src/lib/path-prefix.ts` —— 输入归一化与拼接规则
- `src/lib/recent-docs.ts` —— 文档模型、docId、剪切板与刷新的纯规则
- `src/lib/latest.ts` —— 领号 / 验号
- `src-tauri/src/lib.rs` —— `read_local_file` / `read_remote_file`，以及第二份扩展名列表
- `src/components/PathEntry.tsx`、`PrefixCombobox.tsx`、`ClipboardCard.tsx`
