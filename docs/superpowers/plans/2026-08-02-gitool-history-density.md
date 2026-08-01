# Gitool 提交历史紧凑展开实施计划

> **面向代理执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施；所有步骤使用复选框跟踪。

**目标：** 将提交历史改造成接近 VS Code 图表的紧凑连续列表，使展开文件与提交共享同一轨道，并提高文件信息密度。

**架构：** `history-renderer.ts` 负责把文件路径拆成文件名和目录，并复用现有文件图标解析器生成稳定语义标记；`media/main.css` 只负责同轨布局、紧凑行高、选中态和省略优先级。历史加载、展开状态、详情缓存与 Diff 消息协议保持不变。

**技术栈：** TypeScript 6、HTML 字符串渲染、CSS Grid、Vitest 4、VS Code Webview、esbuild、vsce。

## 全局约束

- 提交行最小高度为 32px，展开文件行最小高度为 28px。
- 只高亮展开的提交行，文件列表使用普通侧栏背景。
- 提交轨道与展开文件轨道必须位于同一水平位置并连续贯穿。
- 文件行按“图标、文件名、灰色目录、最右 Git 状态”显示。
- 根目录文件不渲染虚假目录文本；窄宽度下目录先压缩，文件名和状态优先保留。
- 不改变提交排序、引用标签、历史详情加载、缓存、展开协议或 Diff 打开消息。
- 所有代码注释、测试名称、错误消息和 Git 提交信息使用简体中文。
- 不修改或提交用户的 `.serena/` 目录，不执行 `git push`。

---

### 任务 1：生成紧凑文件行语义结构

**文件：**
- 修改：`src/webview/history-renderer.ts`
- 测试：`test/unit/history-renderer.test.ts`

**接口：**
- 消费：`resolveFileIcon(path: string): FileIconPresentation`。
- 产出：`renderCommitRowMarkup` 生成 `commit-file-graph`、`commit-file-icon`、`commit-file-name`、可选 `commit-file-directory` 和 `commit-file-status`。

- [ ] **步骤 1：编写路径拆分和图标复用的失败测试**

扩展“展开时把文件放入提交行下方”用例，使用两条手工数据：

```ts
files: [
  { status: 'M', path: 'src/webview/render.ts' },
  { status: 'A', path: '.gitignore' },
]
```

断言 HTML 同时满足：

```ts
expect(html).toContain('class="commit-file-graph"');
expect(html).toContain('class="commit-file-icon file-icon blue"');
expect(html).toContain('>TS</span>');
expect(html).toContain('class="commit-file-name">render.ts</span>');
expect(html).toContain('class="commit-file-directory">src/webview</span>');
expect(html).toContain('class="commit-file-icon file-icon yellow"');
expect(html).toContain('class="commit-file-name">.gitignore</span>');
expect(html).not.toContain('class="commit-file-directory"></span>');
expect(html).toContain('data-path="src/webview/render.ts"');
expect(html).toContain('class="commit-file-status">M</span>');
```

- [ ] **步骤 2：运行测试确认旧完整路径结构失败**

运行：`npx vitest run test/unit/history-renderer.test.ts`

预期：失败；旧实现只有 `commit-file-path`，不存在图标、文件名、目录和轨道单元。

- [ ] **步骤 3：实现路径拆分和文件图标标记**

在 `history-renderer.ts` 导入 `resolveFileIcon`，增加纯函数：

```ts
function splitFilePath(path: string): {
  readonly name: string;
  readonly directory: string;
} {
  const segments = path.split('/');
  return {
    name: segments.pop() ?? path,
    directory: segments.join('/'),
  };
}
```

每个文件使用原始路径作为 `data-path` 和 title；可见结构严格按设计顺序生成。只有 `directory.length > 0` 时才生成目录 span，所有文本与属性继续通过 `escapeHtml`。

- [ ] **步骤 4：运行渲染测试并执行类型检查**

运行：

```bash
npx vitest run test/unit/history-renderer.test.ts
npm run typecheck
```

预期：渲染测试全部通过，TypeScript 无错误。

- [ ] **步骤 5：提交渲染结构**

```bash
git add src/webview/history-renderer.ts test/unit/history-renderer.test.ts
git commit -m "界面：重构历史文件紧凑信息结构"
```

### 任务 2：实现连续轨道和紧凑列表样式

**文件：**
- 修改：`media/main.css`
- 测试：`test/unit/main-css.test.ts`

**接口：**
- 消费：任务 1 生成的 `commit-file-*` 类名。
- 产出：32px 提交行、28px 文件行、同列连续轨道、普通文件背景和目录优先压缩布局。

- [ ] **步骤 1：编写紧凑展开样式的失败回归测试**

复用 `readRule` 读取 CSS 产物，增加用例：

```ts
it('历史展开使用连续轨道且文件区不形成独立卡片', () => {
  expect(readRule('.commit-row')).toMatch(/min-height:\s*32px/u);
  expect(readRule('.commit-files')).not.toMatch(/margin-left|border-left|background/u);
  expect(readRule('.commit-file')).toMatch(/min-height:\s*28px/u);
  expect(readRule('.commit-file')).toMatch(/grid-template-columns:\s*28px 19px minmax\(60px, auto\) minmax\(0, 1fr\) 18px/u);
  expect(readRule('.commit-file-graph::before')).toMatch(/width:\s*2px/u);
});
```

再断言 `.commit-file-directory` 具有 `min-width: 0`、`overflow: hidden` 和 `text-overflow: ellipsis`，状态列具有固定宽度。

- [ ] **步骤 2：运行测试确认旧错位边线和背景失败**

运行：`npx vitest run test/unit/main-css.test.ts`

预期：失败；旧 `.commit-files` 包含 `margin-left`、`border-left` 和选中背景，且不存在 `commit-file-graph` 规则。

- [ ] **步骤 3：实现 CSS Grid 连续轨道布局**

按以下边界修改样式：

```css
.commit-row {
  min-height: 32px;
}

.commit-file {
  display: grid;
  min-height: 28px;
  grid-template-columns: 28px 19px minmax(60px, auto) minmax(0, 1fr) 18px;
  gap: 5px;
  padding: 0 8px 0 0;
}

.commit-file-graph {
  position: relative;
  align-self: stretch;
}

.commit-file-graph::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--vscode-charts-blue, var(--vscode-focusBorder));
  content: "";
}
```

文件名使用前景色和单行省略；目录使用 `--vscode-descriptionForeground`、`min-width: 0` 和单行省略；图标复用 `.file-icon` 的字体、尺寸和颜色类，历史图标只补布局差异。

- [ ] **步骤 4：运行样式、渲染、lint 和类型检查**

运行：

```bash
npx vitest run test/unit/main-css.test.ts test/unit/history-renderer.test.ts
npm run typecheck
npm run lint
```

预期：目标测试、类型检查和 lint 全部通过。

- [ ] **步骤 5：提交紧凑样式**

```bash
git add media/main.css test/unit/main-css.test.ts
git commit -m "界面：收紧提交历史展开样式"
```

### 任务 3：完成全量验证与交付打包

**文件：**
- 验证：`package.json`
- 产物：`gitool-file-commit-0.2.0.vsix`

**接口：**
- 消费：历史渲染和样式提交，以及此前同分支的远程设置功能。
- 产出：通过检查并可安装的 0.2.0 VSIX；不推送远程。

- [ ] **步骤 1：运行全量质量检查**

运行：`npm run check`

预期：类型检查、ESLint 和全部 Vitest 测试通过，失败数为 0。

- [ ] **步骤 2：运行 Extension Host 测试**

当前 Codex 继承 VS Code Extension Host 的 `ELECTRON_RUN_AS_NODE=1`，必须只对测试子进程移除该环境变量：

```bash
env -u ELECTRON_RUN_AS_NODE npm run test:vscode
```

预期：VS Code 1.131.0 启动，3 条 Extension Host 验收通过。

- [ ] **步骤 3：重新打包 VSIX**

运行：`npm run package`

预期：生成 `/Users/xbyzzz/code_home/work_space/gitool/.worktrees/remote-settings/gitool-file-commit-0.2.0.vsix`，`vsce` 成功。

- [ ] **步骤 4：核验分支和产物**

运行：

```bash
git diff --check
git status --short
git log -8 --oneline
shasum -a 256 gitool-file-commit-0.2.0.vsix
```

预期：功能工作树干净；报告 VSIX SHA-256；不执行 `git push`，等待用户决定是否本地合并。
