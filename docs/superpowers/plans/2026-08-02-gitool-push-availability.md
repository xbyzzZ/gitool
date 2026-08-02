# Gitool 推送可用性与紧凑反馈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除重复的未跟踪状态与成功提示，按真实仓库状态禁用两个推送入口，并用最后一个可独立回滚的提交精简历史引用显示。

**Architecture:** `RepositoryViewModel` 增加 `hasRemote`，作为提交 Webview 与原生历史标题栏共享的远程配置事实。提交 Webview 使用可单测的纯展示函数计算反馈和按钮状态；原生历史标题栏由独立上下文键控制器把服务状态映射到 `gitool.canPushAll`。历史引用仅修改 TreeItem 描述文本，保持现有原生 TreeView 和图标优先级。

**Tech Stack:** TypeScript 6、VS Code Extension API 1.125、Vitest 4、esbuild。

## Global Constraints

- 默认使用简体中文；代码保持英文。
- 不修改提交历史拓扑、展开方式、拉取或刷新行为。
- 没有远程时两个推送入口保持显示但禁用，“仅提交”仍然可用。
- 完整成功不显示文字；失败、部分推送失败和重试入口继续显示。
- 历史引用显示优化必须是最后一个独立 Git 提交，视觉验收不通过时可单独回滚。
- 不使用子代理，不提交 `.serena/project.yml`。

---

### Task 1: 精简未跟踪描述与成功反馈

**Files:**
- Create: `src/webview/commit-view-state.ts`
- Modify: `src/views/change-tree-provider.ts`
- Modify: `src/webview/commit-client.ts`
- Test: `test/unit/change-tree-provider.test.ts`
- Test: `test/unit/commit-view-state.test.ts`

**Interfaces:**
- Produces: `operationFeedback(operation: OperationState): OperationFeedback`，完整成功返回空消息，部分推送失败保留提交哈希、错误和重试状态。
- Produces: `commitControlState(model: RepositoryViewModel, input: CommitControlInput): CommitControlState`，供 Task 2 接入 `hasRemote` 后计算“提交并推送”状态。

- [ ] **Step 1: 写失败测试**

在 `change-tree-provider.test.ts` 断言未跟踪节点描述为 `未跟踪`，不包含 `?`。新建 `commit-view-state.test.ts`，覆盖 `commit-succeeded` 保留成功信息并要求显现反馈、`push-failed` 保留错误与重试。样式测试覆盖提交视图内容在自身边界内滚动。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/change-tree-provider.test.ts test/unit/commit-view-state.test.ts --reporter=dot`

Expected: 未跟踪描述仍含 `?`，且展示状态模块尚不存在。

- [ ] **Step 3: 实现最小修复**

从未跟踪文件的描述数组中移除 `changeLabels.untracked`。把 `operationFeedback` 和按钮状态计算移入 `commit-view-state.ts`；`commit-succeeded` 保留现有成功信息并标记需要显现，`push-failed` 保持现有反馈。提交视图改为内部滚动，成功状态出现时将反馈行滚动到可见区域。

- [ ] **Step 4: 运行定向测试与静态检查**

Run: `npx vitest run test/unit/change-tree-provider.test.ts test/unit/commit-view-state.test.ts test/unit/main-css.test.ts --reporter=dot && npm run typecheck && npm run lint`

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/views/change-tree-provider.ts src/webview/commit-client.ts src/webview/commit-view-state.ts media/main.css test/unit/change-tree-provider.test.ts test/unit/commit-view-state.test.ts test/unit/main-css.test.ts
git commit -m "界面：精简变更状态并完整显示提交反馈"
```

### Task 2: 按仓库状态控制两个推送入口

**Files:**
- Create: `src/views/push-availability-context.ts`
- Modify: `src/domain/view-model.ts`
- Modify: `src/services/repository-registry.ts`
- Modify: `src/webview/commit-view-state.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Test: `test/unit/commit-view-state.test.ts`
- Test: `test/unit/push-availability-context.test.ts`
- Test: `test/unit/package-contributions.test.ts`
- Test: `test/unit/extension.test.ts`
- Test: repository model helpers that construct `RepositoryViewModel`

**Interfaces:**
- Produces: required `RepositoryViewModel.hasRemote: boolean`，由当前仓库 `repository.state.remotes.length > 0` 计算；无当前仓库时为 `false`。
- Produces: `canPushAll(model: RepositoryViewModel): boolean`。
- Produces: `PushAvailabilityContext`，监听 `service.onDidChange` 并串行调用 `setEnabled(canPushAll(model))`。

- [ ] **Step 1: 写失败测试**

覆盖以下状态：无仓库、无远程、游离 HEAD、未信任、操作中、已同步、落后、领先、无上游且有远程。Webview 状态测试断言无远程时“仅提交”可用而“提交并推送”禁用。贡献点测试断言 `gitool.pushAll.enablement === 'gitool.canPushAll'`。扩展测试断言激活时注册上下文键更新并在状态变化后更新。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/commit-view-state.test.ts test/unit/push-availability-context.test.ts test/unit/package-contributions.test.ts test/unit/extension.test.ts --reporter=dot`

Expected: 缺少 `hasRemote`、上下文控制器和命令 `enablement`。

- [ ] **Step 3: 实现共享远程状态与按钮计算**

在 `RepositoryViewModel` 和 registry 映射中加入 `hasRemote`。`commitControlState` 仅在 `canCommit && model.hasRemote && !model.detached` 时启用“提交并推送”。

- [ ] **Step 4: 实现历史区上下文键**

`canPushAll` 仅在受信任、有仓库、有远程、非游离、非运行中，并且 `sync.ready` 为 `ahead > 0 && behind === 0` 或 `sync.no-upstream` 时返回 `true`。在扩展激活时创建控制器，使用 `setContext` 写入 `gitool.canPushAll`；在 `package.json` 为 `gitool.pushAll` 增加 `enablement`。

- [ ] **Step 5: 运行定向测试、全量测试和构建**

Run: `npm run check && npm run build`

Expected: 类型检查、ESLint、全部单元测试和构建通过。

- [ ] **Step 6: 提交功能修复**

```bash
git add src/domain/view-model.ts src/services/repository-registry.ts src/webview/commit-client.ts src/webview/commit-view-state.ts src/views/push-availability-context.ts src/extension.ts package.json test/unit
git commit -m "功能：按仓库状态控制推送入口"
```

### Task 3: 最后独立精简历史引用显示

**Files:**
- Modify: `src/views/history-tree-provider.ts`
- Test: `test/unit/history-tree-provider.test.ts`

**Interfaces:**
- Consumes: 现有 `CommitRef` 与 `commitIcon` 优先级。
- Produces: HEAD 引用直接显示分支名，其他引用名称保持不变。

- [ ] **Step 1: 写失败测试**

把 HEAD 与远程同节点的期望描述改为 `许博阳 · 5 分钟前 · newest · main · origin/main`，并保留 HEAD、本地、远程、普通提交的原生图标优先级测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/history-tree-provider.test.ts --reporter=dot`

Expected: 实际描述仍包含 `HEAD main`。

- [ ] **Step 3: 实现最小显示变化**

让 `refLabel` 对所有引用返回 `ref.name`，不修改引用顺序、图标、节点结构和详情展开。

- [ ] **Step 4: 运行定向与全量验证**

Run: `npx vitest run test/unit/history-tree-provider.test.ts --reporter=dot && npm run check && npm run build`

Expected: 全部通过。

- [ ] **Step 5: 单独提交视觉变化**

```bash
git add src/views/history-tree-provider.ts test/unit/history-tree-provider.test.ts
git commit -m "界面：精简提交历史引用显示"
```

### Task 4: 真实运行时、打包与安装验收

**Files:**
- Test: `test/vscode/suite/extension.test.ts`（使用现有真实仓库验收，不修改测试文件）

**Interfaces:**
- Consumes: Tasks 1–3 的提交结果。
- Produces: 合并工作树上的 VSIX 和本机已安装扩展。

- [ ] **Step 1: 运行真实 Extension Host**

Run: `env -u ELECTRON_RUN_AS_NODE npm run test:vscode`

Expected: 扩展激活、双仓库、精确提交、推送和失败重试用例全部通过。

- [ ] **Step 2: 检查并生成 VSIX**

Run: `npm run package`

Expected: `gitool-file-commit-0.2.0.vsix` 生成，包内不含 `media/main.js` 或 `media/history.js`。

- [ ] **Step 3: 覆盖安装**

Run: `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension "/Users/xbyzzz/code_home/work_space/gitool/gitool-file-commit-0.2.0.vsix" --force`

Expected: VS Code 报告扩展安装成功。

- [ ] **Step 4: 最终边界检查**

Run: `git status --short && git log --oneline -6`

Expected: 只有用户的 `.serena/project.yml` 保持未跟踪；历史引用显示是最后一个独立提交。
