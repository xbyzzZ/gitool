---
feature: workbench-history-redesign
status: delivered
updated: 2026-10-13
branch: feat/workbench-history-redesign
commits: 3d408c5..2d97b51
---

# 提交工作台与历史视图视觉复刻（design/ 原型）

## Report

**已构建**

- 工作台与历史视图按 `design/` 两个原型完整复刻：`media/main.css` 重写为固定深色设计 token（纯黑背景、SF 字体栈、胶囊按钮、lane 色板），不再引用 `--vscode-*` 主题变量；`render.ts` 骨架全部改用内联 SVG，codicon 依赖与资源文件一并移除。
- 工作台：三态自定义勾选、整行点选（accent 竖条）、彩色状态徽章、悬浮"打开 diff"、组折叠动画、空态；提交坞含字符计数、Tab 缩进、空信息抖动校验、拖条 min150/max40% 视口；舍弃按钮为两步内联确认，语义仍仅限未跟踪文件（系统废纸篓 + 宿主模态确认）。
- AI 设置由宿主 Quick Pick 改为 webview 内弹层：新增 `setAiModel` 消息（'auto' 清除持久化）与 state 消息的 `aiModels` 字段；档位仍由 webview 端持久化。`selectAiSettings` 与 QuickPick 流程删除，`ai-model-selector.md` 已标注被本特性取代。
- 历史视图：返回链接 + 标题 + 客户端搜索（subject/author/完整哈希）+ 分支 chip；条目双行结构、refs 徽章、hash 复制 toast；graph 改为覆盖层 SVG，沿用真实 lane 拓扑，merge/当前提交节点样式按原型；单条目展开。

**验证**

- `npm run check`（tsc + eslint strictTypeChecked + vitest）：35 个测试文件 419 项全部通过。
- `npm run build`（esbuild，含 media/commit.js）：通过；`git diff --check`：通过。
- `npm run test:vscode`：**PRE-EXISTING** 失败——main 基线（3d408c5）在 VS Code 1.141.0 下以同样方式失败（.code-workspace 被当作 JS 入口加载），与本次改动无关。
- 独立审查：首轮 1 个关键问题（舍弃武装态 aria-label 与行为相反）+ 若干次要项；修复提交 2d97b51 经复审全部关闭，分支获批准。

**过程记录**

- 并行子代理拆分按文件所有权切分（CSS/骨架 → 客户端+协议 ∥ 历史渲染器），关键在于先冻结 DOM 契约（ID/类名清单）再并行；期间 `tsc --noEmit` 作为跨代理契约校验器。
- 原型弹层是独立页面语境，移植时保留了扩展特有的运行态：操作反馈条、加载状态行、多仓库切换、CSP+nonce；这些以新增类名融入原型体系而非改造原型类名。
- 原型的两步舍弃在原型里第二次点击只是取消，移植语义是第二次点击执行；审查发现并修复了由此产生的 aria-label 反转问题——复刻交互时文案必须按实际语义重写。
- 舍弃按钮刻意不接 `git checkout/restore` 式跟踪文件舍弃，保持仓库既有的废纸篓安全语义。
- 交付后修订：历史 graph 的 SVG 用内联 `style` 属性上色，被 webview CSP（`style-src` 无 `unsafe-inline`）整体拦截导致线不显示——改为 `.graph-sN/.graph-fN` 类上色；JS 侧 `el.style` CSSOM 赋值不受 CSP 限制，两类写法要分清。
- 交付后修订：固定深色在真实浅色主题下不可用，结构色改回 `var(--vscode-*, 原型兜底)` 映射；视觉骨架（圆角、间距、动效）与配色来源解耦后互不影响。

## [S1] 问题

当前提交工作台与历史视图使用 VS Code 主题变量 + Codicon，视觉风格陈旧。`design/commit-workbench.html` 与 `design/commit-history.html` 给出了新原型：Apple 风格固定深色配色、胶囊按钮体系、自定义 SVG 图标、三态勾选、AI 设置弹层、历史搜索与哈希复制等。本次按两个原型完整复刻到扩展 webview。

## [S2] 设计

### 已定决策（用户确认）

1. **配色**：结构色（背景/表面/前景/弱化/边框/强调）跟随 VS Code 主题变量（`--vscode-sideBar-background`、`--vscode-editorWidget-background`、`--vscode-textLink-foreground` 等），原型十六进制值作为兜底；语义色（success/warn/danger）与 lane 色板保持原型固定值。（2026-10-13 修订：初版为固定深色十六进制，用户试用后改回跟随主题。）
2. **文件图标**：保留现有动态 `file-icon-theme-loader`（跟随用户 `workbench.iconTheme`）；主题未提供图标时兜底为原型中的中性线条文件 SVG。不采用打包 `design/icons/` 的方案。
3. **AI 设置**：改为 webview 内弹层（popover），覆盖 `ai-model-selector.md` 中宿主 Quick Pick 的旧决策（该 spec 相应标注已被本特性取代）。弹层 `position:fixed` 并 clamp 在视口内，处理侧边栏窄宽度溢出。
4. **范围**：工作台与历史视图两个原型都复刻；历史视图仍与工作台共存于同一 webview，以视图内切换代替原型中的页面跳转。

### 工作台（commit-workbench.html）

- 布局自上而下：工具栏（44px）、仓库条（34px）、可滚动分组变更列表、5px 分隔拖条、提交坞（默认 240px，min 150px，max 40% 视口高）。
- 工具栏左组：刷新（spin 反馈）、全选/清空选择（按当前状态切换 title）、舍弃（危险色，**两步内联确认**：首次点击按钮变为"确认舍弃？"胶囊，再次点击才执行）、分隔线、历史入口。右组：拉取（ghost 文字按钮）、推送（secondary 胶囊）。**移除 webview 内的"修改远程"按钮**，`gitool.editRemote` 命令保留在命令面板。
- 舍弃语义不变：仍只作用于未跟踪文件（TrashService，系统废纸篓，宿主模态确认）；内联两步确认为额外的 webview 层防护，第二次点击后走现有 `trash` 消息流程。无可用未跟踪选中项时按钮禁用。
- 变更列表：三组（变更/未进行版本管理的文件/冲突文件），组头 chevron + 自定义三态 `.cbx`（unchecked/checked/mixed，SVG tick/dash）+ 组名 + 计数 + 冲突组警示文案；`grid-template-rows` 折叠动画。文件行整行可点（`role=checkbox`），选中行显示左侧 accent 竖条与底色；悬浮/聚焦时显示"打开 diff"链接；状态字母为彩色徽章 `.st[data-s]`（M 黄/A 绿/D 红/R 蓝/T、? 灰/! 红）。
- 提交坞：textarea 右下角字符计数；Tab 键插入两空格缩进；空信息提交时按钮抖动（`.shake`）+ 输入框红环 1.4s，无 toast。底栏左为 AI 控件组（生成按钮 + 设置按钮），右为 `已选择 N / M` 统计 + "提交并推送"（secondary）+ "提交"（primary），按钮顺序与现状相反，按原型。
- 执行反馈统一为按钮加载态（`.is-loading` + 内嵌 spin），沿用现有 requestId ack 流程。
- 空态：成功色对勾圆 + "没有待提交的变更"（`.changes.is-empty` 切换）。
- 窄屏断点 520px / 380px 按原型媒体查询降级。

### AI 设置弹层与协议扩展

- state 消息新增可选字段 `aiModels?: readonly {id,name,description?}[]`（宿主异步获取 `listAiModels()` 后随 state 下发，获取失败则省略，webview 弹层显示"暂无可用模型"）。
- 新增 webview→host 消息 `setAiModel { type, repositoryId, modelId }`（exact-key 校验；`modelId` 为非空字符串，`'auto'` 表示自动选择即清除持久化）。宿主写入 `AiModelSelectionStore` 后以 state 消息确认。
- 档位（density）维持纯 webview 端持久化（`vscode.setState`），不新增 host 消息；弹层内切换档位即时生效并更新生成按钮 tooltip。
- `selectAiSettings` 消息与宿主 Quick Pick 流程删除。
- 弹层交互：点击设置按钮切换开合；点击外部或 Escape 关闭；`aria-haspopup/expanded/menuitemradio` 完整。

### 历史视图（commit-history.html）

- 头部：返回链接（chevron + "提交工作台"）、标题"提交历史"、搜索输入框（客户端过滤 subject/author/hash，无结果显示"没有匹配的提交"）、当前分支 chip。
- 列表条目：两行结构（row-top：chevron + subject + refs 徽章；row-meta：hash 复制按钮 + 作者 + 相对时间）。HEAD 徽章为 accent 胶囊；本地分支为绿边徽章；远程引用为云图标弱化样式。当前提交条目 `.is-current` 显示 accent 左竖条。
- 同时仅一个条目展开；展开区为文件列表（彩色 status-block + 文件图标 + 名称 + 目录 + 悬浮"打开 diff"），合并提交显示"合并提交 · 无文件变更"。文件点击走现有 `openCommitDiff` 流程。
- Graph：覆盖层 `#graph-host`（`position:absolute`，pointer-events:none），按条目 `offsetTop` 动态绘制 SVG；lane 数据沿用现有 `history-service.buildGraph` 真实拓扑与 `lane-color-N` 色板（替换为原型 `--lane-1..6` 色值），节点样式按原型：普通实心圆、merge 空心双环、当前提交发光环；展开/搜索/resize 后重绘。
- hash 复制：`navigator.clipboard.writeText` 优先，`execCommand('copy')` 兜底，底部 pill toast 提示"已复制 <hash>"（1.6s）。
- 窄屏 520px 断点：`--graph-w` 收窄、隐藏作者/远程文字/目录/返回文字。

### 不变的契约

- 严格 CSP + nonce、`messages.ts` exact-key 校验、`version` 乐观锁、requestId ack、全中文文案。
- 提交/推送/拉取/重试/反馈语义不变；安全语义不变（未跟踪不自动选中、废纸篓、绝不 force push）。
- 提交信息按仓库持久化、多仓库切换、activity badge 均保持现状。

## [S3] 范围外

- 不新增对已跟踪文件的 `git checkout/restore` 式舍弃（原型"舍弃"按钮仅复用现有未跟踪文件废纸篓语义）。
- 不采用打包 Material 图标方案；`design/icons/` 不进 VSIX。
- 历史搜索仅客户端过滤已加载的 50 条，不做服务端搜索/分页。
- 不改变 `commit`/`push` 的 git 语义与 `--only` pathspec 行为。
- ~~不做亮色主题适配~~（2026-10-13 修订：结构色已改为跟随 VS Code 主题，亮色主题自动可用）。

## Tasks

- [x] T1: 重写 `media/main.css` 为原型设计 token + 全部组件样式（工作台 + 历史 + 弹层 + toast + 断点），更新 main.css 契约测试 — acceptance: 契约测试通过且样式键与原型 token 一致 (covers: S2)
- [x] T2: `src/webview/render.ts` HTML 骨架按原型复刻（工具栏/仓库条/提交坞/历史头部，自定义 SVG 图标替换 Codicon，保留 CSP+nonce）— acceptance: render 单测通过，HTML 含原型结构与 `data-od-id` 等价标识 (covers: S2)
- [x] T3: `commit-change-renderer.ts` 复刻（三态 cbx、行选中 accent 条、彩色状态徽章、悬浮 diff 链接、折叠动画、空态）— acceptance: renderer 单测更新通过 (covers: S2; depends: T1)
- [x] T4: `commit-client.ts` + `commit-workbench-layout.ts` 交互复刻（全选切换、两步舍弃、字符计数、Tab 缩进、空信息抖动、拖条 min150/max40%）— acceptance: 对应单测通过 (covers: S2; depends: T2, T3)
- [x] T5: AI 弹层 + 协议扩展（`messages.ts` 增 `setAiModel` 删 `selectAiSettings`、state 增 `aiModels`、view-provider 接线、webview 弹层组件）— acceptance: messages/view-provider 单测通过，弹层交互在 Extension Host 测试或单测中可验证 (covers: S2; depends: T2)
- [x] T6: `history-renderer.ts` 复刻（搜索过滤、hash 复制 toast、覆盖层 graph、徽章样式、单展开）— acceptance: history 单测更新通过 (covers: S2; depends: T1)
- [x] T7: 清理失效代码（edit-remote 按钮、Quick Pick AI 流程、旧样式类）并同步 README/ai-model-selector.md 标注 — acceptance: 无死引用，`npm run check` 通过 (covers: S2; depends: T2-T6)
- [x] T8: 全量验证 `npm run check` + `npm run build` + `npm run test:vscode` — acceptance: 全部通过并记录 (covers: S2; depends: T7)
