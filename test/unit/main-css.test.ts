import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve('media/main.css'), 'utf8');

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [
    ...stylesheet.matchAll(
      new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, 'gu'),
    ),
  ];

  expect(matches, `未找到 ${selector} 样式规则`).not.toHaveLength(0);
  return matches.map((match) => match[1] ?? '').join('\n');
}

function readMediaBlock(query: string): string {
  const block = new RegExp(
    `@media \\(${query}\\)\\s*\\{([\\s\\S]*?)\\n\\}`,
    'u',
  ).exec(stylesheet)?.[1];
  expect(block, `未找到 @media (${query}) 媒体查询`).toBeDefined();
  return block ?? '';
}

describe('设计系统 token', () => {
  it('颜色跟随 VS Code 主题变量，原型十六进制值作为兜底', () => {
    const root = readRule(':root');
    expect(root).toContain('--bg: var(--vscode-sideBar-background, #000000)');
    expect(root).toContain('--surface: var(--vscode-editorWidget-background, #1d1d1f)');
    expect(root).toContain('--fg: var(--vscode-foreground, #f5f5f7)');
    expect(root).toContain('--fg-2: var(--vscode-foreground, #d2d2d7)');
    expect(root).toContain('--muted: var(--vscode-descriptionForeground, #86868b)');
    expect(root).toContain('--meta: var(--vscode-disabledForeground, #6e6e73)');
    expect(root).toContain('--border: var(--vscode-widget-border, #424245)');
    expect(root).toContain('--border-soft: var(--vscode-panel-border, #2a2a2c)');
    expect(root).toContain('--accent: var(--vscode-textLink-foreground, #2997ff)');
    expect(root).toContain('--accent-on: var(--vscode-button-foreground, #000000)');
    expect(root).toContain('--accent-active: var(--vscode-textLink-activeForeground, #0071e3)');
    expect(root).toContain('--success: #16a34a');
    expect(root).toContain('--warn: #eab308');
    expect(root).toContain('--danger: #dc2626');
    expect(root).toContain('--radius-sm: 8px');
    expect(root).toContain('--radius-pill: 980px');
    expect(root).toContain('--elev-raised: 0 12px 32px rgba(0, 0, 0, 0.5)');
    expect(root).toContain('--focus-ring: 0 0 0 3px color-mix(in oklab, var(--accent), transparent 60%)');
    expect(root).toContain('--motion-fast: 150ms');
    expect(root).toContain('--motion-base: 220ms');
    expect(root).toContain('--ease-standard: cubic-bezier(0.28, 0, 0.22, 1)');
    expect(root).toContain('--lane-1: #2997ff');
    expect(root).toContain('--lane-2: #16a34a');
    expect(root).toContain('--lane-3: #eab308');
    expect(root).toContain('--lane-4: #dc2626');
    expect(root).toContain('--lane-5: #86868b');
    expect(root).toContain('--lane-6: #d2d2d7');
  });

  it('graph 车道经 class 上色（CSP 禁止内联 style 属性）', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(readRule(`.graph-s${String(n)}`)).toContain(`stroke: var(--lane-${String(n)})`);
      expect(readRule(`.graph-f${String(n)}`)).toContain(`fill: var(--lane-${String(n)})`);
    }
    expect(readRule('.graph-surface')).toContain('fill: var(--surface)');
    expect(readRule('.graph-accent')).toContain('stroke: var(--accent)');
  });

  it('全局基础样式：深色背景、隐藏溢出、焦点环', () => {
    expect(readRule('body')).toMatch(/background:\s*var\(--bg\)/u);
    expect(readRule('body')).toMatch(/overflow:\s*hidden/u);
    expect(readRule('body')).toMatch(/padding:\s*0/u);
    expect(readRule(':focus-visible')).toContain('box-shadow: var(--focus-ring)');
    expect(readRule('[hidden]')).toMatch(/display:\s*none\s*!important/u);
  });
});

describe('布局与视图切换', () => {
  it('单一 webview 内两个视图纵向排布', () => {
    expect(readRule('.layout')).toMatch(/display:\s*flex/u);
    expect(readRule('.layout')).toMatch(/flex-direction:\s*column/u);
    expect(readRule('.layout')).toMatch(/height:\s*100vh/u);
    expect(readRule('.view')).toMatch(/flex:\s*1/u);
    expect(readRule('.view-history')).toContain('--graph-w: 54px');
  });
});

describe('统一按钮体系', () => {
  it('图标按钮 28px，含危险态与两步确认胶囊', () => {
    expect(readRule('.icon-btn')).toMatch(/width:\s*28px/u);
    expect(readRule('.icon-btn')).toMatch(/height:\s*28px/u);
    expect(readRule('.icon-btn.danger')).toContain('color: var(--danger)');
    expect(readRule('.icon-btn.confirming')).toContain('border-radius: var(--radius-pill)');
    expect(readRule('.icon-btn.confirming')).toContain('var(--danger)');
  });

  it('胶囊按钮具备 ghost/secondary/primary 三种变体', () => {
    expect(readRule('.btn')).toContain('border-radius: var(--radius-pill)');
    expect(readRule('.btn-ghost')).toContain('color: var(--fg-2)');
    expect(readRule('.btn-secondary')).toMatch(/border:\s*1px solid/u);
    expect(readRule('.btn-primary')).toContain('background: var(--accent)');
    expect(readRule('.btn-primary')).toContain('color: var(--accent-on)');
  });

  it('执行反馈统一为按钮加载态内嵌旋转圆环', () => {
    expect(readRule('.btn.is-loading, .icon-btn.is-loading')).toMatch(/opacity:\s*0\.85/u);
    expect(readRule('button.is-loading')).toMatch(/position:\s*relative/u);
    expect(readRule('button.is-loading > *')).toMatch(/visibility:\s*hidden/u);
    expect(readRule('button.is-loading::after')).toMatch(/border-radius:\s*50%/u);
    expect(readRule('button.is-loading::after')).toMatch(/animation:\s*rot/u);
    expect(stylesheet).toContain('@keyframes rot');
  });

  it('空信息提交校验失败使用抖动动画', () => {
    expect(readRule('.btn.shake')).toMatch(/animation:\s*shake/u);
    expect(stylesheet).toContain('@keyframes shake');
  });

  it('图标旋转反馈类可用', () => {
    expect(readRule('.spin')).toMatch(/animation:\s*rot 800ms linear infinite/u);
  });
});

describe('提交工作台', () => {
  it('工具栏 44px，仓库条 34px', () => {
    expect(readRule('.toolbar')).toMatch(/height:\s*44px/u);
    expect(readRule('.repo-bar')).toMatch(/height:\s*34px/u);
    expect(readRule('.repo-bar')).toMatch(/border-bottom:\s*1px solid var\(--border-soft\)/u);
  });

  it('多仓库下拉融入仓库条样式', () => {
    expect(readRule('.repo-bar select')).toContain('background: var(--surface)');
    expect(readRule('.repo-bar select')).toMatch(/border:\s*1px solid var\(--border-soft\)/u);
  });

  it('分组头、折叠动画与三态勾选框', () => {
    expect(readRule('.group-header')).toMatch(/height:\s*32px/u);
    expect(readRule('.group.collapsed .chevron')).toContain('transform: rotate(-90deg)');
    expect(readRule('.group-body')).toMatch(/grid-template-rows:\s*1fr/u);
    expect(readRule('.group.collapsed .group-body')).toMatch(/grid-template-rows:\s*0fr/u);
    expect(readRule('.cbx')).toMatch(/width:\s*14px/u);
    expect(readRule('.cbx[data-state="checked"], .cbx[data-state="mixed"]'))
      .toContain('background: var(--accent)');
    expect(readRule('.cbx[data-state="checked"] .tick, .cbx[data-state="mixed"] .dash'))
      .toMatch(/opacity:\s*1/u);
  });

  it('文件行选中态带左侧 accent 竖条与悬浮 diff 链接', () => {
    expect(readRule('.file-row')).toMatch(/height:\s*30px/u);
    expect(readRule('.file-row.selected')).toContain('var(--accent)');
    expect(readRule('.file-row.selected::before')).toContain('background: var(--accent)');
    expect(readRule('.file-row:hover .diff-link, .file-row:focus-within .diff-link'))
      .toMatch(/opacity:\s*1/u);
  });

  it('状态字母徽章按原型配色', () => {
    expect(readRule('.st[data-s="M"]')).toContain('color: var(--warn)');
    expect(readRule('.st[data-s="A"]')).toContain('color: var(--success)');
    expect(readRule('.st[data-s="D"]')).toContain('color: var(--danger)');
    expect(readRule('.st[data-s="R"]')).toContain('color: var(--accent)');
    expect(readRule('.st[data-s="T"], .st[data-s="?"]')).toContain('color: var(--muted)');
    expect(readRule('.st[data-s="!"]')).toContain('color: var(--danger)');
  });

  it('空态通过 .changes.is-empty 切换', () => {
    expect(readRule('.empty')).toMatch(/display:\s*none/u);
    expect(readRule('.changes.is-empty .empty')).toMatch(/display:\s*flex/u);
    expect(readRule('.changes.is-empty .group')).toMatch(/display:\s*none/u);
  });

  it('5px 分隔拖条带拖动高亮', () => {
    expect(readRule('.splitter')).toMatch(/height:\s*5px/u);
    expect(readRule('.splitter')).toMatch(/cursor:\s*row-resize/u);
    expect(readRule('.splitter')).toMatch(/touch-action:\s*none/u);
    expect(readRule('.splitter:hover, .splitter.dragging')).toContain('var(--accent)');
  });

  it('提交坞默认 240px、最小 150px，含消息输入与字符计数', () => {
    expect(readRule('.dock')).toMatch(/height:\s*240px/u);
    expect(readRule('.dock')).toMatch(/min-height:\s*150px/u);
    expect(readRule('.dock')).toContain('background: var(--surface)');
    expect(readRule('.message-wrap')).toMatch(/position:\s*relative/u);
    expect(readRule('.message-wrap textarea')).toMatch(/resize:\s*none/u);
    expect(readRule('.message-wrap textarea.invalid')).toContain('var(--danger)');
  });

  it('操作反馈区保留在提交坞内并使用新 token', () => {
    expect(readRule('.dock-feedback')).toMatch(/flex:\s*none/u);
    expect(readRule('#operation-status')).toContain('color: var(--muted)');
    expect(readRule('#operation-status:empty')).toMatch(/display:\s*none/u);
    expect(readRule('#error-status')).toContain('color: var(--danger)');
    expect(readRule('.link-btn')).toContain('color: var(--accent)');
  });

  it('AI 控件组与统计样式', () => {
    expect(readRule('.ai-group')).toMatch(/gap:\s*6px/u);
    expect(readRule('.stats')).toContain('font-family: var(--font-mono)');
    expect(readRule('.stats .total')).toContain('color: var(--meta)');
  });

  it('AI 设置弹层样式完整', () => {
    expect(readRule('.popover')).toMatch(/position:\s*fixed/u);
    expect(readRule('.popover')).toContain('box-shadow: var(--elev-raised)');
    expect(stylesheet).toContain('@keyframes pop-in');
    expect(readRule('.popover-label')).toContain('color: var(--meta)');
    expect(readRule('.popover-item')).toMatch(/width:\s*100%/u);
    expect(readRule('.popover-item .pi-check')).toMatch(/opacity:\s*0/u);
    expect(readRule('.popover-item[aria-checked="true"] .pi-check')).toMatch(/opacity:\s*1/u);
    expect(readRule('.popover-item .pi-body')).toMatch(/flex:\s*1/u);
    expect(readRule('.popover-item .pi-title')).toMatch(/font-weight:\s*600/u);
    expect(readRule('.popover-item .pi-desc')).toContain('color: var(--muted)');
  });
});

describe('提交历史', () => {
  it('历史工具栏包含返回链接、标题、搜索框与分支徽章', () => {
    expect(readRule('.view-history .toolbar')).toMatch(/border-bottom:\s*1px solid var\(--border-soft\)/u);
    expect(readRule('.back-link')).toContain('color: var(--fg-2)');
    expect(readRule('.back-link:hover')).toContain('color: var(--accent)');
    expect(readRule('.toolbar-title')).toContain('font-family: var(--font-display)');
    expect(readRule('.toolbar-spacer')).toMatch(/flex:\s*1/u);
    expect(readRule('.search input')).toContain('background: var(--surface)');
    expect(readRule('.search input:focus')).toContain('border-color: var(--accent)');
    expect(readRule('.search-icon')).toMatch(/position:\s*absolute/u);
    expect(readRule('.branch-chip')).toContain('border-radius: var(--radius-pill)');
  });

  it('提交列表带绝对定位图覆盖层', () => {
    expect(readRule('.commit-list')).toMatch(/position:\s*relative/u);
    expect(readRule('.commit-list')).toMatch(/overflow-y:\s*auto/u);
    expect(readRule('#graph-host')).toMatch(/position:\s*absolute/u);
    expect(readRule('#graph-host')).toContain('width: var(--graph-w)');
    expect(readRule('#graph-host')).toMatch(/pointer-events:\s*none/u);
  });

  it('提交条目当前态与展开态', () => {
    expect(readRule('.commit-entry')).toMatch(/border-bottom:\s*1px solid var\(--border-soft\)/u);
    expect(readRule('.commit-entry.is-current')).toContain('var(--accent)');
    expect(readRule('.commit-entry.is-current::before')).toContain('background: var(--accent)');
    expect(readRule('.entry-head[aria-expanded="true"] .chevron')).toContain('transform: rotate(90deg)');
    expect(readRule('.files')).toMatch(/display:\s*none/u);
    expect(readRule('.commit-entry.is-open .files')).toMatch(/display:\s*block/u);
  });

  it('引用徽章三种形态', () => {
    expect(readRule('.badge-head')).toContain('background: var(--accent)');
    expect(readRule('.badge-head')).toContain('color: var(--accent-on)');
    expect(readRule('.badge-branch')).toContain('color: var(--success)');
    expect(readRule('.badge-origin')).toContain('color: var(--remote)');
    expect(readRule('.badge-origin')).toContain('color-mix(in oklab, var(--remote) 60%, transparent)');
  });

  it('哈希复制按钮悬浮显示复制图标', () => {
    expect(readRule('.hash-btn')).toContain('font-family: var(--font-mono)');
    expect(readRule('.hash-btn .copy-icon')).toMatch(/opacity:\s*0/u);
    expect(readRule('.hash-btn:hover .copy-icon, .hash-btn:focus-visible .copy-icon'))
      .toMatch(/opacity:\s*1/u);
  });

  it('历史文件行与状态色块', () => {
    expect(readRule('.history-file')).toMatch(/height:\s*26px/u);
    expect(readRule('.status-block')).toContain('background: color-mix(in oklab, var(--status) 18%, transparent)');
    expect(readRule('[data-status="M"]')).toContain('--status: var(--warn)');
    expect(readRule('[data-status="A"]')).toContain('--status: var(--success)');
    expect(readRule('[data-status="D"]')).toContain('--status: var(--danger)');
    expect(readRule('[data-status="R"]')).toContain('--status: var(--accent)');
    expect(readRule('[data-status="T"]')).toContain('--status: var(--muted)');
    expect(readRule('.history-file:hover .diff-link, .history-file:focus-visible .diff-link'))
      .toMatch(/opacity:\s*1/u);
    expect(readRule('.files-empty')).toContain('color: var(--meta)');
  });

  it('历史空态通过 .commit-list.is-empty 切换', () => {
    expect(readRule('.empty-state')).toMatch(/display:\s*none/u);
    expect(readRule('.commit-list.is-empty .empty-state')).toMatch(/display:\s*block/u);
    expect(readRule('.commit-list.is-empty .commit-entry, .commit-list.is-empty #graph-host'))
      .toMatch(/display:\s*none/u);
  });

  it('Toast 胶囊底部居中并通过 .show 显示', () => {
    expect(readRule('.toast')).toMatch(/position:\s*fixed/u);
    expect(readRule('.toast')).toContain('border-radius: var(--radius-pill)');
    expect(readRule('.toast')).toMatch(/opacity:\s*0/u);
    expect(readRule('.toast.show')).toMatch(/opacity:\s*1/u);
  });
});

describe('窄屏降级与动效偏好', () => {
  it('520px 断点合并工作台与历史的降级规则', () => {
    const narrow = readMediaBlock('max-width: 520px');
    expect(narrow).toContain('.fdir');
    expect(narrow).not.toContain('.pull-btn');
    expect(narrow).toContain('.stats .total');
    expect(narrow).toContain('.upstream');
    expect(narrow).toContain('--graph-w: 46px');
    expect(narrow).toContain('.meta-author');
    expect(narrow).toContain('.origin-txt');
    expect(narrow).toContain('.file-dir');
    expect(narrow).toContain('.back-link .back-txt');
  });

  it('380px 断点收紧工具栏与按钮', () => {
    const narrow = readMediaBlock('max-width: 380px');
    expect(narrow).toContain('.toolbar');
    expect(narrow).toContain('.btn');
    expect(narrow).toContain('.repo-bar');
  });

  it('尊重减少动效偏好', () => {
    const reduced = readMediaBlock('prefers-reduced-motion: reduce');
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms\s*!important/u);
    expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/u);
    expect(reduced).toMatch(/animation-iteration-count:\s*1\s*!important/u);
  });
});
