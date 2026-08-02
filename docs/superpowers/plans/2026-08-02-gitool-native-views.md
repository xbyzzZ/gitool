# Gitool 原生当前变更视图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 保持提交信息和提交历史的现有展示样式，只把当前变更迁移为 VS Code 原生 TreeView，并把三个区域交给 VS Code 原生管理折叠、拖动和高度恢复。

**架构：** `RepositoryService` 继续提供统一仓库快照；新增 `ChangeTreeProvider` 消费该快照并用 `resourceUri + ThemeIcon.File` 渲染原生文件树。现有单 Webview 拆成提交信息 Webview 与提交历史 Webview，两者只保留各自现有内容，所有 View 共享服务状态和原生命令控制器。

**技术栈：** TypeScript 6、VS Code Extension API 1.125、WebviewViewProvider、TreeDataProvider、TreeItem checkbox、Vitest、Mocha Extension Host、esbuild、vsce。

## 全局约束

- 所有用户可见文字、代码注释、测试名称、提交信息和文档使用简体中文。
- 不使用子代理，所有任务在当前会话内顺序执行并独立验证。
- 提交信息和提交历史的内容展示样式不变，提交历史继续保留现有拓扑、分支颜色、引用标签和展开文件样式。
- 只有当前变更使用 VS Code 原生 TreeView 样式。
- 文件节点必须设置真实 `resourceUri` 和 `vscode.ThemeIcon.File`，不解析文件图标主题私有文件，不引入第三方图标包。
- 空的已跟踪、未跟踪和冲突分组不生成节点。
- 未跟踪文件默认不选择；未选文件及其既有暂存状态保持不变。
- 舍弃只处理已选择的具体未跟踪文件，必须二次确认并移入系统废纸篓。
- 提交、推送、拉取、远程设置、仓库锁和过期快照校验的业务合同保持不变。
- 每项行为修改先写失败测试，确认失败原因后再写最小实现。

---

## 文件结构

- 新建 `src/views/change-tree-provider.ts`：构造当前变更分组、目录和文件 TreeItem，管理原生复选框事件。
- 新建 `src/views/view-actions.ts`：承接刷新、当前文件 Diff、废纸篓、远程设置、拉取、推送和历史刷新命令。
- 新建 `src/webview/commit-client.ts`：只处理提交信息、AI、仓库选择和提交操作。
- 新建 `src/webview/history-client.ts`：只处理提交历史渲染、展开详情和历史 Diff。
- 修改 `src/webview/render.ts`：分别生成提交信息和提交历史 HTML，保留现有内容类名。
- 修改 `src/webview/view-provider.ts`：提供两个受限 Webview Provider，共享 `RepositoryService`。
- 修改 `src/extension.ts`：注册三个 View、原生命令和统一释放链路。
- 修改 `package.json`、`esbuild.mjs`、`media/main.css`：声明三个 View、构建两个 Webview 脚本并删除内部三分区布局样式。
- 删除 `src/webview/file-icons.ts`、`src/webview/layout-state.ts` 及对应测试；保留 `history-renderer.ts`。
- 新建 `test/unit/change-tree-provider.test.ts`、`test/unit/view-actions.test.ts`、`test/unit/package-contributions.test.ts`。
- 修改 `test/unit/render.test.ts`、`test/unit/view-provider.test.ts`、`test/unit/extension.test.ts`、`test/vscode/suite/extension.test.ts`。

---

### 任务 1：声明三个独立 View 和原生命令

**文件：**
- 修改：`package.json`
- 新建：`test/unit/package-contributions.test.ts`

**接口：**
- 产出 View ID：`gitool.commitView`、`gitool.changesView`、`gitool.historyView`。
- 产出命令 ID：`gitool.editRemote`、`gitool.refreshChanges`、`gitool.trashUntracked`、`gitool.openChange`、`gitool.pull`、`gitool.pushAll`、`gitool.refreshHistory`。

- [ ] **步骤 1：写贡献点失败测试**

```ts
it('贡献提交信息、当前变更和提交历史三个独立视图', () => {
  expect(manifest.contributes.views.gitool).toEqual([
    { type: 'webview', id: 'gitool.commitView', name: '提交信息' },
    { id: 'gitool.changesView', name: '当前变更' },
    { type: 'webview', id: 'gitool.historyView', name: '提交历史' },
  ]);
});

it('标题栏命令位于对应视图', () => {
  expect(titleCommands('gitool.commitView')).toEqual(['gitool.editRemote']);
  expect(titleCommands('gitool.changesView')).toEqual(['gitool.refreshChanges']);
  expect(titleCommands('gitool.historyView')).toEqual([
    'gitool.pull', 'gitool.pushAll', 'gitool.refreshHistory',
  ]);
});
```

- [ ] **步骤 2：运行失败测试**

运行：`npx vitest run test/unit/package-contributions.test.ts`

预期：FAIL，明确显示仍只有 `gitool.commitView`，且缺少原生命令贡献。

- [ ] **步骤 3：最小修改贡献点**

在 `package.json` 中声明三个 View；命令图标依次使用 `$(remote)`、`$(refresh)`、`$(trash)`、`$(cloud-download)`、`$(cloud-upload)`。通过 `menus.view/title` 把命令放入对应标题栏，通过 `menus.view/item/context` 只在 `view == gitool.changesView && viewItem == gitool.untrackedFile` 时显示垃圾桶。

- [ ] **步骤 4：运行贡献点测试**

运行：`npx vitest run test/unit/package-contributions.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add package.json test/unit/package-contributions.test.ts
git commit -m "界面：声明 Gitool 三个独立视图"
```

---

### 任务 2：实现当前变更原生 TreeView

**文件：**
- 新建：`src/views/change-tree-provider.ts`
- 新建：`test/unit/change-tree-provider.test.ts`
- 修改：`src/domain/change-groups.ts`

**接口：**
- 消费：`RepositoryService.getViewModel()`、`RepositoryService.onDidChange`、`RepositoryService.getRepository(id)`、`RepositoryService.setFileSelected(fileId, selected)`、`RepositoryService.setGroup(kind, selected)`。
- 产出：`ChangeTreeProvider implements vscode.TreeDataProvider<ChangeTreeNode>`。
- 产出：`ChangeTreeNode = ChangeSectionNode | ChangeDirectoryNode | ChangeFileNode`。
- 产出：`bindCheckboxes(tree: vscode.TreeView<ChangeTreeNode>): vscode.Disposable`。

- [ ] **步骤 1：写空分组和文件图标失败测试**

```ts
it('不返回没有文件的分组', async () => {
  expect(await provider.getChildren()).toEqual([
    expect.objectContaining({ kind: 'section', section: 'tracked' }),
  ]);
});

it('文件节点使用当前文件图标主题', () => {
  const item = provider.getTreeItem(fileNode);
  expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/job.py');
  expect(item.iconPath).toBe(vscode.ThemeIcon.File);
  expect(item.label).toBe('job.py');
  expect(item.description).toContain('src');
});
```

- [ ] **步骤 2：运行失败测试**

运行：`npx vitest run test/unit/change-tree-provider.test.ts`

预期：FAIL，模块尚不存在。

- [ ] **步骤 3：实现节点模型与 TreeItem**

```ts
export type ChangeTreeNode =
  | { readonly kind: 'section'; readonly section: ChangeSectionKind }
  | { readonly kind: 'directory'; readonly section: ChangeSectionKind; readonly path: string }
  | { readonly kind: 'file'; readonly repositoryId: string; readonly change: FileChange };
```

根节点只返回文件数大于零的分组；文件节点用仓库 `rootUri` 和 `change.path` 构造 `resourceUri`，设置 `ThemeIcon.File`、checkboxState、中文 tooltip、contextValue 和 `gitool.openChange` 命令。

- [ ] **步骤 4：写复选框同步失败测试**

```ts
it('文件复选框变化写回选择状态', () => {
  checkboxEvent.fire({ items: [[fileNode, vscode.TreeItemCheckboxState.Unchecked]] });
  expect(service.getViewModel().selectedIds).not.toContain(fileNode.change.id);
});

it('未跟踪分组复选框变化写回整组状态', () => {
  checkboxEvent.fire({ items: [[untrackedSection, vscode.TreeItemCheckboxState.Checked]] });
  expect(service.getViewModel().selectedIds).toContain('.serena/project.yml');
});
```

- [ ] **步骤 5：确认失败后实现手动复选框管理**

`bindCheckboxes` 只接受本 Provider 的节点：文件节点调用 `setFileSelected`，已跟踪和未跟踪分组调用 `setGroup`，冲突分组和目录节点不写入选择状态。Provider 订阅服务变化并刷新树，同时更新 TreeView description 为 `已选择 N / M 个文件`。

- [ ] **步骤 6：运行当前变更测试**

运行：`npx vitest run test/unit/change-tree-provider.test.ts test/unit/change-groups.test.ts test/unit/repository-service.test.ts`

预期：PASS。

- [ ] **步骤 7：提交**

```bash
git add src/views/change-tree-provider.ts src/domain/change-groups.ts test/unit/change-tree-provider.test.ts
git commit -m "界面：实现当前变更原生文件树"
```

---

### 任务 3：迁移原生 View 操作

**文件：**
- 新建：`src/views/view-actions.ts`
- 新建：`test/unit/view-actions.test.ts`
- 修改：`src/webview/view-provider.ts`
- 修改：`test/unit/view-provider.test.ts`

**接口：**
- 消费：`RepositoryService`、`BuiltinGitApi` 和 VS Code 窗口 API。
- 产出：`GitoolViewActions`，提供 `editRemote()`、`refreshChanges()`、`openChange(node)`、`trashUntracked(node?)`、`pull()`、`pushAll()`、`refreshHistory()`。
- 产出：`registerViewCommands(actions): readonly vscode.Disposable[]`。

- [ ] **步骤 1：写 Diff 与废纸篓失败测试**

```ts
it('打开原生文件节点对应的当前差异', async () => {
  await actions.openChange(fileNode);
  expect(executeCommand).toHaveBeenCalledWith(
    'vscode.diff', expect.anything(), expect.anything(), 'job.py（工作区变更）',
  );
});

it('垃圾桶只处理当前已选择的未跟踪文件', async () => {
  await actions.trashUntracked();
  expect(trash).toHaveBeenCalledWith({
    repositoryId: '/workspace/repo', version: 7,
    fileIds: ['.serena/project.yml'],
  });
});
```

- [ ] **步骤 2：运行失败测试**

运行：`npx vitest run test/unit/view-actions.test.ts`

预期：FAIL，动作控制器模块尚不存在。

- [ ] **步骤 3：迁移现有受控动作**

从现有 `GitoolViewProvider` 提取已经验证的当前 Diff、废纸篓确认、远程设置、拉取、推送和刷新流程。所有操作先读取 `{ repositoryId, version, model }`，继续调用现有 RepositoryService 方法，不复制 Git 写入逻辑；失败通过 `reportFailure` 写回统一状态。

- [ ] **步骤 4：写命令注册失败测试**

```ts
it('注册并释放七个原生视图命令', () => {
  const registrations = registerViewCommands(actions);
  expect(registeredIds).toEqual([
    'gitool.editRemote', 'gitool.refreshChanges', 'gitool.trashUntracked',
    'gitool.openChange', 'gitool.pull', 'gitool.pushAll',
    'gitool.refreshHistory',
  ]);
  registrations.forEach((item) => item.dispose());
  expect(activeIds).toEqual([]);
});
```

- [ ] **步骤 5：实现命令注册并运行测试**

运行：`npx vitest run test/unit/view-actions.test.ts test/unit/view-provider.test.ts`

预期：PASS，且提交、AI 和历史操作的现有测试继续通过。

- [ ] **步骤 6：提交**

```bash
git add src/views/view-actions.ts src/webview/view-provider.ts test/unit/view-actions.test.ts test/unit/view-provider.test.ts
git commit -m "重构：迁移 Gitool 原生视图操作"
```

---

### 任务 4：拆分提交信息与提交历史 Webview

**文件：**
- 新建：`src/webview/commit-client.ts`
- 新建：`src/webview/history-client.ts`
- 修改：`src/webview/render.ts`
- 修改：`src/webview/view-provider.ts`
- 修改：`src/webview/client.ts`
- 修改：`esbuild.mjs`
- 修改：`media/main.css`
- 修改：`test/unit/render.test.ts`
- 修改：`test/unit/view-provider.test.ts`
- 保留：`src/webview/history-renderer.ts`

**接口：**
- 产出：`renderCommitWebviewHtml(webview, extensionUri, nonce): string`。
- 产出：`renderHistoryWebviewHtml(webview, extensionUri, nonce): string`。
- 产出：`GitoolCommitViewProvider.viewType = 'gitool.commitView'`。
- 产出：`GitoolHistoryViewProvider.viewType = 'gitool.historyView'`。

- [ ] **步骤 1：写两个 HTML 边界失败测试**

```ts
it('提交页面只保留现有提交内容', () => {
  const html = renderCommitWebviewHtml(webview, extensionUri, 'nonce');
  expect(html).toContain('id="commit-message"');
  expect(html).toContain('id="ai-generate-button"');
  expect(html).not.toContain('id="tracked-group"');
  expect(html).not.toContain('id="history-list"');
});

it('历史页面保留现有拓扑列表且没有内部标题栏', () => {
  const html = renderHistoryWebviewHtml(webview, extensionUri, 'nonce');
  expect(html).toContain('id="history-list"');
  expect(html).toContain('class="history-list"');
  expect(html).not.toContain('id="collapse-history-button"');
  expect(html).not.toContain('id="changes-history-resizer"');
});
```

- [ ] **步骤 2：运行失败测试**

运行：`npx vitest run test/unit/render.test.ts test/unit/view-provider.test.ts`

预期：FAIL，当前只有单页面渲染函数和单 Provider。

- [ ] **步骤 3：拆分渲染与客户端入口**

提交页面保留现有提交内容节点和类名；历史页面保留 `history-status`、`history-list` 以及 `history-renderer.ts` 生成的现有提交行结构。两个页面分别加载 `commit.js`、`history.js`，只查询各自存在的控件，避免用可空查询隐藏缺失控件。

- [ ] **步骤 4：拆分两个 Provider**

两个 Provider 订阅同一 `RepositoryService`。提交 Provider 只处理仓库选择、提交信息、AI、提交和提交并推送消息；历史 Provider 只处理提交详情、历史 Diff 和状态展示。标题和同步摘要通过 `WebviewView.title/description` 或原生命令刷新，不再渲染内部标题栏。

- [ ] **步骤 5：收紧 CSS 并保留历史展示**

删除 `.layout`、`.workbench-pane`、`.pane-resizer`、`.change-group`、`.file-row` 和内部折叠按钮样式；保留并不改动 `.commit-row`、`.graph-cell`、`.graph-dot`、`.commit-file`、`.commit-refs` 等历史展示规则。提交和历史页面各自使用 `height: 100vh; overflow: auto` 填满外层 View。

- [ ] **步骤 6：运行 Webview 测试**

运行：`npx vitest run test/unit/render.test.ts test/unit/view-provider.test.ts test/unit/history-renderer.test.ts test/unit/webview-client.test.ts`

预期：PASS，历史渲染器快照和行为保持原有结构。

- [ ] **步骤 7：提交**

```bash
git add src/webview/commit-client.ts src/webview/history-client.ts src/webview/render.ts src/webview/view-provider.ts src/webview/client.ts esbuild.mjs media/main.css test/unit/render.test.ts test/unit/view-provider.test.ts
git commit -m "界面：拆分提交与历史 Webview"
```

---

### 任务 5：接入运行时并删除模拟布局

**文件：**
- 修改：`src/extension.ts`
- 修改：`test/unit/extension.test.ts`
- 修改：`test/vscode/suite/extension.test.ts`
- 删除：`src/webview/file-icons.ts`
- 删除：`src/webview/layout-state.ts`
- 删除：`test/unit/file-icons.test.ts`
- 删除：`test/unit/layout-state.test.ts`

**接口：**
- `registerReadyRuntime` 创建提交 Webview Provider、当前变更 TreeView、历史 Webview Provider和 `GitoolViewActions`。
- 所有注册项进入 `Runtime` 统一反向释放。

- [ ] **步骤 1：写运行时失败测试**

```ts
it('注册两个 Webview Provider 和一个原生 TreeView', async () => {
  await activate(context);
  expect(registeredWebviews).toEqual(['gitool.commitView', 'gitool.historyView']);
  expect(createdTrees).toEqual(['gitool.changesView']);
});
```

- [ ] **步骤 2：运行失败测试**

运行：`npx vitest run test/unit/extension.test.ts`

预期：FAIL，当前运行时仍只注册单一 Webview。

- [ ] **步骤 3：接入三个 View**

在 `registerReadyRuntime` 中创建共享 RepositoryService，然后依次注册提交 Provider、原生变更 TreeView、历史 Provider、复选框绑定和命令控制器。释放顺序确保 View 监听先注销，再释放 RepositoryService。

- [ ] **步骤 4：删除不再可达的模拟实现**

确认 `rg "resolveFileIcon|layout-state|changes-history-resizer|collapse-history-button" src test` 只剩历史兼容测试允许的引用后，删除文件图标硬编码和 Webview 三分区布局模块及其测试；不删除 `history-renderer.ts`。

- [ ] **步骤 5：扩展 Extension Host 验收**

测试确认三个 View 已注册、变更 TreeView 文件节点可选择、刷新命令可执行、原有精确提交和远程流程仍通过。视觉项由真实 VS Code 手工验收：空分组、Python/Jupyter 图标、底部历史折叠与高度恢复、历史样式不变。

- [ ] **步骤 6：运行全量验证**

运行：

```bash
npm run check
env -u ELECTRON_RUN_AS_NODE npm run test:vscode
npx vsce ls --no-dependencies
npm run package
```

预期：类型检查、lint、全部 Vitest、3 项以上 Extension Host 测试和 VSIX 打包全部退出 0；VSIX 不包含 `.worktrees/`、`.serena/` 或已删除的模拟脚本。

- [ ] **步骤 7：提交**

```bash
git add src/extension.ts test/unit/extension.test.ts test/vscode/suite/extension.test.ts src/webview test/unit package.json media esbuild.mjs
git commit -m "界面：完成原生当前变更视图迁移"
```

---

## 执行方式

本计划固定采用当前会话内顺序执行。每个任务严格执行 RED、GREEN、回归验证和独立提交；不使用子代理，不并行修改共享文件。
