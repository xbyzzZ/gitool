# Gitool 原生提交历史实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把按时间平铺的提交历史迁移为 VS Code 原生 TreeView，并保留提交详情懒加载、历史文件 Diff、同步命令和标题状态。

**架构：** 新增 `HistoryTreeProvider` 直接消费 `RepositoryService` 快照，根节点表示提交、子节点表示该提交的改动文件。提交信息、作者、时间、哈希和引用通过原生 label、description、ThemeIcon 与 tooltip 表达；历史 Webview 及其脚本、拓扑渲染器和专用 CSS 被删除。

**技术栈：** TypeScript 6、VS Code Extension API 1.125、TreeDataProvider、TreeItem、ThemeIcon、ThemeColor、Vitest、Mocha Extension Host、esbuild、vsce。

## 全局约束

- 所有用户可见文字、代码注释、测试名称、文档和 Git 提交信息使用简体中文。
- 不使用子代理；在当前会话内顺序执行、验证和提交。
- 根提交节点严格保持 `HistoryService` 返回顺序，不模拟拓扑线，不按分支复制提交。
- 提交信息、作者、相对时间、短哈希和引用名称在同一原生行表达。
- 历史文件节点必须使用真实 `resourceUri` 和 `vscode.ThemeIcon.File`，不解析文件图标主题私有文件。
- 详情缓存必须绑定仓库 ID、仓库版本和提交哈希；仓库切换或版本变化后旧缓存失效。
- 拉取、推送全部、刷新历史、提交详情和历史 Diff 的业务合同保持不变。
- 提交信息 Webview 和当前变更 TreeView 的展示与交互不变。
- 每项行为修改先写失败测试，确认失败原因后再写最小实现。
- 保留用户现有的未跟踪 `.serena/`，不得加入任何提交。

---

## 文件结构

- 新建 `src/views/history-tree-provider.ts`：提交节点、文件节点、详情缓存、View description/message 和原生图标。
- 新建 `test/unit/history-tree-provider.test.ts`：时间顺序、单行信息、引用图标、懒加载、缓存失效、文件图标和状态消息。
- 修改 `src/views/view-actions.ts`：新增原生历史文件 Diff 动作和命令注册。
- 修改 `test/unit/view-actions.test.ts`：覆盖新增、删除、修改与重命名历史文件 Diff。
- 修改 `package.json`、`test/unit/package-contributions.test.ts`：提交历史改为普通 Tree View，声明历史文件命令。
- 修改 `src/extension.ts`、`test/unit/extension.test.ts`、`test/vscode/suite/extension.test.ts`：注册历史 TreeView 并释放资源。
- 修改 `src/webview/view-provider.ts`、`src/webview/render.ts`、`src/webview/commit-client.ts` 及对应测试：收紧为提交信息专用 Webview。
- 修改 `esbuild.mjs`、`eslint.config.mjs`、`.gitignore`、`media/main.css`：删除历史 Webview 构建和样式。
- 删除 `src/webview/history-client.ts`、`src/webview/history-renderer.ts`、`src/webview/file-icons.ts` 及对应单元测试。

---

### 任务 1：声明原生提交历史 View

**文件：**
- 修改：`package.json`
- 修改：`test/unit/package-contributions.test.ts`

**接口：**
- 产出 View：`gitool.historyView`，类型为普通 Tree View。
- 产出命令：`gitool.openHistoryChange`，仅供历史文件节点调用。
- 保留标题命令：`gitool.pull`、`gitool.pushAll`、`gitool.refreshHistory`。

- [ ] **步骤 1：写贡献点失败测试**

```ts
it('把提交历史声明为原生树并保留标题栏同步命令', () => {
  expect(manifest.contributes.views.gitool).toContainEqual({
    id: 'gitool.historyView',
    name: '提交历史',
  });
  expect(manifest.contributes.views.gitool).not.toContainEqual(
    expect.objectContaining({ id: 'gitool.historyView', type: 'webview' }),
  );
  expect(commandIds()).toContain('gitool.openHistoryChange');
  expect(titleCommands('gitool.historyView')).toEqual([
    'gitool.pull', 'gitool.pushAll', 'gitool.refreshHistory',
  ]);
});
```

- [ ] **步骤 2：运行测试并确认失败原因**

运行：`npx vitest run test/unit/package-contributions.test.ts`

预期：FAIL，显示 `gitool.historyView` 仍含 `type: 'webview'` 且缺少 `gitool.openHistoryChange`。

- [ ] **步骤 3：最小修改贡献点**

删除历史 View 的 `type: 'webview'`，新增中文标题为“Gitool：打开历史文件改动”的 `gitool.openHistoryChange`。现有三个 `view/title` 菜单条件保持 `view == gitool.historyView`。

- [ ] **步骤 4：运行贡献点测试**

运行：`npx vitest run test/unit/package-contributions.test.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add package.json test/unit/package-contributions.test.ts
git commit -m "界面：声明原生提交历史视图"
```

---

### 任务 2：实现提交历史根节点与原生元数据

**文件：**
- 新建：`src/views/history-tree-provider.ts`
- 新建：`test/unit/history-tree-provider.test.ts`

**接口：**
- 消费：`HistoryTreeService.getViewModel()`、`HistoryTreeService.onDidChange`。
- 产出：`HistoryTreeProvider implements vscode.TreeDataProvider<HistoryTreeNode>`。
- 产出节点：`HistoryCommitNode` 和 `HistoryFileNode`。
- 产出绑定：`bindView(tree: vscode.TreeView<HistoryTreeNode>): vscode.Disposable`。

- [ ] **步骤 1：写根节点与元数据失败测试**

```ts
it('按服务顺序生成单行提交节点并显示全部引用', () => {
  const nodes = provider.getChildren();
  expect(nodes.map((node) => node.kind === 'commit' && node.commit.hash))
    .toEqual(['newest', 'merge', 'oldest']);
  const item = provider.getTreeItem(nodes[0]);
  expect(item.label).toBe('修复：原生历史列表');
  expect(item.description).toBe(
    '许博阳 · 5 分钟前 · abc1234 · HEAD main · origin/main',
  );
});

it('用原生图标优先表达 HEAD 本地远程和普通提交', () => {
  expect(iconId(headCommit)).toBe('target');
  expect(iconId(localCommit)).toBe('git-branch');
  expect(iconId(remoteCommit)).toBe('cloud');
  expect(iconId(plainCommit)).toBe('git-commit');
});

it('把同步和历史状态写入原生 View 元数据', () => {
  provider.bindView(tree);
  expect(tree.description).toBe('origin/main · ↑3 ↓1');
  expect(tree.message).toBe('正在读取提交历史…');
});
```

- [ ] **步骤 2：运行测试并确认模块缺失**

运行：`npx vitest run test/unit/history-tree-provider.test.ts`

预期：FAIL，模块 `history-tree-provider` 尚不存在。

- [ ] **步骤 3：实现根节点和 TreeItem**

定义：

```ts
export interface HistoryCommitNode {
  readonly kind: 'commit';
  readonly repositoryId: string;
  readonly version: number;
  readonly commit: CommitGraphNode;
}

export interface HistoryFileNode {
  readonly kind: 'file';
  readonly repositoryId: string;
  readonly version: number;
  readonly hash: string;
  readonly parentHash?: string;
  readonly file: CommitFile;
}
```

根级 `getChildren()` 直接映射 `model.history.commits`。提交 TreeItem 使用 `TreeItemCollapsibleState.Collapsed`；description 依次拼接作者、`relativeTime(authoredAt)`、短哈希和引用显示名。图标优先级固定为 `target`、`git-branch`、`cloud`、`git-commit`，颜色分别使用 `charts.blue`、`charts.green`、`charts.yellow`、`descriptionForeground`。

- [ ] **步骤 4：实现 View description 和 message**

`bindView()` 保存 TreeView 引用并立即更新：同步状态映射为“游离 HEAD”、“未设置上游”或 `${upstream} · ↑${ahead} ↓${behind}`；历史状态映射为加载、空历史、失败原因或空字符串。服务变化时同时刷新根节点和元数据。

- [ ] **步骤 5：运行测试、类型检查和 lint**

运行：`npx vitest run test/unit/history-tree-provider.test.ts && npm run typecheck && npm run lint`

预期：PASS，且无类型或 lint 错误。

- [ ] **步骤 6：提交**

```bash
git add src/views/history-tree-provider.ts test/unit/history-tree-provider.test.ts
git commit -m "界面：实现原生提交历史节点"
```

---

### 任务 3：实现详情懒加载与历史文件节点

**文件：**
- 修改：`src/views/history-tree-provider.ts`
- 修改：`test/unit/history-tree-provider.test.ts`

**接口：**
- 消费：`HistoryTreeService.loadCommitDetails(request)`、`getRepository(id)`、`reportFailure(action, message)`。
- 产出：提交节点 `getChildren(node)` 的详情缓存和 `HistoryFileNode[]`。
- 文件命令参数：`gitool.openHistoryChange` 接收完整 `HistoryFileNode`。

- [ ] **步骤 1：写懒加载、缓存与文件节点失败测试**

```ts
it('同一仓库快照重复展开只加载一次详情', async () => {
  await provider.getChildren(commitNode);
  await provider.getChildren(commitNode);
  expect(loadCommitDetails).toHaveBeenCalledOnce();
});

it('仓库版本变化后丢弃旧缓存并重新加载', async () => {
  await provider.getChildren(commitNode);
  service.replaceModel(model({ version: 8 }));
  await provider.getChildren(nextCommitNode);
  expect(loadCommitDetails).toHaveBeenCalledTimes(2);
});

it('历史文件使用当前文件图标主题并绑定历史 Diff 命令', async () => {
  const [node] = await provider.getChildren(commitNode);
  const item = provider.getTreeItem(node);
  expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/job.py');
  expect(item.iconPath).toBe(vscode.ThemeIcon.File);
  expect(item.description).toBe('src · M');
  expect(item.command).toEqual({
    command: 'gitool.openHistoryChange',
    title: '打开历史文件改动',
    arguments: [node],
  });
});
```

- [ ] **步骤 2：运行测试并确认缺少子节点行为**

运行：`npx vitest run test/unit/history-tree-provider.test.ts`

预期：FAIL，提交节点仍没有详情缓存和文件子节点。

- [ ] **步骤 3：实现快照级详情缓存**

缓存键使用 `${repositoryId}\u0000${version}\u0000${hash}`。服务变化时比较当前 `{ repositoryId, version }`；范围变化立即清空缓存。加载成功前不写缓存；加载失败调用 `reportFailure('读取提交详情', message)` 后重新抛出，允许下一次展开重试。

- [ ] **步骤 4：实现历史文件 TreeItem**

文件名用 POSIX `basename`，description 使用 `[dirname, status].filter(Boolean).join(' · ')`。设置真实仓库 `resourceUri`、`ThemeIcon.File`、重命名 tooltip 和 `gitool.openHistoryChange` 命令。文件节点为 `TreeItemCollapsibleState.None` 且没有 checkbox。

- [ ] **步骤 5：运行局部与相关回归测试**

运行：`npx vitest run test/unit/history-tree-provider.test.ts test/unit/history-service.test.ts`

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add src/views/history-tree-provider.ts test/unit/history-tree-provider.test.ts
git commit -m "功能：支持原生历史详情展开"
```

---

### 任务 4：迁移历史文件 Diff 命令

**文件：**
- 修改：`src/views/view-actions.ts`
- 修改：`test/unit/view-actions.test.ts`

**接口：**
- 产出：`GitoolViewActions.openHistoryChange(node: HistoryFileNode): Promise<void>`。
- `registerViewCommands` 新增 `gitool.openHistoryChange`。

- [ ] **步骤 1：写四类历史 Diff 失败测试**

```ts
it.each([
  ['M', 'parent-uri', 'commit-uri'],
  ['A', 'empty-uri', 'commit-uri'],
  ['D', 'parent-uri', 'empty-uri'],
  ['R', 'old-parent-uri', 'new-commit-uri'],
])('状态 %s 打开正确的历史比较', async (_status, left, right) => {
  await actions.openHistoryChange(historyFileNode(_status));
  expect(executeCommand).toHaveBeenCalledWith(
    'vscode.diff', expectUri(left), expectUri(right), expect.any(String),
  );
});
```

- [ ] **步骤 2：运行测试并确认动作不存在**

运行：`npx vitest run test/unit/view-actions.test.ts`

预期：FAIL，`openHistoryChange` 和命令注册尚不存在。

- [ ] **步骤 3：迁移现有历史 Diff URI 逻辑**

从提交 Webview Provider 的 `openCommitDiff` 提取相同行为到 `GitoolViewActions`。先校验节点仓库和版本仍匹配当前快照，再取得真实仓库；新增/删除使用 `gitool-empty:` URI，修改/重命名使用 `gitApi.toGitUri` 生成父提交和当前提交 URI。

- [ ] **步骤 4：注册命令并统一上报错误**

把 `gitool.openHistoryChange` 加入 `registerViewCommands`，动作名使用“打开历史改动”，继续通过 `actions.reportFailure` 进入统一失败状态。

- [ ] **步骤 5：运行相关测试、类型检查和 lint**

运行：`npx vitest run test/unit/view-actions.test.ts test/unit/view-provider.test.ts && npm run typecheck && npm run lint`

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add src/views/view-actions.ts test/unit/view-actions.test.ts
git commit -m "重构：迁移历史文件差异命令"
```

---

### 任务 5：接入历史 TreeView 并删除历史 Webview

**文件：**
- 修改：`src/extension.ts`
- 修改：`src/webview/view-provider.ts`
- 修改：`src/webview/render.ts`
- 修改：`src/webview/commit-client.ts`
- 修改：`esbuild.mjs`
- 修改：`eslint.config.mjs`
- 修改：`.gitignore`
- 修改：`media/main.css`
- 修改：`test/unit/extension.test.ts`
- 修改：`test/unit/view-provider.test.ts`
- 修改：`test/unit/render.test.ts`
- 删除：`src/webview/history-client.ts`
- 删除：`src/webview/history-renderer.ts`
- 删除：`src/webview/file-icons.ts`
- 删除：`test/unit/history-renderer.test.ts`
- 删除：`test/unit/file-icons.test.ts`

**接口：**
- `registerReadyRuntime` 注册 `HistoryTreeProvider`、`TreeView<HistoryTreeNode>` 和 `bindView()`。
- `GitoolViewProvider` 仅提供 `gitool.commitView`。
- 构建只产出 `media/commit.js`，不再产出 `media/history.js`。

- [ ] **步骤 1：写运行时和 Webview 边界失败测试**

```ts
it('注册提交 Webview 和两个原生 TreeView', async () => {
  const runtime = await activate(context());
  expect(runtime.mode).toBe('ready');
  expect(activeViews.keys()).toEqual([
    'gitool.commitView', 'gitool.changesView', 'gitool.historyView',
  ]);
  expect(registeredWebviews).toEqual(['gitool.commitView']);
});

it('提交页面不再提供历史 HTML', () => {
  expect(renderCommitWebviewHtml(webview, extensionUri, 'nonce'))
    .not.toContain('history-list');
  expect(renderModule).not.toHaveProperty('renderHistoryWebviewHtml');
});
```

- [ ] **步骤 2：运行测试并确认历史仍注册为 Webview**

运行：`npx vitest run test/unit/extension.test.ts test/unit/render.test.ts test/unit/view-provider.test.ts`

预期：FAIL，运行时仍创建 `GitoolHistoryViewProvider`，渲染模块仍导出历史 HTML。

- [ ] **步骤 3：在运行时注册原生历史树**

创建共享 `HistoryTreeProvider(repositoryService)`，调用：

```ts
const historyTree = vscode.window.createTreeView<HistoryTreeNode>(
  'gitool.historyView',
  { treeDataProvider: historyProvider, showCollapseAll: true },
);
```

按“Provider → TreeView → bindView disposable”的顺序加入统一释放链路，确保反向释放时先注销绑定和 View，再释放 Provider 与 RepositoryService。

- [ ] **步骤 4：收紧提交 Webview Provider**

删除历史 Provider 子类、`viewKind`、历史详情消息响应和历史 Diff 响应。提交 Provider 只渲染 `renderCommitWebviewHtml` 并保留提交、推送、AI、仓库选择与提交信息状态。

- [ ] **步骤 5：删除历史 Webview 资产**

删除历史客户端、HTML、拓扑渲染器、专用文件图标映射和测试；esbuild 只构建 `commit-client.ts`；移除 `media/history.js` 的忽略与 ESLint 配置；删除 `.history-*`、`.commit-ref`、`.graph-*`、`.commit-file-*` 等只供历史 Webview 使用的 CSS。

- [ ] **步骤 6：运行全量单元验证**

运行：`npm run check && npm run build`

预期：类型检查、lint、所有 Vitest 和构建退出 0，`rg "GitoolHistoryViewProvider|renderHistoryWebviewHtml|history-client|history-renderer|resolveFileIcon" src test esbuild.mjs` 无匹配。

- [ ] **步骤 7：提交**

```bash
git add src test package.json esbuild.mjs eslint.config.mjs .gitignore media/main.css
git commit -m "界面：完成原生提交历史迁移"
```

---

### 任务 6：扩展宿主、打包与本机验收

**文件：**
- 修改：`test/vscode/suite/extension.test.ts`
- 修改：`docs/superpowers/specs/2026-08-02-gitool-native-history-design.md`（仅在交付事实与设计冲突时修订）

**接口：**
- 验收三个 View、历史刷新、同步命令和历史详情服务仍可从 Extension Host 使用。
- 产出可安装的 `gitool-file-commit-0.2.0.vsix`。

- [ ] **步骤 1：扩展 Extension Host 失败测试**

新增测试确认扩展激活后存在 `gitool.openHistoryChange`、`gitool.refreshHistory`、`gitool.pull` 和 `gitool.pushAll`，真实仓库刷新历史后返回提交摘要，且原有精确提交和远程流程保持通过。

- [ ] **步骤 2：运行 Extension Host 并修复真实边界问题**

运行：`env -u ELECTRON_RUN_AS_NODE npm run test:vscode`

预期：全部 Extension Host 测试退出 0；若失败，只按日志定位的根因修改并补相应单元测试，不添加静默兜底。

- [ ] **步骤 3：运行最终验证**

运行：

```bash
npm run check
env -u ELECTRON_RUN_AS_NODE npm run test:vscode
npx vsce ls --no-dependencies
npm run package
```

预期：所有命令退出 0；VSIX 内容包含 `media/commit.js`，不包含 `media/history.js`、`.worktrees/`、`.serena/`、源码或测试。

- [ ] **步骤 4：安装 VSIX 并人工验收**

运行：

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --install-extension gitool-file-commit-0.2.0.vsix --force
```

人工确认原生提交行密度、引用表达、历史文件主题图标、历史 Diff、底部折叠高度恢复以及提交信息和当前变更未发生视觉回归。未取得用户实际页面反馈前，只报告“已安装待验收”，不宣称视觉验收完成。

- [ ] **步骤 5：提交验收测试**

```bash
git add test/vscode/suite/extension.test.ts docs/superpowers/specs/2026-08-02-gitool-native-history-design.md
git commit -m "测试：验收原生提交历史视图"
```

---

## 执行方式

本计划固定采用当前会话内顺序执行，使用 `superpowers:executing-plans`，每个任务严格执行 RED、GREEN、回归验证和独立提交。遵循用户要求，不使用子代理。
