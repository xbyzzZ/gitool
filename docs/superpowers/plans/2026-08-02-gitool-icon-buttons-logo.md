# Gitool 提交按钮图标化与 Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变提交区布局和业务行为的前提下，将四个提交操作改为固定尺寸 Codicon，并交付 Marketplace 使用的 Gitool PNG Logo。

**Architecture:** 保留现有 Webview DOM 分组和 Flex 布局，只把按钮可见文本替换为 Codicon，并通过纯函数计算 AI 按钮在空闲、生成和不同密度下的图标与无障碍提示。Logo 作为独立 PNG 资产写入 `media/`，由 `package.json.icon` 纳入 VSIX；活动栏继续使用单色 `media/icon.svg`。

**Tech Stack:** TypeScript 6、VS Code Webview、VS Code Codicon、Vitest 4、内置图像生成工具、PNG、esbuild、vsce。

## Global Constraints

- 默认使用简体中文；代码保持英文。
- 不改变 `commit-actions`、`ai-actions`、`primary-actions` 的结构、左右分组、顺序和业务事件。
- 不改变无远程、无选中文件、冲突、未信任工作区和操作中状态下的禁用规则。
- AI 生成中仍在原按钮点击取消，只把按钮内容切换为旋转加载图标。
- Logo 使用“白色文件与蓝色勾选 + 绿色向上箭头 + 蓝青圆角方形背景”，不含文字、水印和复杂装饰。
- 活动栏继续使用 `media/icon.svg`；Marketplace 使用 128×128 PNG。
- 不提交 `.serena/project.yml` 或 `.superpowers/`。

---

### Task 1: 将提交操作改为固定尺寸 Codicon

**Files:**
- Modify: `src/webview/commit-view-state.ts`
- Modify: `src/webview/commit-client.ts`
- Modify: `src/webview/render.ts`
- Modify: `media/main.css`
- Test: `test/unit/commit-view-state.test.ts`
- Test: `test/unit/render.test.ts`
- Test: `test/unit/main-css.test.ts`

**Interfaces:**
- Consumes: `CommitMessageDensity` 的 `compact | standard | detailed` 值和现有 `aiGenerating` 布尔状态。
- Produces: `aiControlPresentation(density: CommitMessageDensity, generating: boolean): AiControlPresentation`，其中结果包含 `generateIcon`、`generateLabel` 和 `densityLabel`。

- [ ] **Step 1: 写 AI 展示状态失败测试**

在 `test/unit/commit-view-state.test.ts` 增加：

```ts
expect(aiControlPresentation('compact', false)).toEqual({
  generateIcon: 'sparkle',
  generateLabel: '使用 AI 生成提交信息（精简）',
  densityLabel: '选择 AI 信息密度（精简）',
});
expect(aiControlPresentation('detailed', true)).toEqual({
  generateIcon: 'loading',
  generateLabel: '取消 AI 生成',
  densityLabel: '选择 AI 信息密度（详细）',
});
```

- [ ] **Step 2: 写 HTML 与 CSS 失败测试**

在 `test/unit/render.test.ts` 断言：

```ts
expect(html).toContain('id="ai-generate-icon"');
expect(html).toContain('codicon-sparkle');
expect(html).toContain('codicon-chevron-down');
expect(html).toContain('codicon-check');
expect(html).toContain('codicon-arrow-up');
expect(html).not.toContain('>仅提交</button>');
expect(html).not.toContain('>提交并推送</button>');
```

在 `test/unit/main-css.test.ts` 断言 `.commit-icon-button` 具有固定 `width: 28px`、`min-width: 28px`、`padding: 0`，并确认 `.commit-actions` 仍为左右分组布局，不增加媒体查询或换行规则。

- [ ] **Step 3: 运行定向测试确认失败**

Run:

```bash
npx vitest run test/unit/commit-view-state.test.ts test/unit/render.test.ts test/unit/main-css.test.ts --reporter=dot
```

Expected: `aiControlPresentation` 尚不存在，HTML 中仍是文字按钮，CSS 中没有 `.commit-icon-button`。

- [ ] **Step 4: 实现纯展示状态**

在 `src/webview/commit-view-state.ts` 增加：

```ts
export interface AiControlPresentation {
  readonly generateIcon: 'sparkle' | 'loading';
  readonly generateLabel: string;
  readonly densityLabel: string;
}

export function aiControlPresentation(
  density: CommitMessageDensity,
  generating: boolean,
): AiControlPresentation {
  const label = densityLabel(density);
  return {
    generateIcon: generating ? 'loading' : 'sparkle',
    generateLabel: generating
      ? '取消 AI 生成'
      : `使用 AI 生成提交信息（${label}）`,
    densityLabel: `选择 AI 信息密度（${label}）`,
  };
}
```

把现有密度中文映射移到该模块并导出，避免客户端维护第二份文案。

- [ ] **Step 5: 只替换按钮内容，不修改布局结构**

在 `src/webview/render.ts` 保留 `commit-actions`、`ai-actions` 和 `primary-actions`，将按钮内容替换为：

```html
<button id="ai-generate-button" class="ai-button commit-icon-button" type="button" aria-label="使用 AI 生成提交信息（标准）" title="使用 AI 生成提交信息（标准）">
  <span id="ai-generate-icon" class="codicon codicon-sparkle" aria-hidden="true"></span>
</button>
<button id="ai-density-button" class="ai-menu-button" type="button" aria-label="选择 AI 信息密度（标准）" title="选择 AI 信息密度（标准）" aria-haspopup="menu">
  <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
</button>
```

右侧按钮分别使用 `codicon-check` 和 `codicon-arrow-up`，保留现有 ID、`secondary`/`primary` 类与中文 `aria-label`、`title`。

- [ ] **Step 6: 接入 AI 图标与提示更新**

在 `src/webview/commit-client.ts` 获取 `ai-generate-icon`，用 `aiControlPresentation` 更新：

```ts
const aiPresentation = aiControlPresentation(density, aiGenerating);
controls.aiGenerateIcon.className = `codicon codicon-${aiPresentation.generateIcon}`;
controls.aiGenerateIcon.classList.toggle('codicon-modifier-spin', aiGenerating);
controls.aiGenerateButton.ariaLabel = aiPresentation.generateLabel;
controls.aiGenerateButton.title = aiPresentation.generateLabel;
controls.aiDensityButton.ariaLabel = aiPresentation.densityLabel;
controls.aiDensityButton.title = aiPresentation.densityLabel;
```

删除给 `aiGenerateButton.textContent` 赋值和旧 `.loading::before` 伪元素动画，保留取消生成的事件分支。

- [ ] **Step 7: 实现固定按钮样式**

在 `media/main.css` 增加 `.commit-icon-button` 固定 28×28、`padding: 0`、居中图标；保持 `.commit-actions { justify-content: space-between; }` 和既有 `gap`。AI 与密度按钮继续使用相邻圆角，主按钮继续使用 VS Code 主色。

- [ ] **Step 8: 运行定向测试与静态检查**

Run:

```bash
npx vitest run test/unit/commit-view-state.test.ts test/unit/render.test.ts test/unit/main-css.test.ts --reporter=dot
npm run typecheck
npm run lint
```

Expected: 定向测试、类型检查和 ESLint 全部通过。

- [ ] **Step 9: 提交按钮改动**

```bash
git add src/webview/commit-view-state.ts src/webview/commit-client.ts src/webview/render.ts media/main.css test/unit/commit-view-state.test.ts test/unit/render.test.ts test/unit/main-css.test.ts
git commit -m "界面：将提交操作改为紧凑图标按钮"
```

### Task 2: 生成并接入 Marketplace Logo

**Files:**
- Create: `media/logo-512.png`
- Create: `media/logo.png`
- Create: `test/unit/logo-assets.test.ts`
- Modify: `package.json`
- Modify: `test/unit/package-contributions.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 已确认的 Logo C 方向和内置图像生成工具输出。
- Produces: `media/logo-512.png` 展示资产、`media/logo.png` 128×128 Marketplace 资产，以及 `package.json.icon = "media/logo.png"`。

- [ ] **Step 1: 写 Logo 资产与清单失败测试**

新建 `test/unit/logo-assets.test.ts`，读取 PNG 头部的 IHDR 宽高并断言：

```ts
expect(readPngSize('media/logo-512.png')).toEqual({ width: 512, height: 512 });
expect(readPngSize('media/logo.png')).toEqual({ width: 128, height: 128 });
```

在 `test/unit/package-contributions.test.ts` 的 `Manifest` 增加 `readonly icon?: string`，并断言：

```ts
expect(manifest.icon).toBe('media/logo.png');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run test/unit/logo-assets.test.ts test/unit/package-contributions.test.ts --reporter=dot
```

Expected: 两个 PNG 文件不存在，清单没有 `icon`。

- [ ] **Step 3: 使用内置图像生成工具生成 Logo 源图**

使用 `image_gen` 的内置模式，提示词固定为：

```text
Use case: logo-brand
Asset type: VS Code Marketplace extension logo
Primary request: Create a clean square app icon for Gitool, showing a selected file and an upward push action.
Subject: A white document on the left with one clear blue checkmark, and one bold green upward arrow on the right.
Style/medium: flat vector-like geometric logo, crisp edges, minimal shapes, professional developer-tool branding.
Composition/framing: centered inside a blue-to-teal rounded square, balanced spacing, generous padding, readable at 16px and 128px.
Constraints: no text, no letters, no GitHub logo, no watermark, no shadow, no extra objects, no fine detail. Keep the document and arrow visually separate.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background outside the rounded square; no gradient, texture, reflection, or shadow in the chroma-key area. Do not use #ff00ff in the logo.
```

查看生成结果，确认文件、勾选、箭头方向和小尺寸轮廓满足规格。图像生成流程在此步骤实际生效，并将选中结果复制到工作区，不能只保留在默认生成目录。

- [ ] **Step 4: 去除色键并生成两个 PNG 尺寸**

使用 imagegen skill 提供的 `remove_chroma_key.py` 对源图去除 `#ff00ff` 外围背景，开启 `--soft-matte` 和 `--despill`。将结果等比裁切为正方形后输出 `media/logo-512.png`，再用 macOS `sips -z 128 128 media/logo-512.png --out media/logo.png` 生成 Marketplace 图标。

用本地图像查看工具检查透明四角、轮廓、颜色和 128×128 缩放结果；如果出现色边，只允许按 imagegen skill 重试一次 `--edge-contract 1`，不得用模糊或硬裁切掩盖问题。

- [ ] **Step 5: 接入清单并更新变更日志**

在 `package.json` 顶层加入：

```json
"icon": "media/logo.png"
```

在 `CHANGELOG.md` 的 `0.2.0` 增加一条：

```markdown
- 将提交区操作改为紧凑的 VS Code 原生图标，并新增 Gitool Marketplace Logo。
```

- [ ] **Step 6: 运行 Logo 与清单测试**

Run:

```bash
npx vitest run test/unit/logo-assets.test.ts test/unit/package-contributions.test.ts --reporter=dot
```

Expected: PNG 尺寸和 `package.json.icon` 断言全部通过。

- [ ] **Step 7: 提交 Logo 资产**

```bash
git add media/logo-512.png media/logo.png package.json CHANGELOG.md test/unit/logo-assets.test.ts test/unit/package-contributions.test.ts
git commit -m "品牌：新增 Gitool Marketplace Logo"
```

### Task 3: 发布前完整验收与重新打包

**Files:**
- Verify: `gitool-file-commit-0.2.0.vsix`

**Interfaces:**
- Consumes: Task 1 的图标按钮与 Task 2 的 Logo 资产。
- Produces: Publisher 为 `gitool`、版本为 `0.2.0`、包含 `media/logo.png` 的最终 VSIX。

- [ ] **Step 1: 运行完整静态与单元检查**

Run:

```bash
npm run check
```

Expected: TypeScript、ESLint 和全部 Vitest 测试通过，无失败项。

- [ ] **Step 2: 运行 Extension Host 验收**

Run:

```bash
env -u ELECTRON_RUN_AS_NODE npm run test:vscode
```

Expected: 3 项 Extension Host 验收通过，扩展 `gitool.gitool-file-commit` 正常激活。

- [ ] **Step 3: 检查 VSIX 文件清单**

Run:

```bash
npx vsce ls --no-dependencies
```

Expected: 包含 `media/logo.png`、`media/logo-512.png`、`media/commit.js`、`media/main.css` 和 `dist/extension.js`，不包含 `.serena/`、`.superpowers/`、源码、测试或工作树。

- [ ] **Step 4: 生成最终 VSIX**

Run:

```bash
npm run package
```

Expected: 生成 `/Users/xbyzzz/code_home/work_space/gitool/gitool-file-commit-0.2.0.vsix`，无缺少仓库或图标警告。

- [ ] **Step 5: 核对包内身份与哈希**

Run:

```bash
unzip -p gitool-file-commit-0.2.0.vsix extension/package.json | rg '"name"|"version"|"publisher"|"icon"'
shasum -a 256 gitool-file-commit-0.2.0.vsix
git status --short --branch
```

Expected: `publisher` 为 `gitool`，版本为 `0.2.0`，图标为 `media/logo.png`；只保留用户的 `.serena/project.yml` 未跟踪。

- [ ] **Step 6: 推送本地提交**

在用户已授权当前交付推送的前提下执行：

```bash
git push
```

Expected: `main` 与 `origin/main` 指向相同最新提交。
