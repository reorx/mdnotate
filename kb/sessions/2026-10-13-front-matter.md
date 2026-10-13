---
created: 2026-10-13
tags:
  - markdown
  - front-matter
  - reader
---

# Front Matter 字段列表

参考 `~/Code/devblocks/react-spa/SKILL.md`，只通过 `head` 读取文件头。用户选择字段列表展示，相关单元测试由用户后续补充，本次未新增测试文件。

## 实现

- `src/lib/front-matter.ts`：识别文件头闭合 YAML，支持 BOM、CRLF 与 YAML 结束标记；使用 `yaml` 解析字段，标量解码、集合保留源文本，无效输入回退为原始代码块。
- `FrontMatter.tsx` 与正文样式：按源文件顺序展示字段，长中文描述换行，列表与嵌套映射使用等宽文本；窄正文列切换上下布局，两套主题共用 prose token。
- `Reader.tsx`：在转换框线表格之前拆出元数据，正文仍走现有 Markdown 渲染器；搜索、划词、目录和源码切换保持现有路径。
- `annotationContentHash`：仅含 Front Matter 的 Markdown 追加渲染版本后缀，让旧偏移经现有恢复逻辑失效，避免错位；docId、原文复制、统计不变。

## 验证

- `mise exec -- pnpm build` 通过；Vite 仍提示主 bundle 超过 500 kB。
- `mise exec -- pnpm test`：24 个测试文件、395 个既有测试全部通过。直接调用 shell 的 Node 26 会触发 jsdom / localStorage 兼容问题，使用项目指定 Node 24 后通过。
- agent-browser：示例长描述、深浅主题、窄列上下布局、嵌套元数据、源码切换、搜索元数据和真实鼠标划词弹窗通过。
- 临时 smoke 脚本核对普通 Markdown、不闭合块、正文分隔线、代码围栏、BOM / CRLF / EOF、重复字段、无效 YAML、折叠描述、false / 0 / null / 空字符串、循环 alias、哈希版本。
- impeccable 检测只报告现有 blockquote 的左边框；此次新增样式未产生检测项。
- 截图归档：`tmp/2026-10-13-front-matter/`。

## 用户补充测试的入口

- `splitFrontMatter`：文件头范围、结束符、换行及不闭合回退。
- `parseFrontMatter`：字段顺序、标量、折叠字符串、集合缩进、无效 YAML 与 alias。
- `annotationContentHash`：Front Matter 版本后缀、普通 Markdown / 纯文本保持原始哈希。
