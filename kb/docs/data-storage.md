---
created: 2026-09-28
tags:
  - sqlite
  - migrations
  - settings
  - recent
---

# 数据存储：SQLite 与设置

写给要加表、加设置项，或者要去库里查东西的人：数据存在哪、三张表各自的规则、哪些改动会让已安装的 app 再也打不开数据库。

## 存在哪

| 构建 | 数据目录 |
|---|---|
| 正式版 | `~/Library/Application Support/top.ideachat.mdnotate/` |
| dev 构建 | `~/Library/Application Support/top.ideachat.mdnotate.dev/` |

里面是 `mdnotate.db`（SQLite）和 `settings.json`。

### dev 构建有自己的 identifier

debug 构建在启动时把 identifier 改成 `top.ideachat.mdnotate.dev`，正式构建不动。Tauri 里所有「每个 app 一份」的东西都从运行时的 identifier 派生 —— 数据目录、single-instance 的 socket（`/tmp/<identifier>_si.sock`）—— 所以只改这一个字段就全部分开，前端零改动。

不分开的后果：dev 和已安装的正式版共用同一个库。dev 应用了新的 migration 之后，装着的旧版本再打开就会因为「库里有一条它不认识的 migration」而拒绝加载数据库，整个前端从此读不到库。

代价：dev 构建下「是否默认 App」永远显示未注册，因为它拿 `.dev` 的 identifier 去问系统。这块本来就只能用打包产物验。

## Migration 是冻结的

schema 由 Rust 侧声明，前端第一次连接数据库时执行。

**已经发布的 migration，SQL 文本一个字符都不能改，包括缩进。** sqlx 对每条已应用的 migration 存了校验和，源码里的文本变了，数据库就拒绝加载。改 schema 只能往后追加新的 version。

前端只有一个数据库连接，在 `db` 模块里。每次调用加载函数都会新开一个连接池，而 migration 只在首次加载时跑，所以不要在别处自己连。

连接失败会被记住：一次失败之后所有读写全线静默。排查方法见 `verification.md`。

写权限 `sql:allow-execute` 不在插件的默认权限集里，要单独声明。

## 三张表

### recent_docs —— 最近打开

主键是文档 id，去重规则就编码在 id 里（本地 `file:…`、远端 `ssh:host:…`、剪切板 `clip:<内容 hash>`），所以三种来源共用一条 upsert。

- 上限 50 条，插入后按打开时间裁剪。
- 只有剪切板文档存正文。本地和远端文件每次打开都重新读取。
- 列表查询不取正文列。

### annotations —— 标注

外键指向 `recent_docs`，级联删除。**Recent 的 50 条裁剪会连带销毁标注**，这是明确选择的行为。

每行存一份创建时的文档内容哈希，用于判断标注是否还对得上当前内容。详见 `annotations-and-export.md`。

### path_prefixes —— 记住的目录前缀

和标注相反，**故意不挂外键**。一个目录比它装着的任何一篇文档都活得久；如果跟着 Recent 一起被裁，就等于「读满 50 篇文档之后补全列表被清空」。

prefix 文本自己当主键，「用过就浮到最前」就是一条更新使用时间的 upsert。上限同样 50 条。

## 设置

设置是通用的键值存储：一个设置项一个条目，加新设置项不会重写旧的。Tauri 下存在 `settings.json`，浏览器模式降级到 `localStorage`。

**读回来的值一律逐字段校验。** 越界的数值收回范围内，类型不对的退回默认值。手改坏 `settings.json` 不该让阅读器打不开。

目前的设置项：导出模板（外层与内层）、排版（Markdown 与纯文本各一套）、主题、侧栏宽度、命令行的自定义安装目录。

主题另有一份同步可读的缓存，原因见 `theme-and-typography.md`。

## 浏览器模式

只跑前端、没有 Tauri 后端时：Recent 走 `localStorage`，剪切板走浏览器 API，首页多一个仅开发可见的「打开示例文档」入口。用来在纯浏览器里迭代界面。

## 代码位置

- `src-tauri/src/lib.rs` —— `migrations()`
- `src-tauri/src/channel.rs` —— dev identifier
- `src/lib/db.ts` —— 唯一连接
- `src/lib/recents-db.ts`、`annotations-db.ts`、`path-prefixes-db.ts` —— 三张表的 IO
- `src/lib/settings.ts` —— 设置读写与校验（`tests/settings.test.ts`）
- `src/lib/tauri-env.ts` —— 是否在 Tauri 里
