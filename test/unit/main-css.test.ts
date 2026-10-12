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

describe('工作台紧凑布局样式', () => {
  it('清除 Webview 默认内边距并避免功能区卡片式外框', () => {
    expect(readRule('body')).toMatch(/(?:^|;)\s*padding:\s*0\s*;/u);
    expect(readRule('.workbench-pane')).not.toMatch(/(?:^|;)\s*border\s*:/u);
  });

  it('变更列表独立滚动且文件图标保持紧凑', () => {
    expect(readRule('.changes-pane')).toMatch(/overflow:\s*hidden/u);
    expect(readRule('.changes-pane')).toMatch(/min-height:\s*48px/u);
    expect(readRule('.changes-list')).toMatch(/overflow:\s*auto/u);
    expect(readRule('.change-file-row')).toMatch(/height:\s*24px/u);
    expect(readRule('.change-file-icon')).toMatch(/width:\s*14px/u);
    expect(readRule('.change-file-icon')).toMatch(/height:\s*14px/u);
    expect(readRule('.change-file-directory')).toMatch(/text-overflow:\s*ellipsis/u);
  });

  it('AI 生成状态由按钮自身显示加载动画', () => {
    expect(stylesheet).toContain('.codicon-modifier-spin');
  });

  it('AI 生成与设置按钮使用与工具栏一致的图标按钮尺寸', () => {
    expect(readRule('.commit-footer .icon-button')).toMatch(/width:\s*28px/u);
    expect(readRule('.commit-footer .icon-button')).toMatch(/height:\s*28px/u);
    expect(readRule('.commit-footer .icon-button')).toMatch(/border-color:/u);
    expect(readRule('[hidden]')).toMatch(/display:\s*none\s*!important/u);
    expect(stylesheet).not.toContain('.ai-density-star');
  });

  it('AI 图标按钮在底部保持独立分组', () => {
    expect(readRule('.ai-actions')).toMatch(/gap:\s*6px/u);
    expect(readRule('.ai-density-loading')).toMatch(/font-size:\s*14px/u);
  });

  it('生成内容选择不再渲染受 Webview 高度限制的弹层', () => {
    expect(stylesheet).not.toContain('#ai-density-menu');
    expect(stylesheet).not.toContain('.ai-density-option-copy');
  });

  it('AI 按钮与提交按钮在底部分组排布', () => {
    expect(readRule('.commit-footer')).toMatch(
      /justify-content:\s*space-between/u,
    );
    expect(readRule('.commit-text-button')).toMatch(/border-radius:\s*4px/u);
    expect(readRule('.selection-summary')).toMatch(/flex:\s*1/u);
    expect(stylesheet).not.toContain('.ai-menu-button');
    expect(stylesheet).not.toContain('.ai-density-actions');
    expect(stylesheet).not.toContain('.commit-meta-row');
    expect(stylesheet).not.toContain('.ai-model-name');
  });

  it('统一工作台固定底部提交区且中间列表承担滚动', () => {
    expect(readRule('.layout')).toMatch(/height:\s*100vh/u);
    expect(readRule('body')).toMatch(/overflow:\s*hidden/u);
    expect(readRule('.commit-dock')).toMatch(/flex:\s*none/u);
    expect(readRule('.commit-dock')).toMatch(/min-height:\s*156px/u);
    expect(readRule('.commit-dock .feedback')).toMatch(/min-height:\s*0/u);
    expect(readRule('.commit-resizer')).toMatch(/cursor:\s*row-resize/u);
    expect(readRule('.commit-resizer')).toMatch(/touch-action:\s*none/u);
    expect(stylesheet).toMatch(
      /@media \(max-height: 360px\)[\s\S]*?\.changes-pane\s*\{[^}]*min-height:\s*24px/u,
    );
    expect(stylesheet).toMatch(
      /@media \(max-height: 360px\)[\s\S]*?\.commit-dock\s*\{[^}]*min-height:\s*112px/u,
    );
  });

  it('极窄侧栏隐藏统计但保留拉取和推送工具组', () => {
    const narrow = /@media \(max-width: 260px\)\s*\{([\s\S]*?)\n\}/u.exec(
      stylesheet,
    )?.[1] ?? '';
    expect(narrow).toContain('.selection-summary');
    expect(narrow).not.toContain('.toolbar-group-end');
  });
});
