---
created: 2026-08-18
tags:
  - cli
  - rust
  - ssh
  - packaging
  - claude-skills
---

# 计划：CLI 改写为 Rust —— stdin 管道、--host 远端推送、last 子命令 + 两个 Agent Skill

> 状态：**代码已实施，验收未完**（2026-08-18）。本计划由 feature-dev 流程产出
> （两轮探索 agent + 两轮架构 agent），所有关键决策已经用户确认。
> **`-h/--host` 的真 ssh 推送、两个 skill 的 `!` 注入、`last` 在真 `~/.claude/` 上的定位
> 都还没在真机上跑过** —— 详见文末「实施记录 → ⚠️ 尚未验收」，别当成能用。

## 1. 背景与目标

现有 CLI 是 `src-tauri/resources/bin/mdnotate`（POSIX sh，经 `bundle.resources` 落到
`Contents/Resources/bin/mdnotate`，`cli_install.rs` 往 PATH 目录建符号链接指向它）。要新增：

1. **stdin 管道**：`pbpaste | mdnotate` → stdin 文本直接在 app 中打开（类似「从剪切板打开」的体验）。
2. **`-h`/`--host <host>` 远端推送**：`mdnotate -h maiev.ts FILE` → 把本地文件推到远端 host 的
   `/tmp/mdnotate/<from-host-id>/<FILE>`，然后在远端执行 `mdnotate <该路径>`（远端也装了 mdnotate）。
   host 是 `~/.ssh/config` 里的 alias。
3. **`last` 子命令**：`mdnotate last [--host x]` → 找到当前 Claude Code 会话的 transcript，提取
   Claude 发给用户的最后一条消息全文，写成 .md 打开（本地或远端）。
4. **两个 Agent Skill**（源码放本仓库 `skills/`）：`/mdnotate <FILE...> [--host x]` 与
   `/mdnotate-last [--host x]`。

sh 做不了 2/3（JSONL 树解析、可靠的参数解析），**CLI 整体改写为 Rust**（用户已定，不引入第三种语言）。

## 2. 已确认的决策（用户拍板）

| 决策点 | 结论 |
|---|---|
| `-h` 与 `--help` 冲突 | `-h`/`--host` 表示 host；帮助只留 `--help` |
| 本地 stdin 进 app 的方式 | 写临时文件走现有文件链路（不给 app 加内容通道） |
| skills 位置 | 本仓库 `skills/` 目录（使用时需 symlink 到 `~/.claude/skills/`，文档写明） |
| `last` 的形态 | mdnotate CLI 子命令，CLI 用 Rust 重写 |
| 打包路线 | Resources 路线（见 §3），不用 externalBin |
| 空的非 tty stdin | 退回「聚焦 app」，不报错（避免 cron/重定向场景炸掉） |
| `-h` 时的位置参数 | 只收本地文件；`host:path` / `mdnotate://` 链接直接报错 |
| 远端 PATH 兜底 | 只兜 `/usr/local/bin` 和 `$HOME/.local/bin`（远端自定义安装目录不覆盖，报 command not found 即信号） |
| 跨调用同名文件推送 | 直接覆盖 —— 远端 app 按规则①刷新同一窗口，正是想要的 |

## 3. 打包路线：Resources（自签），不用 externalBin

**结论**：Rust 二进制仍落 `Contents/Resources/bin/mdnotate`（路径不变），构建时预签名。

调研事实（架构 agent 一手核实）：

- **externalBin + 公证的 bug 仍 open**：tauri#11992（2024-12 报告，干净复现：加 sidecar 公证即报
  "The signature of the binary is invalid"），无官方 fix。<https://github.com/tauri-apps/tauri/issues/11992>
- **tauri-bundler 签名扫描只覆盖 `Contents/{MacOS,Frameworks,Plugins,Helpers,XPCServices,Libraries}`**
  （`sign.rs` + `app.rs` 的 `add_nested_code_sign_path`，walkdir max_depth(1)），**不递归 Resources**。
  所以 Resources 里的 Mach-O：tauri 只做 resource seal 哈希、绝不重签 —— 我们**先把签好的二进制放进
  `src-tauri/resources/bin/mdnotate`（源文件位置）再跑 tauri build**，外层非 deep 签名不会破坏嵌入签名。
- 公证要求 bundle 里**每一个 Mach-O**（不分目录）都有 Developer ID 签名 + hardened runtime + timestamp。
- universal 不是 tauri 代劳的：自己 `cargo build` 两个 target + `lipo -create`。
- `beforeBundleCommand` 钩子跑在 Rust 编译后、打包（收集 resources、外层签名）前 —— 时机正确。

**选这条的理由**：externalBin 唯一优势（自动签）被 #11992 抵消且风险不受控；Resources 路线让
`cli_install.rs` **零功能改动**（symlink 路径不变，「app 升级命令自动更新」原样延续），签名逻辑自己写
但全程可控（标准 `codesign --force --sign <identity> --options runtime --timestamp`）。

## 4. Cargo 布局：`src-tauri/cli/` 独立 workspace 成员

两个架构 agent 在此有分歧，裁决如下：**独立薄 crate，不用同 package 第二个 `[[bin]]`** ——
后者会让 CLI 链接 `mdnotate_lib` 进而拖上整个 tauri/sqlx 依赖树。

- `src-tauri/Cargo.toml` 追加：

  ```toml
  [workspace]
  members = [".", "cli"]
  default-members = ["."]
  ```

  `default-members = ["."]` 是关键：`tauri dev`/`tauri build` 裸跑 `cargo build` 时不连带编 CLI，
  dev 热重载不变慢。

- 新增 `src-tauri/cli/Cargo.toml`：package/bin 名 **`mdnotate-cli`**（不能叫 `mdnotate`，
  会和主 GUI 二进制在 target 目录撞名）。命令名由 symlink 文件名决定，与 cargo 名无关。
  依赖：只有 `serde` + `serde_json`（版本与主 crate 对齐）。**零其它新依赖** —— open/ssh/defaults/
  date/hostname/ps 全部 `std::process::Command` 绝对路径调用，与 `read_remote_file`/`default_app.rs`
  的「问 OS 不问 crates.io」惯例一致。
- `mdnotate_lib` 的 `shell_quote`/`last_line`（各十几行）**复制进 cli crate**，注释指回
  `src-tauri/src/lib.rs` 出处 —— 与 `OPENABLE_EXTENSIONS` 双份同类的明确接受的重复
  （不 `pub` 导出，避免 CLI 依赖 mdnotate_lib）。
- `pnpm tauri dev` 不受影响：CLI 卡片在 Unbundled 下本来就不可用。

## 5. CLI 模块设计

```
src-tauri/cli/src/
  main.rs        wiring：RealSystem + env::args() + process::exit(run(...))
  cli.rs         纯参数解析：Mode{ShowHelp,ShowVersion,FocusApp,Open{host,positionals},Last{host}}
  locator.rs     classify(arg) -> Link | Remote{host,path} | Local；urlencode（RFC 3986 unreserved，逐字节）
  remote.rs      远端路径/命令构造（纯字符串）：sanitize_host_id、dedup_remote_name、push_and_launch_command
  paths.rs       ROOT="/tmp/mdnotate"、local_content_path(kind) -> {ROOT}/local/{kind}/{ts}-{pid}.md
  system.rs      System trait + RealSystem（唯一副作用缝）；app bundle 定位
  dispatch.rs    run(args, &dyn System)：全部编排 + FakeSystem 测试
  session_discovery.rs  四级 transcript 定位（移植）
  transcript.rs  JSONL 解析 + 最后一条消息提取（移植）
  quote.rs       shell_quote / last_line（从 lib.rs 复制，注释指回出处）
```

### 参数解析规则（`cli.rs`，纯逻辑）

- `--help` / `-v|--version` 只认第一个参数位（**保留老脚本的怪癖**：`mdnotate a.md --version`
  打开名为 `--version` 的文件）。
- `args[0] == "last"` → `Last`，只收 `-h HOST | --host HOST`，任何位置参数报错。
- 其余：从头扫描选项；`--` 结束选项扫描；`-h`/`--host` 吃下一个 token（缺失报
  `-h/--host requires an argument`）；**第一个位置参数出现后停止选项识别**（镜像老脚本，
  不做 getopt 式重排）；未知 `-*` 报 `unrecognized option 'X' — try 'mdnotate --help'`。
- 位置参数为空 + 无 host + 单独 `--` → `FocusApp`；stdin 判定在 dispatch 层做（需要 System）。

### System trait（唯一副作用缝）

`app_bundle`（`current_exe()?.canonicalize()?` + 向上找 `*.app`，替代 sh 的手工 symlink 循环）、
`app_version`（shell 出 `defaults read`）、`open_files`/`open_link`/`focus_app`、`stdin_is_tty`/
`read_stdin`、`read_file`/`write_file`（含 create_dir_all）、`cwd`、`timestamp`（`/bin/date
+%Y%m%d-%H%M%S`）、`pid`、`host_id`（`hostname -s` 后 sanitize）、`push_and_launch`、
`find_transcript`。`FakeSystem`（测试）记录调用序列 + 返回罐头数据。

### 行为规格表（实现与测试的唯一依据）

| 调用 | 外部命令序列 |
|---|---|
| `mdnotate` | `open -a <app>` |
| `mdnotate a.md b.log` | `open -a <app> -- a.md b.log`（一次调用） |
| `mdnotate -- -dashed.md` | `open -a <app> -- -dashed.md` |
| `mdnotate --` | `open -a <app>` |
| `mdnotate h:Sync/a.md` | `open "mdnotate://open?path=h%3ASync%2Fa.md"` |
| `mdnotate mdnotate://open?path=%2Fa.md` | `open "<原样>"`（整条直传） |
| `mdnotate h:a.md notes.md` | 链接遇到即 open，文件末尾批量 —— 与老脚本次序一致 |
| `mdnotate --version` | `defaults read <app>/Contents/Info CFBundleShortVersionString` → `mdnotate <ver>` |
| `mdnotate --nonsense` | stderr 报未知选项，exit 1 |
| `pbpaste \| mdnotate`（非 tty 非空） | 写 `/tmp/mdnotate/local/clipboard/<ts>-<pid>.md` → `open -a <app> -- <path>` |
| `mdnotate < /dev/null` | 空 stdin → 等同无参（聚焦） |
| `mdnotate -h maiev.ts report.md` | 单条 ssh（见下），stdin = 本地文件字节，**不落本地临时文件** |
| `mdnotate -h maiev.ts a/notes.md b/notes.md` | 两条 ssh；第二个重名自动 `notes-2.md`（本次调用内 HashSet 去重） |
| `pbpaste \| mdnotate -h maiev.ts` | 单条 ssh，远端 `/tmp/mdnotate/<local-host-id>/clipboard/<ts>-<pid>.md` |
| `mdnotate -h maiev.ts`（tty、无文件） | 报 `-h needs a file, or piped input`，exit 1 |
| `mdnotate -h maiev.ts other:x.md` | 推送前报错：`-h` 只收本地文件 |
| `mdnotate last` | 定位 transcript → 提取 → 写 `/tmp/mdnotate/local/last/<ts>-<pid>.md` → open |
| `mdnotate last --host maiev.ts` | 提取后直接推远端 `/tmp/mdnotate/<local-host-id>/last/<ts>-<pid>.md` |
| `mdnotate last extra.md` | 报 `last takes no file arguments`，exit 1 |
| `mdnotate -h`（缺值） | 报 `-h/--host requires an argument`，exit 1 |

多文件推送沿用老脚本的「全部尝试、记住失败」策略（status 累积，最后统一 exit 1）。

### 远端推送命令构造（`remote.rs`）

```rust
format!(
    "mkdir -p {} && cat > {} && env PATH=\"/usr/local/bin:$HOME/.local/bin:$PATH\" mdnotate -- {}",
    shell_quote(remote_dir), shell_quote(remote_path), shell_quote(remote_path)
)
```

- 执行：`ssh -o BatchMode=yes -o ConnectTimeout=10 -- <host> <整条字符串>`，stdin 管入内容字节，
  写完关闭再 wait。exit 255 vs 其它的翻译沿用 `read_remote_file` 的口径（255 = ssh 自己连不上）。
- **必须保持「拼一条字符串、一次 `.arg()`」的形状**：ssh 会把 host 之后的全部参数用空格 join 再交给
  远端 shell（`lib.rs:480-482` 已记录的坑），拆成多个 `.arg()` 看着像独立 argv 实际不是。
- 远端 PATH 前缀是**字面量** `/usr/local/bin:$HOME/.local/bin`（`$HOME` 留给远端 shell 展开），
  **不要**复用 `cli_install::well_known_dirs()` —— 那个解析的是本机 `$HOME`。
- `<from-host-id>` = 本机 `hostname -s` 输出经 sanitize（非 `[A-Za-z0-9._-]` → `_`）。

## 6. `last`：transcript 定位与提取（移植 plannotator session-log.ts）

参考：`/Users/reorx/Code/plannotator/apps/hook/server/session-log.ts`（零依赖 TS，886 行）。

**原样移植**：
- `project_slug_from_cwd`（cwd 非 `[a-zA-Z0-9-]` → `-`）；transcript 在
  `~/.claude/projects/<slug>/<session-id>.jsonl`（根目录可被 `CLAUDE_CONFIG_DIR` 覆盖）。
- 四级定位 fallback：①祖先 PID（`ps -eo pid=,ppid=`，最多 8 跳）找 `~/.claude/sessions/<pid>.json`
  （`{pid,sessionId,cwd,startedAt}`）→ ②全量 sessions 按 cwd 匹配取最新 `startedAt` →
  ③`projects/<slug>/` 下按 mtime 取最新 `.jsonl` → ④逐级父目录试 slug。
- JSONL 解析（坏行跳过）；`resolve_active_branch_indices`：transcript 是树（`parentUuid`），
  `/rewind` 重挂父节点而非截断，要从最新 uuid 条目沿 `parentUuid` 走回根。注意
  `parent_uuid: Option<serde_json::Value>`（不是 `Option<String>`）—— 非字符串非 null 的值要走
  「不可信 → 退线性扫描」分支，而不是让整行反序列化失败静默消失。
- 提取：从文件尾往回走，按 `message.id` 拼接流式分块；跳过 tool-only / hidden
  （`visibility: llm_only|assistant_only|hidden`）/ 系统噪音（`<command-name>`、`<system-reminder>`
  等前缀的伪 user 条目）；跨 turn 边界继续走（最新 turn 只有工具调用时取更早的）。
- 「fail open, never fail empty」：活跃分支上找不到（如刚 `/compact`）就退回不过滤分支重扫。

**砍掉**：droid/Factory 支持、25 条候选列表（`extractRecentRenderedMessages`）、
`findAnchorIndex`/`anchorText`、`lineNumbers` 簿记、Windows 分支。

**一处有意增强**：单条提取也应用活跃分支过滤（参考实现只在列表变体里做了，单条版是它的缺口）。

最终形状：`get_last_rendered_message(content: &str) -> Option<RenderedMessage { text: String }>`；
`resolve_current_session_log(sys, cwd) -> Option<PathBuf>` 组合进 `System::find_transcript`。

错误文案两条要分开：找不到会话（`could not find a Claude Code session for this directory`）vs
会话里还没有 assistant 回复（`no assistant reply found in the current session yet`）。

## 7. 测试策略（BDD：先写测试再实现）

- **纯逻辑单测**（每文件 `#[cfg(test)] mod tests`，风格同 `lib.rs`/`cli_install.rs`）：
  - `cli.rs`：老 `tmp/test-cli-script.sh` 19 条断言里关于解析的全部场景 + 新 flag 矩阵。
  - `locator.rs`：local/link/host:path/大写 scheme/`/notes/2026:08:11.md`（冒号在斜杠后仍本地）；
    urlencode 的 `&`、`#`、非 ASCII 逐字节。
  - `remote.rs`：sanitize_host_id、重名 `-2`/`-3`、`push_and_launch_command` 与字面量全等断言
    （含 shell_quote 嵌套层次，风格同 `applescript_quote` 的测试）。
  - `transcript.rs`：分支解析（null 根/缺失根/环/悬空父/非字符串 parentUuid → None）；分块拼接、
    跳过规则、分支过滤 + fail-open 回退、跨 turn 回走。
  - `session_discovery.rs`：slug、祖先 PID（闭包注入父表、环终止、跳数上限）、ps 解析；
    文件系统部分用 `std::env::temp_dir()` scratch（同 `cli_install.rs` 的 `scratch()`，零新 dev 依赖）。
- **dispatch 级测试**（FakeSystem 记录调用序列）：行为规格表逐行覆盖 —— 这是
  `tmp/test-cli-script.sh` 的正式替代。重点断言：stdin+host 时 `write_file` **从未被调**
  （推送不落本地）；`-h` 报错路径下 push/open 零调用。
- **留给打包后手动验证**：真 `.app` 里两跳 symlink 的 `current_exe().canonicalize()`（老 sh 测试
  的第一个 smoke 场景）、真 ssh/open。可写 `tmp/` 下的手动脚本对齐老测试思路。

## 8. 构建/发布链路改动清单（文件级）

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | 追加 `[workspace]`（members `[".", "cli"]`、default-members `["."]`） |
| `src-tauri/cli/**` | 新 crate（见 §4/§5） |
| `scripts/build-cli.sh`（新） | 环境变量驱动：`MDNOTATE_CLI_TARGETS`（逗号分隔 triple，缺省宿主）逐个 `cargo build --release --target <t> -p mdnotate-cli`；>1 个则 `lipo -create` 输出 `src-tauri/resources/bin/mdnotate`，否则 cp；`chmod +x`；若有 `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` → 临时 keychain 导入 + `codesign --force --sign <Developer ID> --options runtime --timestamp`，用完删 keychain；无凭据跳过签名。**做成幂等**（beforeBundleCommand 在 universal target 下跑几次未知） |
| `src-tauri/tauri.conf.json` | `build.beforeBundleCommand: "../scripts/build-cli.sh"`（注意 hook cwd 语义，实施时验证相对路径基准） |
| `scripts/build-signed.sh` | 理论零改动（已 export 签名变量）；追加一行 `codesign -dvv .../Resources/bin/mdnotate` 自查 |
| `.github/workflows/release.yml` | Build 步骤 env 加 `MDNOTATE_CLI_TARGETS: aarch64-apple-darwin,x86_64-apple-darwin`；Verify 步骤加 CLI 签名断言。`rustup target add` 已有；rust-cache `workspaces: src-tauri` 不用改 |
| `.gitignore` + 删除旧 sh | `src-tauri/resources/bin/mdnotate` 变构建产物；旧 sh 脚本删除（git 历史即回退方案） |
| `src-tauri/src/cli_install.rs` | **零功能改动**；仅注释措辞 script → binary |
| `CLAUDE.md` | 重写「`mdnotate` CLI」一节（sh 三坑作废、100755 约定作废、新增 build-cli.sh/stdin/--host/last 的说明）；「测试提示」里 test-cli-script.sh 的引用更新 |
| `tmp/test-cli-script.sh` | 作废（被 cargo test 替代），可留作历史或删除 |

三条构建路径的产物：裸 `pnpm tauri build` → 宿主架构、未签名（本地验证够用，与现状对齐）；
`build-signed.sh` → 宿主架构、已签名；release CI → universal、已签名。

## 9. 两个 Agent Skill（`skills/`）

`skills/mdnotate/SKILL.md`：

```markdown
---
name: mdnotate
description: Open one or more Markdown/text files in mdnotate, the local read-only viewer, optionally pushing them to a remote host first.
allowed-tools: Bash(mdnotate:*)
disable-model-invocation: true
---

# mdnotate

!`mdnotate $ARGUMENTS`

mdnotate is a read-only viewer. It opens its own window and reports nothing
back here. Once the command above has run, the document is open — do not
wait for a reply, and do not start any follow-up work unless the user asks
for one.
```

`skills/mdnotate-last/SKILL.md`：同结构，命令行是 `` !`mdnotate last $ARGUMENTS` ``，
description 为 "Open your own last message to the user in mdnotate, formatted as Markdown,
optionally on a remote host."。

- 与 plannotator 不同：**没有** JSON verdict 的「Your task」分支 —— mdnotate 只读、打开即结束。
- 仓库 `skills/` 不会被 Claude Code 自动发现，README/CLAUDE.md 写一行安装说明：
  `ln -s "$PWD/skills/mdnotate" "$PWD/skills/mdnotate-last" ~/.claude/skills/`。

## 10. 风险与首次构建验证点

1. `beforeBundleCommand` 在 `--target universal-apple-darwin` 下跑一次还是每子架构一次 —— 脚本幂等即兜住；第一次 CI 跑通后在本计划补记结论。
2. 预签名二进制经 tauri 外层打包后 `codesign -dvv` 的 `Authority=` 是否仍是我们的 Developer ID（源码级推断需在真实产物上验证一次）。
3. notarytool 对 Resources 下这个 Mach-O 是否放行 —— **发版前先完整跑一次 `build-signed.sh`（签名+公证+`spctl -a -vv`）再推 tag**。
4. `current_exe().canonicalize()` 对 PATH symlink 调用的解析 —— 打包后用两跳 symlink 手动 smoke（老 sh 测试的场景 1）。
5. 远端找不到 `mdnotate` 命令（自定义安装目录）→ exit 127 原样透出，`--help` 里提一句去远端重装到 well-known 目录。
6. `mdnotate -h`（想看帮助的老习惯）现在报「缺参数」—— 错误文案必须指向 `--help`。
7. skills 的 `!` 注入行为依赖 Claude Code 对 `allowed-tools: Bash(mdnotate:*)` 的放行；安装后实测一次两条 skill。

## 11. 实施顺序

1. **CLI crate**（BDD：先按 §7 写测试，再实现到全绿）—— 纯 cargo，不碰打包。
2. **打包接入**：build-cli.sh + tauri.conf + gitignore + 删旧 sh；裸 `pnpm tauri build` 验证
   ad-hoc 产物里 CLI 可用（symlink 手动 smoke）。
3. **skills**：两个 SKILL.md + 安装说明；symlink 到 ~/.claude/skills 实测。
4. **收尾**：`build-signed.sh` 全流程（含公证）验证 §10 的 1-3；更新 CLAUDE.md；code-review。

## 实施记录（2026-08-18）

计划整体照做，五处与计划不同，都是实测逼出来的：

1. **`beforeBundleCommand` 用不了 —— 改挂 `beforeBuildCommand` / `beforeDevCommand`。**
   §8 假设的时机是错的：`tauri-build` 的 build script 在 **cargo 编译时**就校验
   `bundle.resources` 的每条路径存在（`resource path 'resources/bin/mdnotate' doesn't exist`），
   而 `beforeBundleCommand` 要到编译**之后**才跑。实测第一次构建就挂在这里。
   现在两条 before 命令都是 `bash scripts/build-cli.sh && pnpm dev|build`。
   顺带答出了 §8 留的那个问号：**before 命令的 cwd 是仓库根目录**，不是 `src-tauri`。
   §10 风险 1（beforeBundleCommand 在 universal 下跑几次）随之作废。

2. **`find_transcript` 返回候选列表而不是单个路径。**
   参考实现的 `tryLogCandidates` 是逐个 log 试到有消息为止，只返回一条会丢掉这层
   robustness，而两条错误文案（找不到会话 / 会话里还没有回复）正好由「列表空」与
   「列表非空但都没有回复」区分。

3. **`resolve_by_ancestor_pids` 把参考实现的 ghost-session 分支也带过来了**
   （`/clear` 之后 `sessions/<pid>.json` 仍指向旧 session；更新的那个 transcript 若没有
   任何进程认领，它才是正在被打字的那个）。§6 说「四级 fallback 原样移植」，这条属于第一级
   的一部分。

4. **`locator::classify` 不带 `{host,path}` 载荷。** 没有任何调用方需要拆开——`-h` 的校验
   只问「是不是本地」，包链接只需要整条原文——留着就是 dead code。

5. **两处计划没写但顺手做了的收尾**：`cli_install.rs` / `lib.rs` 里的 `script` 标识符
   统一改名 `command`（那里现在指的是一个 Mach-O，不是 sh）；release workflow 加了一步
   `cargo test -p mdnotate-cli`（不能用 `--workspace`：那会连 app crate 一起编，而
   `tauri-build` 在 `pnpm build` 之前找不到 `../dist`）。

### 已验证

| 验的是什么 | 怎么验的 |
|---|---|
| 全部纯逻辑 + 行为规格表 | `cargo test -p mdnotate-cli`，111 条全绿（`dispatch.rs` 的 `FakeSystem` 逐行覆盖 §5 那张表） |
| 没有破坏既有的东西 | `pnpm test` 386 条、`cargo test -p mdnotate` 35 条全绿 |
| 真 .app 里的符号链接解析 | `tmp/smoke-cli.sh`：两跳链接 + 相对链接 + argv0 是裸词，`--version` 读到 bundle 的版本号 |
| 打包链路 | 裸 `pnpm tauri build --bundles app`：`Contents/Resources/bin/mdnotate` 就位且带可执行位 |
| `tauri dev` 没被拖坏 | 起了一次，`build-cli.sh` 先跑、前端和 app 照常起来 |
| stdin → 文档 → 窗口 | 管道喂一段文本，app 真的开出窗口，CGWindowList 读到的标题就是生成的文件名；测完 `lsregister -u`，确认 `.md` handler 仍是 `/Applications/mdnotate.app` |
| §10 风险 2/3（签名 + 公证） | `build-signed.sh` 全流程：`spctl -a -vv -t exec` 回 `accepted / source=Notarized Developer ID`，**公证没有因为 Resources 里多一个 Mach-O 被打回**；CLI 的 `codesign -dvv` 是我们那张 Developer ID + `flags=0x10000(runtime)` + Timestamp，**时间戳比 app 的早十几秒** —— tauri 确实只 seal 不重签，§3 的源码级推断在真实产物上成立；`codesign --verify --deep --strict` 通过 |

### ⚠️ 尚未验收（接手前先看这里）

**这三条都是「代码写完了、真机上一次都没跑过」，不要当成已经能用。**

1. **真 ssh 推送（`-h/--host`）一次都没跑过。** 需要一台装了 mdnotate 的远端机器，当时
   没定用哪台。`push_and_launch` 里只有构造出来的字符串被测过（`remote.rs` 的字面量断言），
   **真正没被验证的是**：ssh 的 stdin 管道会不会因为远端同时往 stderr 写而死锁、`env PATH=…`
   的 PATH 兜底在真实登录环境里够不够、远端 mdnotate 收到 `/tmp/…` 路径后开的是不是同一个
   窗口。验法：`echo hi | mdnotate -h <host>`，再 `mdnotate -h <host> some.md` 送两个重名文件。
   失败的话最可能是 exit 127（远端命令不在那两个目录里）。

2. **两个 Agent Skill 的 `!` 注入行为没实测**（§10 风险 7）。`~/.claude/skills/` 下的符号
   链接已经建好，但 Claude Code 要下一个 session 才发现它们。**没被验证的是**
   `allowed-tools: Bash(mdnotate:*)` 会不会被放行、`$ARGUMENTS` 传参对不对。

3. **`mdnotate` 命令当前不在本机 PATH 上**，`/Applications` 里那份还是 0.6.0 + 旧 sh。
   所以上面 1、2 两条要能验，得先：装上带新 CLI 的 app（刚构建的签名产物在
   `~/Library/Caches/cargo-target/release/bundle/`）→ 首页 Command Line 卡片装命令。
   **这一步会顶掉 brew 装的那份**，所以留给人来做。

另外两件不算风险但要知道的：`mdnotate last` 只在 FakeSystem 里跑过 —— transcript 的
**解析**有 111 条测试撑着，但**定位**（四级 fallback 在真 `~/.claude/` 上落到哪个文件）
从没在真机上跑过；`MDNOTATE_CLI_TARGETS` 的 universal `lipo` 路径只有 CI 会走，本地
一次没编过两个架构。

## 相关文档

- 参考实现：`~/Code/plannotator/apps/hook/server/session-log.ts`（transcript 定位与提取的 TS 原版）
- tauri externalBin 公证 bug：<https://github.com/tauri-apps/tauri/issues/11992>
- Tauri sidecar 文档（universal 需自行 lipo）：<https://v2.tauri.app/develop/sidecar/>
