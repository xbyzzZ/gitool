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
    expect(readRule('.changes-list')).toMatch(/overflow:\s*auto/u);
    expect(readRule('.change-file-row')).toMatch(/height:\s*24px/u);
    expect(readRule('.change-file-icon')).toMatch(/width:\s*14px/u);
    expect(readRule('.change-file-icon')).toMatch(/height:\s*14px/u);
    expect(readRule('.change-file-directory')).toMatch(/text-overflow:\s*ellipsis/u);
  });

  it('AI 生成状态由按钮自身显示加载动画', () => {
    expect(stylesheet).toContain('.codicon-modifier-spin');
  });

  it('AI 星级图标使用固定画布并由密度控制星星数量', () => {
    const densityCanvas = readRule('.ai-density-icon');
    expect(densityCanvas).toMatch(/width:\s*16px/u);
    expect(densityCanvas).toMatch(/height:\s*16px/u);
    expect(stylesheet).toContain(
      '.ai-density-icon[data-density="compact"]',
    );
    expect(stylesheet).toContain(
      '.ai-density-icon[data-density="standard"]',
    );
    expect(stylesheet).toContain(
      '.ai-density-icon[data-density="detailed"]',
    );
    expect(stylesheet).toContain('.ai-density-icon.is-generating');
    expect(readRule(
      '.ai-density-icon[data-density="standard"] .ai-density-star-primary',
    )).toMatch(
      /width:\s*11px/u,
    );
  });

  it('模型名称按钮在窄侧边栏弹性截断且保留独立分组', () => {
    expect(readRule('.ai-actions')).toMatch(/gap:\s*4px/u);
    expect(readRule('.ai-menu-button')).toMatch(
      /border-radius:\s*0 2px 2px 0/u,
    );
    expect(readRule('.ai-model-button')).toMatch(/min-width:\s*56px/u);
    expect(readRule('.ai-model-button')).toMatch(/max-width:\s*112px/u);
    expect(readRule('.ai-model-name')).toMatch(/text-overflow:\s*ellipsis/u);
    expect(readRule('.ai-model-name')).toMatch(/white-space:\s*nowrap/u);
  });

  it('生成内容选择不再渲染受 Webview 高度限制的弹层', () => {
    expect(stylesheet).not.toContain('#ai-density-menu');
    expect(stylesheet).not.toContain('.ai-density-option-copy');
  });

  it('提交图标按钮使用固定尺寸且不改变左右分组', () => {
    expect(readRule('.commit-icon-button')).toMatch(/width:\s*28px/u);
    expect(readRule('.commit-icon-button')).toMatch(/min-width:\s*28px/u);
    expect(readRule('.commit-icon-button')).toMatch(/padding:\s*0/u);
    expect(readRule('.commit-actions')).toMatch(
      /justify-content:\s*space-between/u,
    );
  });

  it('统一工作台固定底部提交区且中间列表承担滚动', () => {
    expect(readRule('.layout')).toMatch(/height:\s*100vh/u);
    expect(readRule('body')).toMatch(/overflow:\s*hidden/u);
    expect(readRule('.commit-dock')).toMatch(/flex:\s*none/u);
    expect(readRule('.commit-dock')).toMatch(/border-top:/u);
    expect(stylesheet).toMatch(
      /@media \(max-height: 360px\)[\s\S]*?\.changes-pane\s*\{[^}]*min-height:\s*0/u,
    );
    expect(stylesheet).toMatch(
      /@media \(max-height: 360px\)[\s\S]*?\.commit-dock\s*\{[^}]*min-height:\s*102px/u,
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
