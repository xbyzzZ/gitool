# Gitool AI 信息密度星级图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 生成按钮在固定尺寸内分别用 1、2、3 颗星表示精简、标准、详细密度，并在生成中显示原有加载动画。

**Architecture:** `aiControlPresentation` 输出当前密度与生成状态，作为唯一展示状态来源；Webview 固定渲染三颗 Codicon `sparkle` 和一个 `loading` 节点；客户端只更新容器状态，CSS 在固定 `16 × 16px` 画布内控制星星数量、位置和加载状态显隐。

**Tech Stack:** TypeScript、VS Code Webview、Codicon、CSS、Vitest、VS Code Extension Host

## Global Constraints

- AI 生成按钮必须保持 `28 × 28px`。
- 星级图标画布必须保持 `16 × 16px`。
- 精简、标准、详细分别显示 1、2、3 颗星。
- 星形必须复用扩展已打包的 VS Code Codicon `sparkle` 字形，不新增图片资源。
- 生成中只显示旋转加载图标，结束后恢复当前密度星级。
- 不调整密度菜单、提交按钮、提交信息输入区和三分区布局。
- 所有新增测试名称、代码注释、文档和 Git 提交信息使用简体中文。

---

### Task 1: 扩展 AI 按钮展示状态

**Files:**
- Modify: `src/webview/commit-view-state.ts:7-59`
- Test: `test/unit/commit-view-state.test.ts:42-59`

**Interfaces:**
- Consumes: `CommitMessageDensity = 'compact' | 'standard' | 'detailed'`
- Produces: `aiControlPresentation(density: CommitMessageDensity, generating: boolean): AiControlPresentation`
- Produces: `AiControlPresentation` 的 `density`、`generating`、`generateLabel`、`densityLabel` 字段

- [ ] **Step 1: 写入失败测试，覆盖三种密度和生成状态**

```ts
it.each([
  ['compact', '精简'],
  ['standard', '标准'],
  ['detailed', '详细'],
] as const)('输出 %s 密度的 AI 星级展示状态', (density, label) => {
  expect(aiControlPresentation(density, false)).toEqual({
    density,
    generating: false,
    generateLabel: `使用 AI 生成提交信息（${label}）`,
    densityLabel: `选择 AI 信息密度（${label}）`,
  });
});

it('AI 生成中保留密度并输出加载状态', () => {
  expect(aiControlPresentation('detailed', true)).toEqual({
    density: 'detailed',
    generating: true,
    generateLabel: '取消 AI 生成',
    densityLabel: '选择 AI 信息密度（详细）',
  });
});
```

- [ ] **Step 2: 运行定向测试并确认因旧的 `generateIcon` 合同失败**

Run: `npx vitest run test/unit/commit-view-state.test.ts --reporter=dot`

Expected: FAIL，实际结果仍包含 `generateIcon: 'sparkle' | 'loading'`，缺少 `density` 和 `generating`。

- [ ] **Step 3: 最小化修改展示状态合同**

```ts
export interface AiControlPresentation {
  readonly density: CommitMessageDensity;
  readonly generating: boolean;
  readonly generateLabel: string;
  readonly densityLabel: string;
}

export function aiControlPresentation(
  density: CommitMessageDensity,
  generating: boolean,
): AiControlPresentation {
  const label = densityLabel(density);
  return {
    density,
    generating,
    generateLabel: generating
      ? '取消 AI 生成'
      : `使用 AI 生成提交信息（${label}）`,
    densityLabel: `选择 AI 信息密度（${label}）`,
  };
}
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `npx vitest run test/unit/commit-view-state.test.ts --reporter=dot`

Expected: PASS。

- [ ] **Step 5: 提交展示状态变更**

```bash
git add src/webview/commit-view-state.ts test/unit/commit-view-state.test.ts
git commit -m "功能：扩展 AI 密度图标展示状态"
```

### Task 2: 渲染固定星群并接入密度切换

**Files:**
- Modify: `src/webview/render.ts:81-89`
- Modify: `src/webview/commit-client.ts:160-169`
- Modify: `media/main.css:168-210`
- Test: `test/unit/render.test.ts:61-78`
- Test: `test/unit/main-css.test.ts:31-46`

**Interfaces:**
- Consumes: Task 1 输出的 `AiControlPresentation.density` 和 `AiControlPresentation.generating`
- Produces: `#ai-generate-icon[data-density]` 固定星群容器
- Produces: `.ai-density-icon.is-generating` 加载状态

- [ ] **Step 1: 写入失败的 HTML 结构测试**

```ts
it('AI 按钮默认渲染标准密度的固定星群和加载节点', () => {
  const html = renderCommitWebviewHtml(
    createWebview(),
    createExtensionUri(),
    'nonce-123',
  );

  expect(html).toContain('id="ai-generate-icon"');
  expect(html).toContain('class="ai-density-icon"');
  expect(html).toContain('data-density="standard"');
  expect(html.match(/codicon-sparkle ai-density-star/g)).toHaveLength(3);
  expect(html).toContain('ai-density-loading');
});
```

- [ ] **Step 2: 写入失败的固定画布与状态显隐样式测试**

```ts
it('AI 星级图标使用固定画布并由密度控制星星数量', () => {
  expect(readRule('.ai-density-icon')).toMatch(/width:\s*16px/u);
  expect(readRule('.ai-density-icon')).toMatch(/height:\s*16px/u);
  expect(stylesheet).toContain('.ai-density-icon[data-density="compact"]');
  expect(stylesheet).toContain('.ai-density-icon[data-density="standard"]');
  expect(stylesheet).toContain('.ai-density-icon[data-density="detailed"]');
  expect(stylesheet).toContain('.ai-density-icon.is-generating');
});
```

- [ ] **Step 3: 运行渲染与样式测试并确认结构尚不存在**

Run: `npx vitest run test/unit/render.test.ts test/unit/main-css.test.ts --reporter=dot`

Expected: FAIL，旧页面只有单个 `codicon-sparkle`，且没有固定星群画布样式。

- [ ] **Step 4: 将 AI 图标改为固定星群结构**

```html
<span id="ai-generate-icon" class="ai-density-icon" data-density="standard" aria-hidden="true">
  <span class="ai-density-stars">
    <span class="codicon codicon-sparkle ai-density-star ai-density-star-primary"></span>
    <span class="codicon codicon-sparkle ai-density-star ai-density-star-secondary"></span>
    <span class="codicon codicon-sparkle ai-density-star ai-density-star-tertiary"></span>
  </span>
  <span class="codicon codicon-loading ai-density-loading"></span>
</span>
```

- [ ] **Step 5: 在固定 `16 × 16px` 画布中实现三种构图和加载显隐**

```css
.ai-density-icon {
  position: relative;
  display: block;
  width: 16px;
  height: 16px;
}

.ai-density-stars,
.ai-density-loading,
.ai-density-star {
  position: absolute;
}

.ai-density-stars,
.ai-density-loading {
  inset: 0;
}

.ai-density-loading {
  display: none;
  font-size: 16px;
}

.ai-density-icon.is-generating .ai-density-stars {
  display: none;
}

.ai-density-icon.is-generating .ai-density-loading {
  display: block;
}

.ai-density-star {
  line-height: 1;
}

.ai-density-icon[data-density="compact"] .ai-density-star-primary {
  top: 0;
  left: 0;
  font-size: 16px;
}

.ai-density-icon[data-density="compact"] .ai-density-star-secondary,
.ai-density-icon[data-density="compact"] .ai-density-star-tertiary {
  display: none;
}

.ai-density-icon[data-density="standard"] .ai-density-star-primary {
  top: 0;
  left: 0;
  font-size: 12px;
}

.ai-density-icon[data-density="standard"] .ai-density-star-secondary {
  top: 8px;
  left: 8px;
  font-size: 8px;
}

.ai-density-icon[data-density="standard"] .ai-density-star-tertiary {
  display: none;
}

.ai-density-icon[data-density="detailed"] .ai-density-star-primary {
  top: 3px;
  left: 0;
  font-size: 11px;
}

.ai-density-icon[data-density="detailed"] .ai-density-star-secondary {
  top: 0;
  left: 10px;
  font-size: 6px;
}

.ai-density-icon[data-density="detailed"] .ai-density-star-tertiary {
  top: 9px;
  left: 9px;
  font-size: 7px;
}
```

- [ ] **Step 6: 让客户端只更新密度和生成状态**

```ts
const aiPresentation = aiControlPresentation(density, aiGenerating);
controls.aiGenerateIcon.dataset.density = aiPresentation.density;
controls.aiGenerateIcon.classList.toggle(
  'is-generating',
  aiPresentation.generating,
);
controls.aiGenerateIcon.querySelector('.ai-density-loading')
  ?.classList.toggle('codicon-modifier-spin', aiPresentation.generating);
```

保留现有 `aria-label`、`title`、禁用逻辑和取消生成入口。

- [ ] **Step 7: 运行定向测试并确认通过**

Run: `npx vitest run test/unit/commit-view-state.test.ts test/unit/render.test.ts test/unit/main-css.test.ts --reporter=dot`

Expected: PASS。

- [ ] **Step 8: 提交星群渲染变更**

```bash
git add src/webview/render.ts src/webview/commit-client.ts media/main.css test/unit/render.test.ts test/unit/main-css.test.ts
git commit -m "功能：按 AI 信息密度显示星级图标"
```

### Task 3: 完整验证、打包与本地安装

**Files:**
- Verify: `gitool-file-commit-0.2.0.vsix`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的完整实现
- Produces: 可安装的 Gitool `0.2.0` VSIX

- [ ] **Step 1: 运行完整静态检查和单元测试**

Run: `npm run check`

Expected: 类型检查、ESLint 和全部 Vitest 测试通过。

- [ ] **Step 2: 运行 VS Code Extension Host 验收**

Run: `env -u ELECTRON_RUN_AS_NODE npm run test:vscode`

Expected: 扩展激活、双仓库选择、精确提交与推送流程全部通过。

- [ ] **Step 3: 重新打包 VSIX**

Run: `npm run package`

Expected: 生成 `gitool-file-commit-0.2.0.vsix`。

- [ ] **Step 4: 覆盖安装并核对注册版本**

```bash
/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code \
  --install-extension \
  /Users/xbyzzz/code_home/work_space/gitool/gitool-file-commit-0.2.0.vsix \
  --force
/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code \
  --list-extensions --show-versions
```

Expected: 安装成功，扩展列表包含 `gitool.gitool-file-commit@0.2.0`。

- [ ] **Step 5: 推送当前分支**

Run: `git push origin main`

Expected: 本地 `main` 推送到 `origin/main`，用户未跟踪的 `.serena/project.yml` 不进入任何提交。
