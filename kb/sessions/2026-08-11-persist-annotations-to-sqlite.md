---
created: 2026-08-11
tags:
  - sqlite
  - annotation
  - persistence
  - tauri
  - sqlx
  - migration
---

# 标注持久化到 SQLite：重开文档自动恢复高亮与评论

## 概要

本次 session 把此前只存在于内存的标注（highlight / comment）落到 SQLite，实现"下次打开同一文档时自动恢复"。这是上一个 session 遗留问题清单里的第一条。

开工前就三个必须由用户拍板的问题做了澄清，用户的选择是：**① 标注与 Recent 记录完全级联**（`ON DELETE CASCADE`，代价是 Recent 超过 50 条自动裁剪时最老那条的标注会被静默销毁，这是明确接受的行为）；**② 存内容 hash，文档变了就丢弃**（不做按 quote 重定位）；**③ Recent 列表显示标注数量徽标**。

实现上有一个必须先搞清楚的约束：`use-text-annotator` 只在 effect 创建时 `setAnnotations` 一次（deps 只有 `enabled` / `documentKey`），异步晚到的标注根本不会被渲染。因此 `open-doc.ts` 必须在文档进 store **之前**把标注取好，用 `openDoc(doc, annotations)` 一次性写入——这是本次唯一对"写 store 在前、写库在后"原则的例外，所以读库失败时降级为裸开文档 + banner，绝不把文档挡在门外。

验证阶段发现并修掉了一个会打爆所有已有用户数据库的真 bug（见"注意事项"）。最终浏览器模式与真实 SQLite 双路验证通过，101 个测试全绿。

## 修改的文件

### 数据库与 Rust 端

- `src-tauri/src/lib.rs` — 新增 migration v2 建 `annotations` 表：`doc_id` 外键指向 `recent_docs.id` 且 `ON DELETE CASCADE`，`doc_hash` 记录标注创建时的文档内容 hash；列名用 `start_offset` / `end_offset`（`END` 是 SQL 关键字）。同时把 migration v1 的 SQL 字符串恢复为逐字节原样并加注释说明其被 checksum

### 前端数据层

- `src/lib/db.ts` — **新建**，抽出共享 SQLite 连接。`Database.load` 每次调用都会新开一个 pool，两个表模块各调一次会开两个
- `src/lib/annotations-db.ts` — **新建**，annotations 表的 IO：`restoreAnnotations`（select + 删除失效行，返回丢弃条数）、`recordAnnotation`（`ON CONFLICT(id) DO UPDATE` 只更新 comment/updated_at）、`forgetAnnotation`、`forgetDocAnnotations`、`countAnnotations`；含 localStorage 降级
- `src/lib/annotate.ts` — **新建**，改动标注的唯一漏斗：`createAnnotation` / `updateComment` / `deleteAnnotation`，先写 store 后写库，写库失败只出 banner
- `src/lib/annotations.ts` — 加 `StoredAnnotation` 类型与 `splitStaleAnnotations` 纯规则（hash 不匹配即失效）
- `src/lib/recent-docs.ts` — `OpenDoc` 加 `contentHash` 字段；新增 `NewDoc = Omit<OpenDoc, 'contentHash'>`，入口只构造 `NewDoc`
- `src/lib/recents-db.ts` — 改用共享连接；删除/清空的降级路径手动模拟级联；给裁剪与删除加上"会连带销毁标注"的注释
- `src/store.ts` — `openDoc(doc, annotations?)` 支持随文档一次性写入标注

### 打开路径与 UI

- `src/lib/open-doc.ts` — `open()` 改为 async：先算 `contentHash`、await `restoreAnnotations`，再 `openDoc`；丢弃条数与读库失败通过 banner 提示。新增 `openSampleDoc()`，把 DEV 示例文档也收进唯一入口
- `src/components/Home.tsx` — 示例文档改调 `openSampleDoc()`，不再直接操作 store
- `src/components/Reader.tsx` — 标注回调从 store action 改为 `annotate.ts` 的三个函数
- `src/components/RecentList.tsx` — 与 `listRecents` 并行取 `countAnnotations`，标题旁显示琥珀色数量徽标

### 测试与文档

- `tests/annotations.test.ts` — 新增 6 个 `splitStaleAnnotations` 行为测试（BDD，先写后实现）
- `AGENTS.md` — 更新目录结构；新增"标注持久化 / 标注失效判定 / 标注必须与文档同时进 store / migration SQL 被 checksum"四条约束；补充 SQLite 侧的调试手法
- `tmp/doc-hash.mjs` — 验证脚本（tmp/ 已 gitignore），用应用自己的 `fileDocId` / `hashText` 算出真实 docId 与 contentHash，便于从 shell seed 数据库行

## 注意事项

### migration 的 SQL 文本是被 checksum 的（本次踩到的真 bug）

把 migration 1 的 SQL 字符串**仅仅重新缩进 4 格**（因为要把 `vec![Migration{...}]` 改成两个元素），就导致 `Database.load` 整个失败。原因是 sqlx 为每条已应用的 migration 存 sha384 checksum，源码里的 SQL 文本一变就报 `VersionMismatch`。而前端的连接 promise 是 memo 的，一次失败之后所有库操作全线静默——**这会打爆每一个已有用户的库，不只是本地 dev**。

结论：`migrations()` 里旧条目的字符串是冻结的（连缩进），只能往后追加新 version。已在 AGENTS.md 记录。

### 排查"前端不碰库"的手法

现象是应用在跑、webview 也连着 vite，但数据库毫无动静。有效的判断顺序：

1. `lsof -p <pid> | grep mdnotate.db` — 有没有数据库句柄，没有就说明 `Database.load` 根本没成功
2. `sqlite3 <db> "SELECT version FROM _sqlx_migrations"` — 版本停在哪一条
3. `lsof -i :1420` — 确认 webview 进程确实连上了 vite（排除"页面根本没加载"）

另外 `-shm` / `-wal` 的 mtime 会暴露"连接建立过但随即失败"这种中间状态。

### 标注锚点为什么只能丢弃、不能盲目恢复

recogito 的 `reviveTextSelector` 只按 `start`/`end` 偏移遍历文本节点还原 Range，**完全不校验 `quote`**。所以文件在外部被改过之后按旧偏移恢复，会静默高亮到错误的句子——错的高亮比没有高亮更糟。这是选择"hash 不匹配即丢弃"的直接理由。

### 真实 SQLite 侧的验证方法

Tauri 窗口驱动不了，但可以：`pnpm tauri dev` 起实例 → `target/debug/mdnotate <file.md>` 触发 single-instance 转发 → 用 `tmp/doc-hash.mjs` 算出真实 docId/hash → `sqlite3` seed 一条正确 hash 和一条错误 hash 的标注行 → 再次转发打开该文件 → 断言应用保留前者、删除后者。这样能在无法点 UI 的情况下验证 `restoreAnnotations` 的两条真实 SQL 路径。

注意路径会被 `canonicalize`：`/tmp/x.md` 落库是 `file:/private/tmp/x.md`。

### 浏览器模式仍是最高效的 UI 验证途径

创建标注、评论、删除、Clear All 级联、失效丢弃 banner 全部在 `pnpm dev` + agent-browser 下验证（localStorage 降级）。注意 banner 出现会把正文下推约 27px，导致此前记录的鼠标坐标失效——先 dismiss 再取坐标。

## 遗留问题

- **应用侧 FK 级联未直接观测**：`ON DELETE CASCADE` 在 schema 层验证过（`PRAGMA foreign_key_list` + 手工删除测试 + 孤儿插入被拒绝），应用连接开启 `foreign_keys` 是依据 sqlx 源码默认值（`sqlx-sqlite/src/options/mod.rs:185`）推断的，没能让应用自己触发一次父行删除（需要在 Tauri 窗口点 UI，驱动不了）。
- **Recent 50 条裁剪会静默销毁标注**：用户明确选择的行为，但如果日后觉得难以接受，可以让裁剪 SQL 跳过有标注的文档（相当于自动 pin）。
- **FK 时序竞态**：`open()` 里 `recordOpen()` 不 await，理论上"打开后几毫秒内就完成划词"会撞上 FK 约束失败。实际下限是用户读文本 + 选中的秒级时间，且真失败会出红 banner（已验证孤儿插入确实被 FK 拒绝），未做同步机制。
- **浏览器降级的裁剪不级联**：localStorage 降级里 `recordOpen` 裁剪到 50 条时不会删对应标注，与 SQLite 的级联行为不一致。仅影响 dev。
- **文档改动后标注全丢**：本次刻意不做按 quote 的模糊重定位。若日后要做，`splitStaleAnnotations` 就是插入重定位逻辑的位置。
- **`hashText` 是 32 位 FNV-1a**：沿用剪切板去重那套，理论碰撞后果是"文件改了但标注没被丢弃"。

## 相关文档

- [从零搭建 mdnotate](2026-08-10-bootstrap-mdnotate-tauri-app.md) — 本次实现的正是该 session 遗留问题里的"标注不持久化"
