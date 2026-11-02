---
created: 2026-11-02
tags:
  - app-icon
  - macos
  - verification
---

# 把定稿图标应用到 App，并建立可重复生成流程

## 概要

在当前 checkout 的 master 分支，将 Tauri 默认图标替换为已定稿的“纸页荧光笔”，新增小尺寸光学校正版和一条命令的资源生成流程。主图 SVG、主图画法、两个备选及 Tauri 配置保持原样。App 和前端构建成功，系统 Finder 图标接口读取打包产物后显示新图标；Quick Look 成功生成包内 `icon.icns` 的缩略图，但本机无法直接对 `.app` 生成缩略图，任务说明第 4 条的这项字面要求未通过，详情见验收与偏离说明。

## 修改的文件

- `design/app-icon/icons.mjs`：增加 `mdnotateSmall()`，在 `ICONS` 注册；没有改动 `mdnotate()`、公共绘图函数或备选。
- `design/app-icon/build-icons.mjs`：检查 resvg，导出 SVG，渲染 PNG，调用 Tauri 和 iconutil，覆盖原有桌面资源并清理暂存目录。
- `design/app-icon/mdnotate-small.svg`：生成的小尺寸版。
- `src-tauri/icons/`：原有 16 个文件全部重新生成，没有增删文件名或目录。
- `package.json`：只增加 `icons` script，没有增加依赖。
- `index.html`、`public/favicon.svg`、`public/vite.svg`：引用生成的主图 favicon，删除 Vite 占位图；`public/tauri.svg` 没有变化。
- `kb/docs/app-icon.md`：更新日期，说明小尺寸档位、生成步骤和资源集合，同时补全源文件索引。
- 本 session 总结。

## 生成命令

```bash
mise exec -- pnpm icons
# 等价入口：
mise exec -- node design/app-icon/build-icons.mjs
```

需要 macOS 的 iconutil、`/opt/homebrew/bin/resvg`（`brew install resvg`）和项目 pnpm 依赖。验证时使用 resvg 0.49.0、tauri-cli 2.11.4、项目 mise 固定的 Node 24。`export.mjs` 仍可单独导出所有 SVG，包括小尺寸版和两个备选。

## 完成标准与验证结果

- [x] **1. 一条命令和幂等性**：连续运行两次 `mise exec -- pnpm icons`，对全部图标、主图与小尺寸 SVG、favicon 做 SHA-256 校验，内容完全一致，`git status --porcelain=v1 --untracked-files=all` 前后完全一致。结果与哈希存放在证据目录的 `verification.txt`、`generated-sha256.json`，各次日志为 `icons-run-1.log`、`icons-run-2.log`。
- [x] **2. `.icns` 档位和尺寸**：用 `iconutil -c iconset` 解包全部 10 档，逐一验证像素尺寸与直接 resvg 渲染结果。16、16@2x、32 使用简化版；32@2x（64 px）起为主图；生成浅深两行的全档位对比图，并附 16 / 32 px 原尺寸和最近邻四倍放大对比。
- [x] **3. 文件集合和配置**：`src-tauri/icons/` 仍为原来的 16 个文件，全部生成物有新内容；`tauri.conf.json` 整份文件与 HEAD 字节一致，`bundle.icon` 没有改动。
- [ ] **4. 直接对 `.app` 执行 qlmanage 的缩略图要求未通过**：`mise exec -- pnpm tauri build --bundles app` 已成功（`tauri-build.log`）。但本机 `qlmanage -t -s 512 -o <dir> <app>` 一直等待，没有生成文件，最终只终止了本次启动的进程；`-i` 图标模式也如此。`-x` 服务模式（含 `-i`，以及指定 application-bundle UTI / StandardBundles generator 的尝试）明确返回 `No thumbnail created`。采用下面的替代验证确认实际交付目标，但没有把它计作原命令通过。
  - 打包位置：`/Users/reorx/Library/Caches/cargo-target/release/bundle/macos/mdnotate.app`。
  - `Info.plist` 的 `CFBundleIconFile` 为 `icon.icns`；包内资源与仓库 `.icns` 逐字节一致。
  - 对包内 `Contents/Resources/icon.icns` 执行 `qlmanage -x -t -s 512 -o <dir> <icns>` 成功，已查看生成的缩略图，确为新图标。
  - 用 AppKit 的 `NSWorkspace.shared.icon(forFile: <app>)` 读取 Finder 使用的系统文件图标，生成 512 px PNG，已查看并确认是新图标。未打开 App、Finder 或操作 Dock。
- [x] **5. 注销打包产物**：已执行 `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u /Users/reorx/Library/Caches/cargo-target/release/bundle/macos/mdnotate.app`，退出码 0。未拷入 `/Applications`、未启动该 App。
- [x] **6. 文档**：`kb/docs/app-icon.md` 的“网格与小尺寸”“应用到 App”已写成现状，`updated` 为 2026-11-02。
- [x] **7. favicon 和前端构建**：`public/favicon.svg` 与定稿主图 SVG 字节一致，`index.html` 正确引用；`mise exec -- pnpm build` 通过，日志为 `frontend-build.log`。

附加检查：主图 SVG 与两个备选和 HEAD 字节一致；禁止修改的三个文件无差异；`git diff --check` 通过。按任务说明不新增业务单测、不运行 formatter / style linter。验收前 `agent-inspect-session.sh` 报告 context 11%，没有启动浏览器、模拟器或桌面自动化会话。

## 对比图与缩略图

全部证据放在 `tmp/2026-11-02-apply-app-icon/`（gitignore，不提交）：

- `iconset-comparison.png`：16 / 32 / 64 / 128 / 256 / 512 / 1024 px，浅色和深色底各一行，另带 16 / 32 px 最近邻四倍放大。
- `small-comparison.png`：主图缩小与简化版在 16 / 32 px 的原尺寸及四倍放大，浅色和深色底各一行；简化版的标题、高亮与气泡更清楚。
- `icon.icns.png`：qlmanage 对打包产物包内图标生成的 512 px 缩略图。
- `finder-app-icon.png`：NSWorkspace 直接读取 `.app` 后生成的 Finder 系统图标。
- `unpacked.iconset/`：从提交的 `.icns` 解出的全部档位。
- `verify-icons.mjs`、`compare-icons.mjs`、`finder-icon.swift`：本次验收与对比图的可复跑脚本。
- `qlmanage-remote.log`、`qlmanage-remote-icon.log`、`qlmanage-remote-generator.log`：对 `.app` 的失败结果；`qlmanage-resource.log`：对包内资源的成功结果。

## 自行决定与计划差异

1. **小尺寸具体尺寸**：自行确定加粗、加大的数值；移除细正文线，保留主图网格、色彩及标题 / 高亮 / 评论的相对构图，主图一个像素未改。
2. **独立 `32x32.png` 也用简化版**：让独立 32 px 资源与 `.icns` 对应档一致；其余 PNG、Windows 图标继续由 Tauri 从主图生成。
3. **先暂存再筛选复制**：Tauri 输出到仓库 `tmp/` 下的唯一临时目录，只复制原有桌面文件白名单，最后删除临时目录；因此不必先污染 `src-tauri/icons/` 再删除移动端资源。与计划的最终文件集合一致，也避免留下额外的 `64x64.png`。
4. **Quick Look 改用包内图标并交叉查 Finder 系统图标**：直接对 `.app` 的原验收命令在本机无法工作；没有重启或杀掉用户的系统 Quick Look 进程、没有清空全局缓存。保留失败日志及替代证据，明确不声称原命令通过。

## 注意事项

- `.icns` 里 16@2x 与 32 是两个独立的 32 px 槽位，二者都必须使用简化版；64 px 主图属于 32@2x。
- 系统 iconutil 往返会改变传统 16 / 32 槽位的半透明边缘 RGB。本次逐像素确认所有 alpha 与不透明像素完全一致；16 px / 32 px 的归一化平均绝对误差分别为 0.00574268 / 0.00216551，16@2x 和其余所有档位为 0。不能用整个 PNG 的字节或严格零误差来判断传统槽位是否放错图。
- 资源生成无需重新设计主图，也不应对已导出的 SVG 手工修改。
- 已结束自己启动的 qlmanage 进程，其余验证命令均已退出；没有待清理的自建浏览器或模拟器。

## 需要 Claude 更新的文件

按用户约束，本次没有修改 `AGENTS.md`、`kb/next-up.md`、`kb/known-issues.md`。

- **AGENTS.md**：`design/app-icon/` 的目录说明可补充“小尺寸版和 `build-icons.mjs`”，开发命令可增加 `mise exec -- pnpm icons`；现有 `kb/docs/app-icon.md` 索引有效，不需要新建索引。
- **kb/next-up.md**：本次没有新增需要定时检查的项目。若要坚持任务第 4 条的字面验收，仍需后续查明 macOS 26 的 `.app` Quick Look 缩略图行为；当前已有包内缩略图和 Finder 系统图标证据。
- **kb/known-issues.md**：本次没有新增会影响 App 使用或稳定性的问题，无需修改。

## 遗留问题

- 第 4 条要求的“直接对 `.app` 生成 qlmanage 缩略图”未通过；App 构建、包内资源及 Finder 实际系统图标均已验证。
- reorx-apps 网站的图标和 accent 色属于另一个仓库，本次没有修改。

## 范围外发现

- 前端构建已有单个 JS chunk 超过 500 kB 的 Vite 警告，构建成功；本次只涉及图标资源，没有顺手做代码拆包。
- `kb/next-up.md` 的编辑模式、列表编号与侧栏评论的人工验收，以及 `kb/known-issues.md` 的两个问题均与本次任务无关，没有处理。

## 相关文档

- [应用 App 图标任务说明](../plans/2026-11-02-apply-app-icon.md) —— 本次执行依据。
- [App 图标](../docs/app-icon.md) —— 本次更新生成流程与小尺寸现状。
- [验收手册](../docs/verification.md) —— 参考打包产物路径和清理规则。
- [macOS 集成](../docs/macos-integration.md) —— 参考未签名产物的安装限制。
- [图标设计归档](2026-11-02-app-icon-design.md) —— 参考既定主图、备选及小尺寸设计理由。
