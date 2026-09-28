---
created: 2026-09-28
tags:
  - cli
  - rust
  - codesign
  - ssh
  - claude-code
---

# mdnotate 命令行

写给要改 `mdnotate` 命令、它的打包签名、或首页安装卡片的人：命令做什么、为什么是独立的 crate、怎么进到 app 包里、怎么装到 PATH 上。

## 命令做四件事

| 用法 | 行为 |
|---|---|
| `mdnotate [file...]` | 在 app 里打开。本地文件收齐后一次性打开；`host:path` 包成链接；`mdnotate://` 链接原样直传。链接遇到就开，文件在末尾批量开 |
| `pbpaste \| mdnotate` | stdin 写成 `/tmp/mdnotate/local/clipboard/<时间戳>-<pid>.md`，再当普通文件打开 |
| `mdnotate -h <host> <file...>` | 把文件推到远端机器，并在那台机器的 mdnotate 里打开 |
| `mdnotate last [-h host]` | 打开当前 Claude Code 会话里最后一条 assistant 消息 |

行为的完整规格就是 `dispatch.rs` 的测试，逐行对应。

几条容易想错的规则：

- stdin 内容是落成文件再打开的，**不给 app 加内容通道**。
- **空的非 tty stdin 等同无参**：退回聚焦 app 而不报错。cron 和重定向场景下 stdin 就是这样。
- 多文件推送时全部尝试、记住失败、最后统一以 1 退出。

### 参数解析

**`-h` 是 host，不是 help。** 帮助只有 `--help`，所以缺参数的错误文案里必须指回 `--help` —— 老习惯会撞上来。

两条刻意保留的规则：

- `--help` / `-v` / `--version` / `last` **只在第一个参数位**识别。`mdnotate a.md --version` 是打开一个叫 `--version` 的文件。
- **第一个位置参数出现后停止识别选项**，不做 getopt 式重排。`mdnotate a.md -h host` 是三个文件。

### 推送到远端（`-h`）

一条 ssh 完成全部工作：内容经 stdin 直接管进 ssh，写到远端的 `/tmp/mdnotate/<本机 hostname>/<文件名>`，然后在远端执行 `mdnotate` 打开它。**本地一个临时文件都不落。**

远端执行的命令形状是：

```
mkdir -p '<dir>' && cat > '<path>' && env PATH="/usr/local/bin:$HOME/.local/bin:$PATH" mdnotate -- '<path>'
```

- **这条命令必须是一整个字符串、作为一个参数交给 ssh。** ssh 会把 host 之后的全部参数用空格连起来再交给远端 shell，拆成多个参数看着像 argv，实际不是。
- PATH 前缀是字面量，`$HOME` 留给远端展开。不要复用本机安装目录的那个函数，它解析的是本机的 home。
- 远端没装或装在别处时退出码是 127，翻译成「去那台机器装一下」，而不是原样透出。
- **跨调用的同名文件直接覆盖，是有意的**：远端 app 会刷新同一个窗口，正是想要的。只有同一次调用里的重名才自动加 `-2`。
- `-h` 只收本地文件。`host:path` 和链接在推送之前就报错。

### `last`：找到最后一条回复

定位与提取的逻辑移植自 plannotator（`~/Code/plannotator/apps/hook/server/session-log.ts`），那边是对着几百份真实 transcript 调出来的。没有移植的部分：droid / Factory、候选列表、anchor、Windows 分支。

定位分四级，依次尝试：

1. 祖先进程的 PID 对应的会话文件
2. 全部会话里工作目录相同、开始时间最新的
3. 项目目录下修改时间最新的 transcript
4. 逐级父目录重试

**四级的结果全部作为候选返回**，逐个读到有回复为止。「找到文件」不等于「文件里有东西」。两种空的提示也不一样：找不到会话，和会话里还没有回复。

四件必须知道的事：

1. **transcript 是树，不是列表。** `/rewind` 什么都不写，只是把下一条消息挂到更早的父节点上。按文件顺序倒着读，会读到用户已经看不见的消息。所以要沿父节点链走活跃分支。
2. **`/compact` 之后要退回文件顺序。** 此时活跃分支是一个空的新根；不退回的话，调用方会以为找错了文件，去翻更老的会话。
3. **每一行都按动态 JSON 取字段，不反序列化成 struct。** struct 会让任何一个字段的类型意外把整行静默丢掉，而静默丢行正是这里最不能出的错。
4. **项目目录名按 UTF-16 code unit 生成。** Claude Code 是 JavaScript 写的，BMP 之外的字符在它那边是两个 `-`；按 Rust 的字符走会少一个，目录就找不到了。

## 为什么是独立的 crate

命令在 `src-tauri/cli`，包名是 `mdnotate-cli`。

- **不能叫 `mdnotate`**：会和 GUI 二进制在同一个 target 目录撞名。命令叫什么由安装时建的符号链接决定，与包名无关。
- **workspace 的 `default-members` 只有 app 本身**：`tauri dev` / `tauri build` 底下跑的是裸 `cargo build`，不该为命令行变慢。
- **刻意不依赖 app 的 lib**：那会拖上整个 tauri / sqlx 依赖树，就为了一个只调一次 `open` 的程序。代价是两个 shell 转义相关的小函数抄了第二份（`cli/src/quote.rs`，注释指回出处），属于明确接受的重复。
- 依赖只有 serde / serde_json。`open`、`ssh`、`defaults`、`date`、`hostname`、`ps` 一律用绝对路径调系统命令。

版本号固定是 `0.0.0`，发版脚本不动它。`mdnotate --version` 读的是 app 包的版本。

### 测试

全部在 cargo 里：`cargo test --manifest-path src-tauri/Cargo.toml -p mdnotate-cli`。**不能用 `--workspace`**，那会连 app 一起编，而 app 的构建脚本那时还找不到前端产物。

纯逻辑各模块自测；编排逻辑用一个记录调用序列的假系统覆盖。**重点断言往往是「没发生什么」**：推送时从未写过本地文件，参数被拒时推送和打开都是零调用。

cargo 够不着的只有一件事：真实 .app 里经过两跳符号链接找回 app 包。macOS 返回的可执行文件路径是启动用的那条，也就是链接本身，所以必须自己解析到底。这一项走本机的 `tmp/smoke-cli.sh`。

## 怎么进到 app 包里

命令的构建产物是 `src-tauri/resources/bin/mdnotate`（已 gitignore，是构建产物不是源文件），经 `bundle.resources` 落到 app 包的 `Contents/Resources/bin/mdnotate`。

### 走 Resources，不走 externalBin

externalBin 唯一的好处是自动签名。但 sidecar + 公证会报签名无效的问题（tauri#11992）至今没修，而且那条路一样要为两个架构各编一次再合并。

走 Resources 成立的依据：Tauri 打包时的签名扫描只覆盖 `Contents` 下的 `MacOS`、`Frameworks`、`Plugins`、`Helpers`、`XPCServices`、`Libraries`，且只看一层，**不递归 Resources**。Resources 里的二进制只被按哈希封存，不会被重签。所以「先签好再让 Tauri 打包」不会被外层签名破坏。

而公证要求包里**每一个**二进制都有 Developer ID 签名、hardened runtime 和时间戳，所以命令必须自己先签好。本地签名构建和发版流程的自查里，各有一条专门检查它的签名。

### 构建脚本 `scripts/build-cli.sh`

**必须挂在 `beforeBuildCommand` / `beforeDevCommand`，不能挂 `beforeBundleCommand`。** Tauri 的构建脚本在 cargo 编译时就校验 `bundle.resources` 里每条路径存在，而 `beforeBundleCommand` 要到 cargo 编译之后才跑 —— 挂在那里必然失败。

- 两条 before 命令的工作目录是仓库根目录，不是 `src-tauri`。脚本自己会切到仓库根，从哪跑都一样。
- `MDNOTATE_CLI_TARGETS` 给逗号分隔的 target triple，就逐个编译再合并成 universal；不给就只编宿主架构。发版流程传两个架构 —— Tauri 的 universal 构建不管 Resources 里的独立 crate。
- 有签名凭据（`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`）就签，没有就跳过。
- target 目录向 cargo 查询，不能写死。本机的 cargo 配置把它指到了机器级的共享目录。

### 签名时的钥匙串

**`codesign --keychain` 不是隔离手段。** codesign 认的是钥匙串**搜索列表**，那个参数顶多算提示。所以临时钥匙串必须真的加进搜索列表，签完再原样放回去。读不出原列表时宁可整个不动 —— 把搜索列表设空会让整台机器的钥匙串访问全部失效。

**这个问题在本地发现不了。** 开发机的登录钥匙串里本来就有那张证书，参数指向一个空钥匙串照样签得出来；CI 上没有，就只剩一句「钥匙串里找不到指定项」。所以脚本在签名前有一条前置检查：不带钥匙串参数再查一遍证书，查不到就说清是搜索列表的问题。

想单独验这一段，用本机的 `tmp/verify-cli-signing.sh`（约 15 秒，同时检查搜索列表被放回去了），不用等整个签名构建。

## 怎么装到 PATH 上

首页的 Command Line 卡片负责安装和卸载。

### 安装是符号链接

把 `<目录>/mdnotate` 链到 app 包里的那个二进制。链接而不是拷贝，所以 app 一升级命令跟着新。

提供两个固定目录：`/usr/local/bin`（几乎都在 PATH 上，但属于 root）和 `~/.local/bin`（不需要权限，但得用户自己加进 PATH）。也可以手输目录。

目标位置有五种状态：

| 状态 | 含义 | 处理 |
|---|---|---|
| Missing | 什么都没有 | 显示未安装 |
| Ours | 链接指向这份 app | **唯一算装好的** |
| Dangling | 链接指向的 app 已被删或移走 | 显示未安装，安装时覆盖 |
| Foreign | 链接指向别的副本或别的东西 | 显示未安装，安装时覆盖 |
| Occupied | 是个真实文件 | **拒绝覆盖** |

判断时先看链接本身，再解析它指向哪里。直接跟着链接走的话，「什么都没有」和「链接已失效」看起来一模一样，但要做的事不同。

**没有单独的修复按钮**：失效链接和指向别处的链接，重装就是修复。唯独真实文件拒绝覆盖 —— 分不清是谁的，删错的代价远大于多一句报错。

### 提权

**不预判，而是兜底。** 先直接建链接，只有被拒绝才转为请求管理员权限重试。提前按目录权限判断会有检查与使用之间的时间差，而且自定义目录归谁，前端根本不知道。

- 安装和卸载两个 command 必须是异步的。授权框可以在屏幕上挂任意久，同步 command 会把窗口冻死。
- 用户在授权框点取消，翻译成一句人话显示出来，不当错误抛，也不引入跨语言的特殊字符串来区分。

### 卡片的状态规则

- **已装好优先于一切。** 哪怕当前这份 app 跑在磁盘镜像里，或根本没打包，先前装好的命令仍要能卸载。
- 只有两种情况不让装：dev 构建没有可链接的二进制；磁盘镜像里的副本，链接活不过弹出镜像。
- **自定义目录必须存进设置。** 两个固定目录是两边都知道的常量，每次扫一遍即可；用户手输的那个不记下来就再也找不回，重启后会误报未安装。

## 两个 Agent Skill

`skills/mdnotate` 与 `skills/mdnotate-last`，各自只是一行调用命令，加一句「跑完就停」。

mdnotate 只读、打开即结束，什么都不回传，所以没有需要分支处理的结果。唯一有用的叮嘱是别等回复、别自作主张接着干活。

Claude Code 不会发现仓库里的 `skills/` 目录，用前要链接到 `~/.claude/skills/`，命令在 `skills/README.md` 里。链接而不是拷贝，`git pull` 就跟着更新。

## 代码位置

- `src-tauri/cli/src/` —— `cli`（参数）、`locator`、`remote`（远端路径与命令）、`paths`、`transcript`、`session_discovery`、`quote`、`system`（唯一的副作用出口）、`dispatch`（编排与行为规格）
- `src-tauri/Cargo.toml` —— workspace 与 `default-members`
- `scripts/build-cli.sh`、`scripts/build-signed.sh`、`.github/workflows/release.yml`
- `src-tauri/src/cli_install.rs`、`src/lib/cli-install.ts`、`src/components/CliInstallCard.tsx`（`tests/cli-install.test.ts`）
- `skills/`
