---
feature: ai-model-selector
status: delivered
updated: 2026-08-10
branch: codex/ai-model-selector
commits: 2b51c59..9935b52
---

# AI 模型选择

## Report

**What was built** — 提交信息区新增固定尺寸的机器人按钮，用户点击后通过 VS Code 原生 Quick Pick 在自动模式和当前可用语言模型之间选择。显式选择按仓库保存在工作区状态中，切换仓库或重建 Webview 后恢复；按钮标题与无障碍标签同步展示当前模型。

生成链路每次重新枚举模型：自动模式优先 Copilot，显式模式严格匹配模型 ID，失效时明确要求重新选择且不静默回退。即使当前没有任何可用模型，用户仍可打开仅含自动模式的选择器并清除失效选择。

**Verification** — `npx vitest run test/unit/commit-view-state.test.ts test/unit/view-provider.test.ts test/unit/commit-message-ai-service.test.ts test/unit/ai-model-selection-store.test.ts test/unit/messages.test.ts test/unit/render.test.ts test/unit/repository-service.test.ts`：7 个文件、165 项通过；`npm run check`：类型检查、ESLint、30 个测试文件与 313 项测试全部通过；`npm run build`：通过；`git diff --check`：通过；独立复审：通过，无关键问题。`env -u ELECTRON_RUN_AS_NODE npm run test:vscode` 未完成验收：沙箱内 VS Code 1.131.0 在 macOS `RegisterApplication` / `NSApplication` 初始化阶段 `SIGABRT`，沙箱外窗口启动后未进入测试回调并持续挂起，因此不能宣称真实 GUI 与 Extension Host 已验收。

**Journey log**

- 首轮失败测试准确暴露模型枚举、指定模型、持久化、消息协议和页面入口缺口。
- 将自动优先 Copilot 的策略下沉到 AI 服务，使全部模型仍可供用户选择且优先级可单元测试。
- 独立审查发现空模型列表会阻止清除失效选择；修复为始终提供自动模式并补充边界测试。
- 单选 Quick Pick 使用 `$(check)` 标记当前项，未使用只对多选有效的 `picked`。
- Extension Host 阻断发生在 macOS GUI 初始化或测试回调之前，未将其误判为功能失败或 GUI 通过。

## [S1] 问题

Gitool 的 AI 提交信息功能会优先查询 Copilot 模型，并固定使用返回列表中的第一个模型。用户无法查看或指定 VS Code 已授权给扩展的其他语言模型，也无法确认当前是否处于自动选择状态。

## [S2] 设计

提交信息操作区新增固定尺寸的“选择 AI 模型”按钮。用户点击后才调用 VS Code Language Model API 获取当前可用模型，并使用原生 Quick Pick 展示“自动选择（推荐）”和每个可用模型。自动选择继续保持“优先 Copilot、否则使用任意可用模型中的第一个”的现有策略。

显式选择按仓库存入扩展工作区状态，记录模型 ID 和当时的展示名称；切换仓库或重建 Webview 后恢复对应选择。界面通过按钮标题和无障碍标签展示当前选择，不在页面初始化时枚举模型，避免非用户触发的授权请求。

生成请求携带当前仓库选择的模型 ID。服务每次生成前重新查询可用模型，并严格匹配该 ID；模型已不可用时明确报错，禁止静默切换。选择“自动选择”会删除该仓库的显式选择。取消模型选择不改变原状态。

模型列表和消息输入都在宿主侧重新校验；Webview 不能注入未授权模型。模型选择期间不触发生成、不修改提交信息，也不占用 Git 写操作锁。

## [S3] 范围外

- 不增加 Gitool 独立 API Key 或第三方模型端点配置。
- 不改变精简、标准、详细三档信息密度及其星级图标。
- 不自动提交 AI 生成的文案。
- 不在自动模式下引入基于上下文长度、价格或质量的模型评分。

## Tasks

- [x] T1: 扩展 AI 服务的模型描述、枚举和指定模型合同 — acceptance: 自动模式优先 Copilot、否则使用首个可用模型，显式 ID 精确命中，失效 ID 返回明确错误（covers: S2）
- [x] T2: 增加按仓库持久化的模型选择状态 — acceptance: 仓库之间互不覆盖，自动模式删除显式选择，非法存储值被忽略（covers: S2）
- [x] T3: 接入模型选择按钮、原生 Quick Pick 和严格消息校验 — acceptance: 用户点击后可选择自动或具体模型，取消不改变状态，按钮准确展示当前选择（covers: S2; depends: T1, T2）
- [x] T4: 将显式模型贯通到提交信息生成并更新使用说明 — acceptance: 生成请求携带当前仓库模型 ID，README 说明选择、持久化和失效行为（covers: S2, S3; depends: T1, T2, T3）
- [x] T5: 完成定向测试、完整检查、构建与独立审查 — acceptance: 新增行为测试通过，`npm run check` 和 `npm run build` 通过，审查无关键问题（covers: S2, S3; depends: T4）
