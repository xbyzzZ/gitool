# Gitool 原生三分区视图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把 Gitool 的当前变更与提交历史迁移到 VS Code 原生 TreeView，并把提交输入精简为独立 Webview View，从而获得原生文件图标、紧凑列表、连续展开、图标操作和可拖动视图分隔线。

**架构：** 保留 `RepositoryService`、写入协调器和所有 Git 业务合同，以共享仓库视图模型作为三个 View 的唯一状态源。新增变更树、历史树和视图动作控制器；提交 Webview 只处理提交文本与 AI 交互。所有原生标题栏与行内操作通过 `package.json` 命令和菜单贡献接入。

**技术栈：** TypeScript 6、VS Code Extension API 1.125、Webview View、TreeView/TreeDataProvider、Vitest、Mocha Extension Host、esbuild、vsce。

## 全局约束

- 所有用户可见文字、代码注释、测试名称、提交信息和文档均使用简体中文。
- 不引入第三方图标包，不读取或解析文件图标主题私有文件。
- 文件节点必须使用真实 `resourceUri` 与 `vscode.ThemeIcon.File`，由当前 VS Code 文件图标主题解析。
- 未跟踪文件默认不选择；未选文件及其既有暂存状态保持不变。
- 舍弃只允许具体未跟踪文件，必须二次确认并移入系统废纸篓。
- 提交、推送、拉取、远程设置、仓库锁和过期快照校验的业务合同保持不变。
- 多仓库每次只操作一个仓库；仓库选择只在存在多个仓库时显示。
- 不实现手绘 Git 分叉图线，提交与文件关系使用原生树父子层级表达。
- 每项生产代码修改前必须先写失败测试并确认失败原因正确。

---

## 文件结构

- 新建 `src/views/change-tree-provider.ts`：构造当前变更分组、目录和文件 TreeItem，管理原生复选框状态。
- 新建 `src/views/history-tree-provider.ts`：构造提交和历史文件 TreeItem，按需读取提交详情。
- 新建 `src/views/view-actions.ts`：封装 TreeView 标题栏和节点命令，复用现有 RepositoryService 安全合同与 VS Code 对话框。
- 修改 `src/webview/view-provider.ts`：缩减为提交信息 View，只处理仓库选择、提交信息、AI、提交与推送。
- 修改 `src/webview/render.ts`、`src/webview/client.ts`、`media/main.css`：只保留提交输入区。
- 修改 `src/extension.ts`：创建三个 Provider、两个 TreeView、动作控制器并统一释放。
- 修改 `package.json`：贡献三个 View、命令、标题栏菜单和节点行内/上下文菜单。
- 删除 `src/webview/file-icons.ts`、`src/webview/history-renderer.ts`、`src/webview/layout-state.ts` 及对应测试：移除已被原生 API 取代的模拟实现。
- 新建 `test/unit/change-tree-provider.test.ts`、`test/unit/history-tree-provider.test.ts`、`test/unit/view-actions.test.ts`。
- 修改 `test/unit/render.test.ts`、`test/unit/view-provider.test.ts`、`test/unit/extension.test.ts`、`test/vscode/suite/extension.test.ts`。

---

### Task 1：声明三个原生 View 与图标命令

**文件：**
- 修改：`package.json`
- 修改：`test/unit/extension.test.ts`
- 新建：`test/unit/package-contributions.test.ts`

**接口：**
- 产出 View ID：`gitool.commitView`、`gitool.changesView`、`gitool.historyView`。
- 产出命令 ID：`gitool.editRemote`、`gitool.refreshChanges`、`gitool.trashUntracked`、`gitool.openChange`、`gitool.pull`、`gitool.pushAll`、`gitool.refreshHistory`、`gitool.openHistoryDiff`。
- 后续 Provider 和动作控制器依赖这些固定 ID。

- [ ] **步骤 1：写贡献点失败测试**

```ts
it('贡献提交信息、当前变更和提交历史三个独立视图', () => {
  const views = manifest.contributes.views.gitool;
  expect(views).toEqual([
    { type: 'webview', id: 'gitool.commitView', name: '提交信息' },
    { id: 'gitool.changesView', name: '当前变更' },
    { id: 'gitool.historyView', name: '提交历史' },
  ]);
});

it('高频操作使用 VS Code 产品图标并放在对应标题栏', () => {
  expect(command('gitool.editRemote').icon).toBe('$(remote)');
  expect(command('gitool.trashUntracked').icon).toBe('$(trash)');
  expect(command('gitool.pull').icon).toBe('$(cloud-download)');
  expect(command('gitool.pushAll').icon).toBe('$(cloud-upload)');
  expect(command('gitool.refreshHistory').icon).toBe('$(refresh)');
  expect(viewTitleCommands('gitool.historyView')).toEqual([
    'gitool.pull', 'gitool.pushAll', 'gitool.refreshHistory',
  ]);
});
```

- [ ] **步骤 2：运行测试并确认因贡献点仍为单 Webview 而失败**

运行：`npx vitest run test/unit/package-contributions.test.ts test/unit/extension.test.ts`

预期：FAIL，错误明确显示缺少 `gitool.changesView`、`gitool.historyView` 和原生命令贡献。

- [ ] **步骤 3：最小修改 `package.json`**

将 `contributes.views.gitool` 改为三个 View；在 `contributes.commands` 中声明上述命令并使用 Codicon，其中远程设置固定使用 `$(remote)`；使用 `menus.view/title` 把远程设置放到提交 View，把刷新放到变更 View，把拉取、推送、刷新放到历史 View；使用 `menus.view/item/context` 把垃圾桶限制到 `view == gitool.changesView && viewItem == gitool.untrackedFile`。不贡献单独的 fetch 命令：`gitool.refreshChanges` 只刷新工作区与本地历史，联网操作只由拉取和推送触发。

- [ ] **步骤 4：运行贡献点测试**

运行：`npx vitest run test/unit/package-contributions.test.ts test/unit/extension.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add package.json test/unit/package-contributions.test.ts test/unit/extension.test.ts
git commit -m "界面：声明 Gitool 原生三分区视图"
```

---

### Task 2：实现当前变更原生 TreeView

**文件：**
- 新建：`src/views/change-tree-provider.ts`
- 新建：`test/unit/change-tree-provider.test.ts`
- 修改：`src/domain/change-groups.ts`

**接口：**
- 消费：`RepositoryService.getViewModel()`、`RepositoryService.onDidChange`、`RepositoryService.setFileSelected(fileId, selected)`、`RepositoryService.setGroup(kind, selected)`。
- 产出：`ChangeTreeProvider implements vscode.TreeDataProvider<ChangeTreeNode>`。
- 产出：`ChangeTreeNode = ChangeSectionNode | ChangeDirectoryNode | ChangeFileNode`。
- 产出：`createChangeTreeView(options): vscode.TreeView<ChangeTreeNode>`，使用 `manageCheckboxStateManually: true`。

- [ ] **步骤 1：写文件节点失败测试**

```ts
it('文件节点使用当前文件图标主题并在同一行显示目录和状态', () => {
  const item = provider.getTreeItem(fileNode('src/webview/render.ts'));
  expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/webview/render.ts');
  expect(item.iconPath).toBe(ThemeIcon.File);
  expect(item.label).toBe('render.ts');
  expect(item.description).toBe('src/webview · M');
  expect(item.checkboxState).toBe(TreeItemCheckboxState.Checked);
});
```

- [ ] **步骤 2：运行并确认 Provider 不存在导致失败**

运行：`npx vitest run test/unit/change-tree-provider.test.ts`

预期：FAIL，模块 `src/views/change-tree-provider.ts` 不存在。

- [ ] **步骤 3：实现稳定节点模型和文件图标**

实现明确的判别联合：

```ts
export type ChangeTreeNode =
  | { readonly kind: 'section'; readonly section: ChangeSectionKind }
  | { readonly kind: 'directory'; readonly section: ChangeSectionKind; readonly path: string }
  | { readonly kind: 'file'; readonly repositoryId: string; readonly change: FileChange };
```

文件 TreeItem 使用：

```ts
const item = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.None);
item.resourceUri = vscode.Uri.joinPath(repository.rootUri, change.path);
item.iconPath = vscode.ThemeIcon.File;
item.description = `${directory} · ${statusLabel(change)}`;
item.checkboxState = selected
  ? vscode.TreeItemCheckboxState.Checked
  : vscode.TreeItemCheckboxState.Unchecked;
item.contextValue = change.untracked
  ? 'gitool.untrackedFile'
  : change.conflicted ? 'gitool.conflictedFile' : 'gitool.changedFile';
item.command = { command: 'gitool.openChange', title: '打开变更', arguments: [node] };
```

- [ ] **步骤 4：写复选框与分组失败测试**

```ts
it('把文件复选框变化写回当前仓库选择状态', () => {
  checkboxEmitter.fire({ items: [[node, TreeItemCheckboxState.Unchecked]] });
  expect(service.setFileSelected).toHaveBeenCalledWith('src/webview/render.ts', false);
});

it('冲突文件不提供复选框', () => {
  expect(provider.getTreeItem(conflictedNode).checkboxState).toBeUndefined();
});
```

- [ ] **步骤 5：确认新测试失败后实现手动复选框同步**

运行：`npx vitest run test/unit/change-tree-provider.test.ts`

预期：FAIL，复选框事件尚未写回服务。

实现 `bindCheckboxes(treeView)`：只接受当前 Provider 创建的节点；文件节点调用 `setFileSelected`；分组节点只允许 `tracked` 与 `untracked`，调用 `setGroup`；冲突节点不写入。

- [ ] **步骤 6：运行当前变更测试**

运行：`npx vitest run test/unit/change-tree-provider.test.ts test/unit/change-groups.test.ts`

预期：PASS。

- [ ] **步骤 7：提交**

```bash
git add src/views/change-tree-provider.ts src/domain/change-groups.ts test/unit/change-tree-provider.test.ts test/unit/change-groups.test.ts
git commit -m "界面：实现当前变更原生文件树"
```

---

### Task 3：实现提交历史原生 TreeView

**文件：**
- 新建：`src/views/history-tree-provider.ts`
- 新建：`test/unit/history-tree-provider.test.ts`

**接口：**
- 消费：`RepositoryService.getViewModel()`、`RepositoryService.onDidChange`、`RepositoryService.loadCommitDetails(request)`。
- 产出：`HistoryTreeProvider implements vscode.TreeDataProvider<HistoryTreeNode>`。
- 产出：`HistoryTreeNode = HistoryCommitNode | HistoryFileNode`。
- 提交详情缓存键：`${repositoryId}:${version}:${hash}`，仓库或版本变化即清空。

- [ ] **步骤 1：写提交节点失败测试**

```ts
it('提交节点在单行显示主题和元数据并使用提交图标', () => {
  const item = provider.getTreeItem(commitNode);
  expect(item.label).toBe('界面：迁移原生提交历史');
  expect(item.description).toBe('许博阳 · 5 分钟前 · abc1234 · HEAD main');
  expect(item.iconPath).toEqual(new ThemeIcon('git-commit'));
  expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
});
```

- [ ] **步骤 2：运行并确认 Provider 不存在导致失败**

运行：`npx vitest run test/unit/history-tree-provider.test.ts`

预期：FAIL，模块 `src/views/history-tree-provider.ts` 不存在。

- [ ] **步骤 3：实现提交节点与 View 描述**

`getChildren(undefined)` 返回当前模型的提交节点；`getTreeItem(commit)` 使用 `git-commit` ThemeIcon、单行 label、单行 description 和完整 tooltip。Provider 暴露：

```ts
getDescription(): string {
  const sync = this.service.getViewModel().sync;
  return sync.kind === 'ready'
    ? `${sync.upstream} · ↑${sync.ahead} ↓${sync.behind}`
    : sync.kind === 'detached' ? '游离 HEAD' : '未设置上游';
}
```

- [ ] **步骤 4：写展开文件失败测试**

```ts
it('展开提交时按需加载文件并使用当前文件图标主题', async () => {
  const children = await provider.getChildren(commitNode);
  const item = provider.getTreeItem(children[0]);
  expect(service.loadCommitDetails).toHaveBeenCalledWith({
    repositoryId: '/workspace/repo', version: 7, hash: commit.hash,
  });
  expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/render.ts');
  expect(item.iconPath).toBe(ThemeIcon.File);
  expect(item.label).toBe('render.ts');
  expect(item.description).toBe('src · M');
  expect(item.command?.command).toBe('gitool.openHistoryDiff');
});
```

- [ ] **步骤 5：确认失败后实现详情缓存和历史文件节点**

运行：`npx vitest run test/unit/history-tree-provider.test.ts`

预期：FAIL，提交子节点为空。

实现按需 `loadCommitDetails`、版本隔离缓存、真实资源 URI、`ThemeIcon.File` 和历史 diff 命令参数。加载失败不伪造文件节点，让命令控制器报告明确错误。

- [ ] **步骤 6：运行历史树测试**

运行：`npx vitest run test/unit/history-tree-provider.test.ts test/unit/history-service.test.ts`

预期：PASS。

- [ ] **步骤 7：提交**

```bash
git add src/views/history-tree-provider.ts test/unit/history-tree-provider.test.ts
git commit -m "界面：实现提交历史原生文件树"
```

---

### Task 4：抽取原生 View 动作控制器

**文件：**
- 新建：`src/views/view-actions.ts`
- 新建：`test/unit/view-actions.test.ts`
- 修改：`src/webview/view-provider.ts`
- 修改：`test/unit/view-provider.test.ts`

**接口：**
- 消费：`RepositoryService`、`BuiltinGitApi` 和 VS Code 窗口 API。
- 产出：`GitoolViewActions`，包含 `refreshChanges()`、`openChange(node)`、`trashUntracked(node?)`、`editRemote()`、`pull()`、`pushAll()`、`refreshHistory()`、`openHistoryDiff(node)`。
- 产出：`registerViewCommands(actions): readonly vscode.Disposable[]`。
- 提交 Webview 继续拥有 `commit`、`commitAndPush`、`retryPush`、`generateCommitMessage` 与 `setCommitMessage`。

- [ ] **步骤 1：写垃圾桶和状态范围失败测试**

```ts
it('垃圾桶命令只提交当前快照中已选择的具体未跟踪文件', async () => {
  await actions.trashUntracked();
  expect(service.trash).toHaveBeenCalledWith({
    repositoryId: '/workspace/repo',
    version: 7,
    fileIds: ['.serena/project.yml'],
  });
});

it('没有选中的未跟踪文件时给出明确错误且不调用服务', async () => {
  await expect(actions.trashUntracked()).rejects.toThrow('没有已选择的未跟踪文件');
  expect(service.trash).not.toHaveBeenCalled();
});
```

- [ ] **步骤 2：运行并确认动作控制器不存在导致失败**

运行：`npx vitest run test/unit/view-actions.test.ts`

预期：FAIL，模块 `src/views/view-actions.ts` 不存在。

- [ ] **步骤 3：迁移 diff、舍弃、远程与同步动作**

从 `GitoolViewProvider` 提取现有已验证逻辑，不改变参数校验、QuickPick/InputBox、远程 URL 脱敏、上游选择和废纸篓二次确认。所有动作开始时调用一个 `currentScope()`，返回：

```ts
interface CurrentScope {
  readonly repositoryId: string;
  readonly version: number;
  readonly model: RepositoryViewModel;
}
```

动作成功后沿用 RepositoryService 自身刷新；动作失败调用 `reportFailure`，仅当服务拒绝接收错误时才显示 `Gitool：<错误>`。

- [ ] **步骤 4：写命令注册失败测试**

```ts
it('注册八个原生视图命令并在释放时全部注销', () => {
  const registrations = registerViewCommands(actions);
  expect(registeredIds).toEqual([
    'gitool.editRemote', 'gitool.refreshChanges', 'gitool.trashUntracked',
    'gitool.openChange', 'gitool.pull', 'gitool.pushAll',
    'gitool.refreshHistory', 'gitool.openHistoryDiff',
  ]);
  registrations.reverse().forEach((item) => item.dispose());
  expect(activeIds).toHaveLength(0);
});
```

- [ ] **步骤 5：确认失败后实现命令注册并运行测试**

运行：`npx vitest run test/unit/view-actions.test.ts test/unit/view-provider.test.ts`

预期：PASS，且提交 Webview 原有提交/AI 测试保持通过。

- [ ] **步骤 6：提交**

```bash
git add src/views/view-actions.ts src/webview/view-provider.ts test/unit/view-actions.test.ts test/unit/view-provider.test.ts
git commit -m "重构：拆分 Gitool 原生视图动作"
```

---

### Task 5：精简提交信息 Webview

**文件：**
- 修改：`src/webview/render.ts`
- 修改：`src/webview/client.ts`
- 修改：`src/webview/messages.ts`
- 修改：`media/main.css`
- 修改：`test/unit/render.test.ts`
- 修改：`test/unit/messages.test.ts`
- 修改：`test/unit/main-css.test.ts`

**接口：**
- Webview 保留消息：`ready`、`selectRepository`、`setCommitMessage`、`commit`、`commitAndPush`、`selectPushRemote`、`retryPush`、`generateCommitMessage`、`cancelCommitMessageGeneration`。
- Webview 删除消息：`refresh`、`toggleFile`、`setGroup`、`openDiff`、`trash`、`editRemoteUrl`、`refreshHistory`、`fetchHistory`、`pull`、`pushAll`、`loadCommitDetails`、`openCommitDiff`。
- Webview 状态仍使用 `RepositoryViewModel`，但只渲染提交输入所需字段。

- [ ] **步骤 1：写精简壳失败测试**

```ts
it('只渲染提交输入，不重复绘制 View 标题、变更树和历史树', () => {
  const html = renderWebviewHtml(webview, extensionUri, 'nonce-123');
  expect(html).toContain('id="commit-message"');
  expect(html).toContain('id="ai-generate-button"');
  expect(html).toContain('id="commit-button"');
  expect(html).toContain('id="commit-push-button"');
  expect(html).not.toContain('class="pane-header"');
  expect(html).not.toContain('id="tracked-group"');
  expect(html).not.toContain('id="history-list"');
  expect(html).not.toContain('pane-resizer');
});
```

- [ ] **步骤 2：运行并确认因旧三分区仍存在而失败**

运行：`npx vitest run test/unit/render.test.ts test/unit/main-css.test.ts test/unit/messages.test.ts`

预期：FAIL，HTML 仍包含当前变更、提交历史和拖动分隔线。

- [ ] **步骤 3：删除 Webview 中已迁移的结构和客户端逻辑**

`render.ts` 只输出仓库选择、textarea、AI 操作、提交操作与反馈；`client.ts` 删除文件分组、历史渲染、折叠和拖动代码；`messages.ts` 删除已迁移消息联合；CSS 删除所有 `.change-*`、`.file-*`、`.history-*`、`.commit-row`、`.pane-resizer` 规则，并把内容默认字号限制为 `var(--vscode-font-size)`、按钮高度交给 VS Code 表单基线。

- [ ] **步骤 4：运行 Webview 测试**

运行：`npx vitest run test/unit/render.test.ts test/unit/main-css.test.ts test/unit/messages.test.ts test/unit/view-provider.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add src/webview/render.ts src/webview/client.ts src/webview/messages.ts media/main.css test/unit/render.test.ts test/unit/main-css.test.ts test/unit/messages.test.ts test/unit/view-provider.test.ts
git commit -m "界面：精简提交信息 Webview"
```

---

### Task 6：接线运行时并移除模拟实现

**文件：**
- 修改：`src/extension.ts`
- 修改：`test/unit/extension.test.ts`
- 删除：`src/webview/file-icons.ts`
- 删除：`src/webview/history-renderer.ts`
- 删除：`src/webview/layout-state.ts`
- 删除：`test/unit/file-icons.test.ts`
- 删除：`test/unit/history-renderer.test.ts`
- 删除：`test/unit/layout-state.test.ts`

**接口：**
- `registerReadyRuntime` 创建一个 `GitoolViewProvider`、一个 `ChangeTreeProvider`、一个 `HistoryTreeProvider` 和一个 `GitoolViewActions`。
- `vscode.window.createTreeView('gitool.changesView', { treeDataProvider, manageCheckboxStateManually: true })`。
- `vscode.window.createTreeView('gitool.historyView', { treeDataProvider, showCollapseAll: true })`。
- `historyTree.description` 与同步状态保持一致；`changesTree.badge` 显示当前变更文件数。

- [ ] **步骤 1：写运行时注册失败测试**

```ts
it('就绪运行时注册一个 Webview 和两个原生 TreeView', async () => {
  await activate(context());
  expect(registeredWebviews).toEqual(['gitool.commitView']);
  expect(createdTrees.map((tree) => tree.id)).toEqual([
    'gitool.changesView', 'gitool.historyView',
  ]);
  expect(createdTrees[0]?.options.manageCheckboxStateManually).toBe(true);
});
```

- [ ] **步骤 2：运行并确认仅注册单 Webview 导致失败**

运行：`npx vitest run test/unit/extension.test.ts`

预期：FAIL，`createTreeView` 尚未调用。

- [ ] **步骤 3：完成 Provider、命令和状态接线**

在 `registerReadyRuntime` 中按“服务 → 动作控制器 → Provider → View → 命令”顺序创建，按相反顺序释放。订阅 `repositoryService.onDidChange`，同步：

```ts
changesTree.badge = model.changeCount === 0
  ? undefined
  : { value: model.changeCount, tooltip: `Gitool：${model.changeCount} 个变更文件` };
historyTree.description = historyProvider.getDescription();
```

错误运行时为三个 View 都注册可理解的错误内容：提交 View 使用 Error Webview；两个 TreeView 使用空 Provider 并设置相同错误 message。

- [ ] **步骤 4：删除模拟文件并验证无残留引用**

运行：`rg -n "file-icons|history-renderer|layout-state|resolveFileIcon|renderHistory|installResizer" src test media`

预期：无输出。

- [ ] **步骤 5：运行所有单元测试和静态检查**

运行：`npm run check`

预期：类型检查、ESLint、全部 Vitest 测试通过且无警告。

- [ ] **步骤 6：提交**

```bash
git add src/extension.ts src/views test/unit/extension.test.ts package.json
git add -u src/webview test/unit
git commit -m "功能：接入 Gitool 原生三分区运行时"
```

---

### Task 7：真实 Extension Host 验收与 0.2.0 交付

**文件：**
- 修改：`test/vscode/suite/extension.test.ts`
- 修改：`CHANGELOG.md`
- 修改：`README.md`

**接口：**
- 保持现有测试命令 `gitool.test.*` 可用。
- 新增测试命令 `gitool.test.getViewState`，返回三个 View 的已注册状态、变更 badge 和历史 description，供 Extension Host 验收，不暴露生产私有对象。

- [ ] **步骤 1：写 Extension Host 失败验收**

```ts
it('注册原生三分区并同步变更数量与上游位置', async () => {
  const state = await vscode.commands.executeCommand<GitoolViewTestState>(
    'gitool.test.getViewState',
  );
  assert.deepStrictEqual(state.viewIds, [
    'gitool.commitView', 'gitool.changesView', 'gitool.historyView',
  ]);
  assert.strictEqual(state.changeBadge, 2);
  assert.match(state.historyDescription, /origin\/main/);
});
```

- [ ] **步骤 2：运行并确认测试命令不存在导致失败**

运行：`env -u ELECTRON_RUN_AS_NODE npm run test:vscode`

预期：FAIL，`gitool.test.getViewState` 尚未注册。

- [ ] **步骤 3：实现只读测试状态并补充交付说明**

在测试模式注册 `gitool.test.getViewState`；README 说明三个原生分区、文件图标跟随主题和标题栏图标操作；CHANGELOG 在 0.2.0 下记录原生 TreeView 改造，不修改版本号。

- [ ] **步骤 4：执行真实 Extension Host 验收**

运行：`env -u ELECTRON_RUN_AS_NODE npm run test:vscode`

预期：全部 Extension Host 测试通过。

- [ ] **步骤 5：检查 VSIX 文件清单**

运行：`npx vsce ls --no-dependencies`

预期：不包含 `.worktrees/`、测试源码、设计文档或 `.serena/`，包含 `dist/extension.js`、`media/main.js`、`media/main.css`、图标、README、CHANGELOG、LICENSE 和 manifest。

- [ ] **步骤 6：打包并核对产物**

运行：`npm run package`

预期：生成 `/Users/xbyzzz/code_home/work_space/gitool/gitool-file-commit-0.2.0.vsix`。

运行：`shasum -a 256 gitool-file-commit-0.2.0.vsix && git diff --check && git status --short`

预期：输出稳定 SHA-256；无空白错误；工作树只保留用户原有 `.serena/`。

- [ ] **步骤 7：提交**

```bash
git add test/vscode/suite/extension.test.ts README.md CHANGELOG.md src/extension.ts
git commit -m "测试：验收 Gitool 原生三分区视图"
```

---

## 完成标准

- Gitool 容器包含三个可独立折叠、可拖动调整高度的 VS Code View。
- 当前变更和历史文件使用用户当前 VS Code 文件图标主题。
- 原生树行不再由扩展设置大号字体或固定 `28px/32px` 行高。
- 提交历史展开由原生树层级完成，不存在手绘断裂图线。
- 舍弃、远程、拉取、推送、刷新使用 VS Code 产品图标和中文 tooltip。
- 精确选择提交、废纸篓二次确认、上游同步和过期快照保护全部回归通过。
- `npm run check`、Extension Host 验收、VSIX 清单检查和打包全部通过。
