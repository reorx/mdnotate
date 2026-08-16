---
created: 2026-08-16
tags:
  - ime
  - keyboard
  - bug
  - react
---

# IME 组字期间的 Enter / Escape 被误判

## 问题

用中日韩输入法打字时，浏览器在 composition（组字）期间**照常派发 keydown**——因为输入法自己要用这些键：Enter 把预编辑文本原样上屏，Escape 丢弃候选词，方向键走候选列表。它们和普通按键一样带着 `key: 'Enter'` / `'Escape'` 到达 handler。

于是只判 `e.key` 的 handler 会在用户还在打字的时候动手。本仓库实际发生的：

- 标注评论框里打中文，按 Enter 想把英文单词原样上屏 → **评论被保存、弹窗关闭**，半句话就这么存进去了
- 同一个框里按 Escape 想取消候选词 → **整条评论被丢弃**（`dismissPopup` 的语义就是丢弃改动）

只有用 CJK 输入法的人会碰到，英文自测永远碰不到，所以这类 bug 极易长期存活。

## 判定手段

- **`KeyboardEvent.isComposing`**（标准）：`compositionstart` 之后、`compositionend` 之前的键盘事件为 `true`
- **`keyCode === 229`**：`isComposing` 之前的历史约定，部分输入法仍然这么报，留作兜底

### React 的坑（本次实测确认）

React 19 的**合成事件根本没有 `isComposing`**——不只是值不对，是属性不存在，类型里也没有。所以 `!e.isComposing` **恒为 true**，写了等于没写，而且编译期不报错。必须读 `e.nativeEvent.isComposing`。

| 读法 | 组字中的 Enter 上观测到的值 |
| --- | --- |
| `'isComposing' in syntheticEvent` | `false`（属性不存在） |
| `syntheticEvent.isComposing` | `undefined` |
| `syntheticEvent.nativeEvent.isComposing` | `true` ✅ |
| `syntheticEvent.keyCode` | `229` ✅（合成事件**有**镜像 keyCode） |

绑在 `document` 上的 listener 拿到的是原生事件，`isComposing` 就在事件自己身上，**没有 `nativeEvent` 可读**。两种形状同时存在，是 `src/lib/keys.ts` 存在的全部理由。

### WebKit 的坑：光看事件是不够的（⚠️ 对本项目是决定性的）

上面那套判定在 Chromium 上够用，**在 WKWebView 上不够**——而 mdnotate 只跑在 WKWebView 里。

macOS 上的 WebKit 把 `compositionend` 派发在**导致它的那个 keydown 之前**。也就是说确认候选词的那个 Enter 到达 handler 时：

- `isComposing` 已经是 `false`
- `keyCode` 是普通的 13

**事件上没有任何东西表明它曾属于一次组字**，和用户真心想提交的 Enter 完全无法区分。

这不是陈年旧闻。WebKit 修正顺序的开关是 `InputMethodUsesCorrectKeyEventOrder`（`condition: PLATFORM(MAC)`），2026-06-15 的 commit `c30586a251`（bug 317127，"Disable the new input method behavior as it's causing too many issues"）把它**关了回去**，trunk 上至今 `default: false`（已核对 `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`）。参考 [WebKit bug 165004](https://bugs.webkit.org/show_bug.cgi?id=165004)。

所以必须自己盯着组字：`watchComposition()` 在 `main.tsx` 里装一次 document 级（capture）的 `compositionstart` / `compositionend` 监听，`compositionend` 之后**延迟 50ms 才清标志**，那一窗口内的按键仍算输入法的。50ms 的取值：两个事件来自同一个原生事件、相隔微秒级，足够覆盖；同时短到人不可能在窗口内敲出一个有意的 Enter。同样的做法见 Dify、nuxt/ui 的 `useIMEGuard`（后者直接引用了上面那个 WebKit bug 号）。

## 做法

抽 `src/lib/keys.ts` 一个落点，而不是每处打补丁——这个 bug 的本质是「默认写法就是错的」，只有单一落点才不会在下一个输入框里重现：

- `isImeComposing(event)` — 基础谓词。`event.nativeEvent ?? event` 同时吃两种形状，判 `isComposing === true || keyCode === 229`，事件上什么都没有时再问一次组字观察器
- `isSubmitEnter(event)` — Enter 且非 Shift 且非组字
- `isCancelEscape(event)` — Escape 且非组字
- `watchComposition(document)` — 组字观察器，`main.tsx` 调一次；返回 teardown 供测试用

改动的 handler 见 AGENTS.md「键盘按键」一节。

## 测试

- `tests/keys.test.ts`（node）— 纯函数矩阵：合成事件 / 原生事件 × `isComposing` / `keyCode 229` / Shift
- `tests/ime-keys.dom.test.tsx`（jsdom）— **回放真实事件序列复现 bug**，两种引擎顺序各一组：
  - Chromium：`compositionstart` → `change` → `keydown{Enter, isComposing:true, keyCode:229}` 断言不保存
  - WebKit：`compositionstart` → `change` → **`compositionend`** → `keydown{Enter, isComposing:false, keyCode:13}` 断言不保存
  - 等过 50ms 窗口后 `keydown{Enter}` 断言保存——窗口只盖一个按键，不是把 Enter 扣住
  - 另有两个 describe 锁住上面那张 React 观测表和原生事件形状

先跑得到 3 红（view Enter / view Escape / draft Enter），加 WebKit 组后再得 2 红，修完 381 全绿。把 `isImeComposing` 里的 `return settling` 改成 `return false` 做变异验证，恰好且仅有那 2 条 WebKit 用例转红——组字观察器确实在承重。

**jsdom 30 尊重 `KeyboardEventInit.isComposing`**，所以这类 bug 完全可以在 jsdom 里回放，不需要真机输入法。这是本仓库第一个（也刻意是唯一一类）组件测试，为此加了 `jsdom` + `@testing-library/react` 两个 devDependency，`vite.config.ts` 的 `include` 放宽到 `.tsx`，环境仍默认 node、只有这个文件用 `@vitest-environment jsdom` docblock 切过去。

## 没被自动化覆盖的

- **真机输入法的手感**：测试回放的是浏览器实际派发的事件序列（顺序按 WebKit 当前行为写），与真实行为同构，但最终要人工用中文输入法在评论框里敲一次 Enter / Escape 确认
- **50ms 这个数**：来自「两个事件同源、相隔微秒级」的推理加上其它项目的既有取值，没在真机 WKWebView 上量过。若真机上仍偶发漏判，先怀疑它，调 `keys.ts` 的 `SETTLING_MS` 一处即可
- **`<form>` 的隐式提交**：`OpenFileCard`（两处）和 `CliInstallCard` 靠原生 Enter 提交，没有 keydown handler，所以谓词管不到。组字期间 WebKit 会不会隐式提交没有验证；真出问题的表现是拿半截路径去打开、报个错，不丢数据。刻意**没有**加投机性的 `preventDefault()`——在组字的 Enter 上 preventDefault 有可能反而打断输入法自己的上屏

## 来源

- [chhoumann/quickadd#243](https://github.com/chhoumann/quickadd/issues/243)
- 同类修复的完整技术 note（含 React 实测数据与排查清单）：`../vibe-reader-hn/kb/notes/2026-08-16-ime-composition-enter-key.md`
