---
feature: history-graph-redesign
status: in-progress
updated: 2026-08-10
branch: codex/ai-toolbar-redesign
commits: f77f786..待交付
---

# 提交历史图改版

## Report

- 实现：历史视图迁移为独立 Webview，使用稳定路径颜色绘制多轨分叉、合并与穿越边；HEAD、本地和远程引用分别展示，提交详情继续支持文件展开与第一父提交 Diff。
- 兼容性：完整对象 ID 仅接受 SHA-1 的 40 位或 SHA-256 的 64 位；远程符号引用 `*/HEAD` 被过滤。
- 验证：`npm run check` 通过 32 个测试文件、327 条测试；`npm run build`、`npm run package` 和真实 Extension Host 3 个场景通过。
- 审查：独立复审范围 `4bf652c..ae16685`；修复构建产物 ESLint 清单、SHA-256 消息校验、历史操作错误反馈和轨道压缩换色后通过。
- 交付：版本 `0.2.5`，VSIX 输出到主项目目录；源码仍位于隔离分支，未合并到 `main`。

## [S1] 问题

当前提交历史使用原生 TreeView。历史服务虽然计算了提交所在轨道和父提交轨道，但 TreeItem 每行只能显示一个图标，无法绘制跨行连续的分支、分叉和合并路径。本地分支、上游远程分支与 HEAD 只能拼接在灰色描述文字中，提交主题、作者、时间、哈希和引用互相争抢窄侧栏宽度。

## [S2] 设计

仅将“提交历史”改为独立 Webview View；“提交信息”和“当前变更”保持现有实现。历史行采用双层信息结构：第一行显示提交主题和引用标签，第二行显示作者、相对时间和短哈希。左侧按真实拓扑绘制连续轨道、提交圆点、分叉和合并曲线，轨道宽度根据当前可见 lane 数在限定范围内变化。

历史服务输出每个提交行的顶部轨道、底部轨道、穿越边和父提交边。引用读取必须从完整 ref 名称区分 `refs/heads/*` 与 `refs/remotes/*`，当前本地分支标记为 HEAD，其他本地分支和所有远程分支分别标记，过滤远程符号引用 `*/HEAD`。

引用标签使用 VS Code 主题变量：HEAD 为主要强调，本地分支为分支标签，远程分支为低强调远程标签。长标题和长引用单行省略，完整内容保留在 title。提交行支持键盘焦点和展开；展开后按文件名、目录和状态显示文件，点击文件继续打开历史 Diff。

加载、空数据和失败状态保留；仓库切换或版本变化时清理展开详情。标题栏的拉取、推送和刷新命令保持不变。预览版本升级到 0.2.5，VSIX 输出到主项目目录供人工比较，但不合并到 main。

## [S3] 范围外

- 不实现提交搜索、筛选、分页或无限滚动。
- 不增加标签、stash、cherry-pick、rebase 或历史改写操作。
- 不改变 Git 提交读取顺序、50 条默认限制、提交详情和 Diff 语义。
- 不修改提交信息、当前变更、提交和推送流程。

## [S4] CSP 兼容布局修正

历史行不得依赖被 Webview CSP 禁止的内联 `style` 属性。多轨 SVG 的 `width` 属性作为第一列固有宽度，网格使用 `max-content`、固定箭头列和可收缩正文列；提交主题、引用和元数据必须在启用严格 CSP 时仍保持可见。

## Tasks

- [x] T1: 修正引用分类并扩展拓扑行模型 — acceptance: 本地、远程、HEAD 分类准确，合并提交输出可连续绘制的行边且有单元测试（covers: S2）
- [x] T2: 实现历史图渲染与交互 — acceptance: 多轨 SVG、引用标签、双层提交信息、展开文件和 Diff 消息均有渲染或协议测试（covers: S2; depends: T1）
- [x] T3: 将历史视图迁移为独立 Webview — acceptance: package 和扩展只为 historyView 注册 Webview Provider，标题命令及状态反馈保持（covers: S2; depends: T2）
- [x] T4: 完成 0.2.5 预览交付 — acceptance: 完整检查、构建、Extension Host、VSIX 清单和独立审查通过，主分支不变化（covers: S2, S3; depends: T3）
- [ ] T5: 修复严格 CSP 下历史正文不可见 — acceptance: 历史行不输出内联样式，网格不依赖自定义属性且渲染测试覆盖正文可见结构（covers: S4; depends: T2）
