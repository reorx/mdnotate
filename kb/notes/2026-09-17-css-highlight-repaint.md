---
created: 2026-09-17
tags:
  - webkit
  - css-highlight-api
  - find
  - bug
---

# CSS Custom Highlight API 在 WebKit 上不重绘：删掉的高亮留在屏幕上

## 问题

⌘F 查找后，清空查询或关闭搜索栏，命中的字仍然蓝着，不消失。

`use-doc-search.ts` 原来的做法是标准教科书写法：每次搜索 `CSS.highlights.set(name, new Highlight(...ranges))`，清除时 `CSS.highlights.delete(name)`。逻辑上没错——两个动作都调了，JS 里 `CSS.highlights` 也确实空了。留在屏幕上的是**过期的像素**：WebKit 没有把那些字所在的区域标脏，等到滚动或别的重绘才会消失。

## 实测（macOS 26，系统 WebKit，Safari 与 WKWebView 同一份）

复现页 `tmp/2026-09-17-find-highlight-repaint/repro.html`，八种调用序列各涂一行、2 秒后做清除动作，截图看残留：

| 序列 | 结果 |
| --- | --- |
| `set(k, H(r))`（对照） | 蓝 ✓ |
| `set(k, H(r))` → `set(k, new Highlight())` | **残留** |
| `set(k, H(r))` → `delete(k)` | **残留** |
| `set(k, H(r))` → `set(k, empty)` → `delete(k)` | **残留** |
| `h = H(r); set(k, h)` → `h.clear()` | 清掉 ✓ |
| `set(k, H(r))` → `delete(k)` → `set(k, empty)` | **残留** |
| 两个 key 换 active（都是 `set` 已有 key） | 旧 active 仍深蓝 |
| `set(k, H(r1, r2))` → `set(k, H(r3))` | r1 r2 仍蓝 |

`fix.html` 验证替代方案：`Highlight` 对象注册一次，之后只用它自己的 `add` / `delete` / `clear`——五种切换（空对象后 add、clear 后 add 别处、两个对象间挪 active、单个 delete、关闭时 clear）全部正确。

## 原因

WebKit 源码（修复前）`HighlightRegistry::setFromMapLike` 只在 **key 是新的** 时才 `repaint()`；`Highlight::addToSetLike` / `removeFromSetLike` / `clearFromSetLike` 则逐个 `repaintRange`。`remove()` 按源码应该重绘，但实测不重绘——发行版与 main 快照不同，不必深究，以实测为准。

上游修复是 WebKit 319154@main（bug 321567，2026-08-13，Megan Gardner）：`set` 已有 key 时对新旧两个对象都 `repaint()`，且 `repaintRange` 额外重绘 containing block。2026-09 的 macOS 26 系统 WebKit 还没带上。

## 做法

`src/lib/find-painter.ts`：`createFindPainter(registry, createHighlight)` 建两个对象并 `set` 两次，之后 `paint()` = `clear()` 再逐个 `add()`，`clear()` = 两个都 `clear()`。永不 `delete`、永不换对象。`tests/find-painter.test.ts` 用假注册表锁住「只 set 两次、零 delete、对象身份不变」。

注意测试测的是**调用形状**，不是重绘——重绘只能在 Safari 里开复现页用眼睛看。修复能修好的前提是「mutate 对象会重绘」这条在目标 WebKit 上成立；等系统 WebKit 带上 319154 之后两种写法都对，这个模块也不必回退。

## 副作用

- 每次搜索是 `clear()` 全部旧 range + `add()` 全部新 range，5000 条上限下各触发一次 `repaintRange`（只是标脏，不是画），可接受。
- 注册表里长期挂着两个空的 `Highlight`，无害。
