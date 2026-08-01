# Gitool 提交工作台重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有线性 Git 提交侧边栏重构为可折叠、可拖动的三分区工作台，并加入文件图标、活动栏徽标、提交图、远程同步和 VS Code 原生 AI 提交信息生成。

**Architecture:** 保留 `RepositoryRegistry + RepositoryWriteCoordinator` 的状态和写入安全边界，新增纯函数领域模块、只读 `HistoryService`、写入 `SyncService` 和可替换的 `CommitMessageAiService`。Webview 拆出布局状态、文件图标与历史渲染模块；扩展宿主负责 Git、VS Code Language Model API、差异 URI 和活动栏徽标。

**Tech Stack:** TypeScript 6、Node.js 22、VS Code Extension API 1.125+、VS Code 内置 Git API、本机 Git、esbuild、Vitest、Mocha Extension Host。

## Global Constraints

- 所有界面文案、代码注释、测试说明、文档和 Git 提交信息使用简体中文；代码标识符保持英文。
- 固定保留“提交信息、当前变更、提交历史”三个功能区，三个区域均可折叠，两条分隔线可拖动。
- 未选文件及既有暂存状态保持不变；未跟踪文件默认不选中；冲突、未信任工作区和过期状态禁止写入。
- 拉取遵循仓库已有 Git 配置；不自动 stash、不强制推送、不自动解决冲突。
- AI 只使用 VS Code Language Model API，不增加 API Key 配置，不自动提交，只分析当前勾选文件。
- 不读取网络图标资源；不依赖用户文件图标主题私有实现。
- 自动测试不得调用真实语言模型配额。
- `.serena/` 属于用户未跟踪目录，不修改、不暂存；`.vscodeignore` 仅增加排除规则。
- 每个任务遵循测试先行，并只提交该任务列出的文件。

---

## 文件结构

新增文件：

- `src/domain/change-groups.ts`：状态分区和目录弱分组纯函数。
- `src/domain/history-model.ts`：提交摘要、引用、图节点和同步状态类型。
- `src/services/history-service.ts`：Git 历史、引用、提交文件和领先/落后读取。
- `src/services/sync-service.ts`：fetch、pull、标准分支推送及无上游推送。
- `src/services/commit-message-ai-service.ts`：AI 上下文裁剪、三档提示和响应校验。
- `src/webview/file-icons.ts`：文件扩展名到图标和颜色类映射。
- `src/webview/layout-state.ts`：三分区折叠、尺寸约束和持久化模型。
- `src/webview/history-renderer.ts`：提交图、单行提交和展开文件 DOM。
- 对应 `test/unit/*.test.ts` 与 `test/integration/*.test.ts`。

修改文件：

- `src/domain/view-model.ts`：加入历史、同步和 AI 状态。
- `src/git/builtin-git-api.ts`：补充 fetch、pull 所需最小契约。
- `src/services/repository-registry.ts`：保存只读扩展状态并产生新 ViewModel。
- `src/services/repository-service.ts`：暴露历史、同步和 AI 编排入口。
- `src/services/repository-write-coordinator.ts`：把同步写操作纳入锁和快照校验。
- `src/webview/messages.ts`：加入折叠之外的宿主请求消息。
- `src/webview/render.ts`：输出固定三分区骨架。
- `src/webview/client.ts`：连接拆分模块并渲染新工作台。
- `src/webview/view-provider.ts`：处理历史、同步、AI、差异和活动栏徽标。
- `src/extension.ts`：装配新服务并传入工作区状态。
- `media/main.css`：实现 VS Code 原生密度视觉和响应式布局。
- `.vscodeignore`、`README.md`、`CHANGELOG.md`：交付边界和功能说明。

---

### Task 1: 状态分区、目录分组与文件图标

**Files:**
- Create: `src/domain/change-groups.ts`
- Create: `src/webview/file-icons.ts`
- Create: `test/unit/change-groups.test.ts`
- Create: `test/unit/file-icons.test.ts`

**Interfaces:**
- Consumes: `FileChange` from `src/domain/change-model.ts`。
- Produces: `groupChanges(changes): ChangeSection[]`、`resolveFileIcon(path): FileIconPresentation`。

- [ ] **Step 1: 编写状态分区失败测试**

```ts
expect(groupChanges(changes).map((group) => group.kind))
  .toEqual(['tracked', 'untracked', 'conflicted']);
expect(groupChanges(changes)[0]?.directories[0]).toMatchObject({
  path: 'src/services',
  files: [expect.objectContaining({ path: 'src/services/a.ts' })],
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run test/unit/change-groups.test.ts`
Expected: FAIL，提示找不到 `change-groups.js`。

- [ ] **Step 3: 实现分区和目录弱分组**

```ts
export type ChangeSectionKind = 'tracked' | 'untracked' | 'conflicted';
export interface ChangeDirectoryGroup {
  readonly path: string;
  readonly files: readonly FileChange[];
}
export interface ChangeSection {
  readonly kind: ChangeSectionKind;
  readonly directories: readonly ChangeDirectoryGroup[];
}
export function groupChanges(changes: readonly FileChange[]): ChangeSection[];
```

冲突优先于未跟踪和已跟踪；目录使用 POSIX Git 路径的 `dirname`，根目录显示 `.`；分区和目录均稳定排序。

- [ ] **Step 4: 编写并运行文件图标失败测试**

```ts
expect(resolveFileIcon('src/main.ts')).toEqual({ glyph: 'TS', color: 'blue' });
expect(resolveFileIcon('.gitignore')).toEqual({ glyph: '◆', color: 'yellow' });
expect(resolveFileIcon('unknown.bin')).toEqual({ glyph: '◇', color: 'muted' });
```

Run: `npx vitest run test/unit/file-icons.test.ts`
Expected: FAIL，提示找不到 `file-icons.js`。

- [ ] **Step 5: 实现本地图标映射并运行测试**

```ts
export interface FileIconPresentation {
  readonly glyph: string;
  readonly color: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'muted';
}
export function resolveFileIcon(path: string): FileIconPresentation;
```

Run: `npx vitest run test/unit/change-groups.test.ts test/unit/file-icons.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/domain/change-groups.ts src/webview/file-icons.ts test/unit/change-groups.test.ts test/unit/file-icons.test.ts
git commit -m "功能：增加变更分区和文件类型图标"
```

### Task 2: 布局状态、折叠与拖动约束

**Files:**
- Create: `src/webview/layout-state.ts`
- Create: `test/unit/layout-state.test.ts`

**Interfaces:**
- Produces: `normalizeLayoutState(input, viewportHeight)`、`resizeLayout(state, handle, delta, viewportHeight)`、`togglePane(state, pane)`。

- [ ] **Step 1: 编写最小高度和折叠失败测试**

```ts
expect(normalizeLayoutState({ commit: 20, changes: 20, history: 20 }, 600))
  .toMatchObject({ commit: 116, changes: 96, history: 100 });
expect(togglePane(defaultLayoutState, 'history').collapsed.history).toBe(true);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run test/unit/layout-state.test.ts`
Expected: FAIL，提示找不到 `layout-state.js`。

- [ ] **Step 3: 实现纯布局模型**

```ts
export type PaneName = 'commit' | 'changes' | 'history';
export interface WorkbenchLayoutState {
  readonly heights: Record<PaneName, number>;
  readonly collapsed: Record<PaneName, boolean>;
}
export const defaultLayoutState: WorkbenchLayoutState;
export function normalizeLayoutState(input: unknown, viewportHeight: number): WorkbenchLayoutState;
export function resizeLayout(state: WorkbenchLayoutState, handle: 'commit-changes' | 'changes-history', delta: number, viewportHeight: number): WorkbenchLayoutState;
export function togglePane(state: WorkbenchLayoutState, pane: PaneName): WorkbenchLayoutState;
```

- [ ] **Step 4: 覆盖双击复位和非法持久化状态**

补充 `resetLayout()` 测试，确保 NaN、负数、未知键回到默认状态。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run test/unit/layout-state.test.ts`
Expected: PASS。

```bash
git add src/webview/layout-state.ts test/unit/layout-state.test.ts
git commit -m "功能：增加工作台折叠和拖动布局模型"
```

### Task 3: Git 历史、引用和提交详情

**Files:**
- Create: `src/domain/history-model.ts`
- Create: `src/services/history-service.ts`
- Create: `test/unit/history-service.test.ts`
- Create: `test/integration/history-service.test.ts`

**Interfaces:**
- Consumes: `GitRunner.runForMachineParsing(root, args)`。
- Produces: `HistoryService.list(root, head, upstream, limit)`、`HistoryService.details(root, hash)`、`HistoryService.aheadBehind(root)`。

- [ ] **Step 1: 编写 NUL 分隔历史解析失败测试**

```ts
expect(parseHistoryLog(raw)).toEqual([
  {
    hash: 'aaaaaaaa',
    parents: ['bbbbbbbb'],
    author: '许博阳',
    authoredAt: '2026-08-01T10:00:00+08:00',
    subject: '功能：示例',
  },
]);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run test/unit/history-service.test.ts`
Expected: FAIL，提示缺少解析器。

- [ ] **Step 3: 定义历史模型并实现严格解析**

```ts
export interface CommitSummary {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly authoredAt: string;
  readonly subject: string;
  readonly refs: readonly CommitRef[];
}
export interface CommitGraphNode extends CommitSummary {
  readonly lane: number;
  readonly parentLanes: readonly number[];
}
```

Git 命令使用固定字段和 NUL 分隔，拒绝缺字段、非法哈希和非法日期；不解析面向人类的本地化文本。

- [ ] **Step 4: 实现列表、详情和领先落后读取**

```ts
export class HistoryService {
  constructor(private readonly git: GitRunner) {}
  list(root: string, head?: string, upstream?: string, limit?: number): Promise<HistoryView>;
  details(root: string, hash: string): Promise<CommitDetails>;
  aheadBehind(root: string): Promise<AheadBehind>;
}
```

列表限制 50 条；详情使用 `diff-tree --first-parent --root --name-status -z`；引用使用 `for-each-ref` 和 `symbolic-ref`；领先落后使用 `rev-list --left-right --count HEAD...@{upstream}`。

- [ ] **Step 5: 使用真实临时仓库覆盖根提交、分支引用和合并提交**

Run: `npx vitest run test/integration/history-service.test.ts`
Expected: PASS，根提交、普通提交、远程跟踪引用和第一父比较均正确。

- [ ] **Step 6: 运行任务测试并提交**

Run: `npx vitest run test/unit/history-service.test.ts test/integration/history-service.test.ts`
Expected: PASS。

```bash
git add src/domain/history-model.ts src/services/history-service.ts test/unit/history-service.test.ts test/integration/history-service.test.ts
git commit -m "功能：增加提交历史和引用位置读取"
```

### Task 4: 拉取、远程刷新和推送全部

**Files:**
- Create: `src/services/sync-service.ts`
- Create: `test/unit/sync-service.test.ts`
- Create: `test/integration/sync-service.test.ts`
- Modify: `src/git/builtin-git-api.ts`
- Modify: `test/helpers/test-doubles.ts`

**Interfaces:**
- Consumes: `BuiltinRepository.fetch()`、`BuiltinRepository.pull()`、现有 `push()` 和 `setBranchUpstream()`。
- Produces: `SyncService.fetch(repository)`、`pull(repository)`、`pushAll(repository, request)`。

- [ ] **Step 1: 扩充测试替身并编写失败测试**

```ts
await service.pull(repository);
expect(repository.pullCalls).toEqual([{}]);
expect(repository.fetchCalls).toHaveLength(0);
```

另测：领先为零禁止推送；落后大于零禁止推送；无上游返回 `needs-remote`；有上游调用不带精确哈希的标准 `push()`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run test/unit/sync-service.test.ts`
Expected: FAIL，提示缺少 `SyncService`。

- [ ] **Step 3: 补充最小内置 Git API 契约**

```ts
fetch(remote?: string): Promise<void>;
pull(rebase?: boolean, remote?: string, branch?: string): Promise<void>;
```

调用 `pull()` 时不传 rebase 参数，保证遵循仓库配置。

- [ ] **Step 4: 实现同步服务**

```ts
export interface PushAllRequest {
  readonly localBranch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly selectedRemote?: string;
}
export class SyncService {
  fetch(repository: BuiltinRepository): Promise<void>;
  pull(repository: BuiltinRepository): Promise<void>;
  pushAll(repository: BuiltinRepository, request: PushAllRequest): Promise<PushResult>;
}
```

- [ ] **Step 5: 真实仓库验证标准推送同步全部本地提交**

创建 bare remote、本地 clone 和第二 clone；本地连续提交 3 次，调用同步流程后断言远程分支到达本地 HEAD。再制造远程领先和分叉，断言服务拒绝推送且没有执行 force。

Run: `npx vitest run test/integration/sync-service.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/services/sync-service.ts src/git/builtin-git-api.ts test/helpers/test-doubles.ts test/unit/sync-service.test.ts test/integration/sync-service.test.ts
git commit -m "功能：增加拉取和未推送提交同步"
```

### Task 5: VS Code 原生 AI 提交信息服务

**Files:**
- Create: `src/services/commit-message-ai-service.ts`
- Create: `test/unit/commit-message-ai-service.test.ts`

**Interfaces:**
- Produces: `buildCommitMessagePrompt()`、`buildAiDiffContext()`、`CommitMessageAiService.generate()`。
- Uses injected `selectModels` and `readSelectedDiff` so tests never call real models。

- [ ] **Step 1: 编写三档提示和结果校验失败测试**

```ts
expect(buildCommitMessagePrompt('compact', context)).toContain('只输出一行');
expect(buildCommitMessagePrompt('standard', context)).toContain('2–4 条');
expect(buildCommitMessagePrompt('detailed', context)).toContain('不得虚构已执行测试');
expect(normalizeGeneratedMessage('```\n修复：示例\n```')).toBe('修复：示例');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run test/unit/commit-message-ai-service.test.ts`
Expected: FAIL，提示找不到服务。

- [ ] **Step 3: 实现密度、上下文和响应类型**

```ts
export type CommitMessageDensity = 'compact' | 'standard' | 'detailed';
export interface AiSelectedChangeContext {
  readonly files: readonly { path: string; status: string; diff?: string }[];
  readonly excluded: readonly { path: string; reason: string }[];
}
export interface CommitMessageAiDependencies {
  readonly selectModels: () => Promise<readonly vscode.LanguageModelChat[]>;
  readonly readSelectedDiff: (request: AiContextRequest) => Promise<AiSelectedChangeContext>;
}
```

上下文按单文件 64 KiB、总计 256 KiB 初始上限裁剪，并在调用前使用模型 `countTokens()` 二次收缩；二进制只传路径和状态。

- [ ] **Step 4: 实现用户触发的模型调用和取消**

```ts
generate(request: GenerateCommitMessageRequest, token: vscode.CancellationToken): Promise<GenerateCommitMessageResult>;
```

优先 `selectChatModels({ vendor: 'copilot' })`，为空时再查询所有可用模型；不固定 family、version、id。捕获 `NoPermissions`、`Blocked`、`NotFound` 并转换为中文可操作错误。

- [ ] **Step 5: 覆盖过期、无模型、超限和虚构测试约束**

使用假流式响应；断言取消后不返回文本、无模型错误明确、排除文件清单保留、Markdown 围栏被移除。

Run: `npx vitest run test/unit/commit-message-ai-service.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/services/commit-message-ai-service.ts test/unit/commit-message-ai-service.test.ts
git commit -m "功能：接入 VS Code AI 提交信息生成"
```

### Task 6: 仓库模型和写入编排接入历史、同步与 AI

**Files:**
- Modify: `src/domain/view-model.ts`
- Modify: `src/services/repository-registry.ts`
- Modify: `src/services/repository-service.ts`
- Modify: `src/services/repository-write-coordinator.ts`
- Modify: `test/unit/repository-service.test.ts`
- Modify: `test/unit/operation-lock.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5 services。
- Produces: `refreshHistory()`、`loadCommitDetails()`、`fetchHistory()`、`pull()`、`pushAll()`、`generateCommitMessage()` service methods。

- [ ] **Step 1: 编写 ViewModel 默认状态失败测试**

```ts
expect(service.getViewModel()).toMatchObject({
  changeCount: 0,
  sync: { kind: 'no-upstream' },
  history: { kind: 'idle', commits: [] },
  ai: { kind: 'idle' },
});
```

- [ ] **Step 2: 扩展领域状态**

```ts
export type SyncState =
  | { readonly kind: 'detached' }
  | { readonly kind: 'no-upstream' }
  | { readonly kind: 'ready'; readonly upstream: string; readonly ahead: number; readonly behind: number };
export type HistoryState =
  | { readonly kind: 'idle'; readonly commits: readonly CommitGraphNode[] }
  | { readonly kind: 'loading'; readonly commits: readonly CommitGraphNode[] }
  | { readonly kind: 'ready'; readonly commits: readonly CommitGraphNode[] }
  | { readonly kind: 'failed'; readonly commits: readonly CommitGraphNode[]; readonly message: string };
```

- [ ] **Step 3: 将历史读取与仓库生命周期绑定**

仓库切换和刷新后读取当前仓库历史；仓库关闭时丢弃结果；异步结果必须核对仓库 ID 和启动版本，过期结果不能覆盖新状态。

- [ ] **Step 4: 将同步写操作纳入仓库锁**

`pull` 和 `pushAll` 使用现有 `RepositoryOperationLock`。执行前主动 `status()` 并校验 HEAD、分支、上游和远程快照；成功或失败后刷新仓库状态和历史。fetch 是用户触发的只读远程更新，但同样串行化，避免与 pull/push 交错。

- [ ] **Step 5: 接入 AI 请求版本绑定**

生成前校验当前仓库、版本和 selectedIds；完成后再次核对三者。只有仍匹配时调用 `setCommitMessage()`，否则返回“仓库状态已变化，本次生成结果已丢弃”。

- [ ] **Step 6: 运行仓库服务测试**

Run: `npx vitest run test/unit/repository-service.test.ts test/unit/operation-lock.test.ts`
Expected: PASS，覆盖跨仓库、过期历史、过期 AI、同步锁和冲突状态。

- [ ] **Step 7: 提交**

```bash
git add src/domain/view-model.ts src/services/repository-registry.ts src/services/repository-service.ts src/services/repository-write-coordinator.ts test/unit/repository-service.test.ts test/unit/operation-lock.test.ts
git commit -m "功能：接入历史同步和 AI 仓库状态"
```

### Task 7: Webview 消息和固定三分区骨架

**Files:**
- Modify: `src/webview/messages.ts`
- Modify: `src/webview/render.ts`
- Modify: `test/unit/messages.test.ts`
- Modify: `test/unit/render.test.ts`

**Interfaces:**
- Produces messages: `refreshHistory`、`pull`、`pushAll`、`loadCommitDetails`、`openCommitDiff`、`generateCommitMessage`、`cancelCommitMessageGeneration`。

- [ ] **Step 1: 编写严格消息解析失败测试**

每种写消息包含 `repositoryId`、`version`、`requestId`；历史详情包含 `repositoryId` 和合法 40 位 hash；AI 包含密度和 selectedIds。额外字段、空字符串、非法密度、负版本必须拒绝。

Run: `npx vitest run test/unit/messages.test.ts`
Expected: FAIL，新消息未识别。

- [ ] **Step 2: 实现消息联合类型和严格解析**

复用 `requireExactKeys`、`requireRepositoryId` 和版本校验；新增 `isCommitHash` 与密度枚举校验，不放宽已有消息。

- [ ] **Step 3: 编写三分区结构失败测试**

```ts
expect(html).toContain('class="commit-panel workbench-pane"');
expect(html).toContain('class="changes-panel workbench-pane"');
expect(html).toContain('class="history-panel workbench-pane"');
expect(html.match(/class="pane-resizer"/gu)).toHaveLength(2);
```

- [ ] **Step 4: 重写固定 HTML 骨架**

单仓库选择器默认隐藏，多仓库时由客户端显示；三个区域标题栏、按钮、列表容器和反馈区使用唯一 ID；保留 CSP nonce 和无内联脚本约束。

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run test/unit/messages.test.ts test/unit/render.test.ts`
Expected: PASS。

```bash
git add src/webview/messages.ts src/webview/render.ts test/unit/messages.test.ts test/unit/render.test.ts
git commit -m "界面：建立三分区工作台骨架"
```

### Task 8: Webview 客户端、提交图和视觉样式

**Files:**
- Create: `src/webview/history-renderer.ts`
- Modify: `src/webview/client.ts`
- Modify: `media/main.css`
- Create: `test/unit/history-renderer.test.ts`
- Modify: `test/unit/render.test.ts`

**Interfaces:**
- Consumes: `groupChanges`、`resolveFileIcon`、layout state functions、new `RepositoryViewModel`。
- Produces: fixed three-pane DOM and messages from Task 7。

- [ ] **Step 1: 编写历史单行渲染失败测试**

断言每个 `.commit-row` 内同时包含 subject、author、relative time、short hash 和引用标签，且未展开时没有第二元数据行；展开文件位于 `.commit-files`。

- [ ] **Step 2: 实现历史渲染模块**

```ts
export interface HistoryRendererCallbacks {
  readonly toggleCommit: (hash: string, expanded: boolean) => void;
  readonly openCommitDiff: (hash: string, path: string) => void;
}
export function renderHistory(container: HTMLElement, model: RepositoryViewModel, callbacks: HistoryRendererCallbacks): void;
```

相对时间由客户端按当前时间计算；完整提交信息、绝对时间和完整 hash 放入 `title`/ARIA 文本。

- [ ] **Step 3: 重构当前变更渲染**

使用 Task 1 分区和图标；状态组、目录组可折叠；文件复选、组复选、打开差异、未跟踪废纸篓保持原有消息语义。

- [ ] **Step 4: 接入布局状态和指针拖动**

扩展 `VsCodeApi` 为 `getState/setState`；按仓库 ID 保存布局和 AI 密度。Pointer capture 处理拖动，`keydown` 支持方向键调整，双击恢复默认；窗口 resize 后重新约束。

- [ ] **Step 5: 接入 AI 分裂按钮和同步标题栏**

主体按钮使用上次密度；菜单选择三档；生成中显示取消；历史标题栏在同一行显示 upstream、ahead/behind、pull、pushAll、refresh、collapse。

- [ ] **Step 6: 重写 CSS**

使用 VS Code 主题变量；活动控件 25–28 px 高；文件和提交行 28–36 px；拖动条悬停使用 `--vscode-focusBorder`；窄宽度下提交信息先省略，元数据和引用保持单行；支持键盘焦点和 reduced motion。

- [ ] **Step 7: 运行 Webview 测试**

Run: `npx vitest run test/unit/render.test.ts test/unit/history-renderer.test.ts test/unit/view-provider.test.ts`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/webview/history-renderer.ts src/webview/client.ts media/main.css test/unit/history-renderer.test.ts test/unit/render.test.ts test/unit/view-provider.test.ts
git commit -m "界面：完成可调整提交工作台交互"
```

### Task 9: ViewProvider 宿主操作、历史差异和活动栏徽标

**Files:**
- Modify: `src/webview/view-provider.ts`
- Modify: `src/extension.ts`
- Modify: `test/unit/view-provider.test.ts`
- Modify: `test/unit/extension.test.ts`

**Interfaces:**
- Consumes: RepositoryService methods from Task 6。
- Produces: badge updates, host message routing, VS Code diff commands, native AI model adapter。

- [ ] **Step 1: 编写活动栏徽标失败测试**

```ts
expect(webviewView.badge).toEqual({ value: 4, tooltip: 'Gitool：4 个变更文件' });
// 状态清空后
expect(webviewView.badge).toBeUndefined();
```

- [ ] **Step 2: 保存 WebviewView 并同步徽标**

`resolveWebviewView` 保存当前 view；每次 service change 和仓库切换都更新 `badge`；dispose 后不得访问旧 view。

- [ ] **Step 3: 路由历史和同步消息**

pull、pushAll、fetch 使用现有 `beginWrite`/请求确认模式；无上游 pushAll 使用 QuickPick；错误经过 `redactSensitiveText` 后进入 operation state。

- [ ] **Step 4: 打开历史文件差异**

通过 `gitApi.toGitUri(fileUri, parentHash)` 和 `gitApi.toGitUri(fileUri, commitHash)` 调用 `vscode.diff`。删除、重命名、根提交使用 HistoryService 返回的左右路径和引用，不在 provider 猜测。

- [ ] **Step 5: 装配 VS Code Language Model API**

仅在 `generateCommitMessage` 用户消息中调用 `vscode.lm.selectChatModels`；创建 CancellationTokenSource；仓库切换、新生成和显式取消都会取消旧请求。模型错误转换为中文反馈。

- [ ] **Step 6: 运行宿主单元测试并提交**

Run: `npx vitest run test/unit/view-provider.test.ts test/unit/extension.test.ts`
Expected: PASS。

```bash
git add src/webview/view-provider.ts src/extension.ts test/unit/view-provider.test.ts test/unit/extension.test.ts
git commit -m "功能：接入提交图同步 AI 和活动栏徽标"
```

### Task 10: Extension Host 回归、文档和交付清单

**Files:**
- Modify: `test/vscode/suite/extension.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `.vscodeignore`

**Interfaces:**
- Verifies all previous tasks end to end。

- [ ] **Step 1: 扩充真实 Extension Host 测试**

增加断言：活动栏徽标、三分区 HTML、真实本地领先 3 个提交后的 pushAll、远程引用位置、历史展开和差异命令。AI 使用注入的测试适配器，不请求真实模型。

- [ ] **Step 2: 运行完整静态和单元集成检查**

Run: `npm run check`
Expected: TypeScript、ESLint、全部 Vitest 通过。

- [ ] **Step 3: 运行 Extension Host**

Run: `env -u ELECTRON_RUN_AS_NODE npm run test:vscode`
Expected: 全部 Extension Host 测试通过。若普通终端未设置该变量，`npm run test:vscode` 也必须通过。

- [ ] **Step 4: 更新用户文档和变更日志**

README 说明三分区、按文件选择、历史同步、AI 原生授权和无模型边界；CHANGELOG 增加未发布条目；`.vscodeignore` 加入 `.serena/**`。

- [ ] **Step 5: 验证构建与 VSIX 清单**

Run: `npm run build && npx vsce ls --no-dependencies`
Expected: 清单不包含 `.serena/`、`.worktrees/`、`src/`、`test/` 或 `.vscode-test/`，只包含交付运行文件和文档。

- [ ] **Step 6: 最终回归和状态检查**

Run: `npm run check && git diff --check && git status --short`
Expected: 测试通过，无意外文件；仅计划内改动待提交。

- [ ] **Step 7: 提交**

```bash
git add test/vscode/suite/extension.test.ts README.md CHANGELOG.md .vscodeignore
git commit -m "发布：完成 Gitool 提交工作台重构"
```

---

## 最终验收清单

- [ ] 三个功能区始终存在，可折叠、可拖动、可复位并持久化。
- [ ] 当前变更按状态和目录分组，文件类型图标与 Git 状态分离。
- [ ] 活动栏徽标显示当前仓库全部变更文件数。
- [ ] 提交历史单行显示提交信息、提交人、时间、短哈希和引用。
- [ ] 展开提交可查看文件并打开第一父差异。
- [ ] 拉取遵循仓库配置；历史刷新只 fetch；推送全部不 force。
- [ ] 本地 HEAD 和上游引用位置、领先落后数准确。
- [ ] AI 三档密度可选，只分析勾选文件，不需要 Gitool API Key。
- [ ] 原有精确文件提交、暂存状态保持、废纸篓和推送失败重试无回归。
- [ ] `npm run check`、Extension Host 和 VSIX 清单全部通过。
