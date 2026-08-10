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

  it('不再保留已迁移到原生 TreeView 的历史列表样式', () => {
    expect(stylesheet).not.toMatch(
      /\.(?:history-panel|commit-row|commit-files|commit-file)(?:\b|[-:])/u,
    );
  });

  it('AI 生成状态由按钮自身显示加载动画', () => {
    expect(stylesheet).toContain('.codicon-modifier-spin');
  });

  it('AI 星级图标使用固定画布并由密度控制星星数量', () => {
    const densityCanvas = readRule(
      '.ai-density-icon,\n.ai-density-option-icon',
    );
    expect(densityCanvas).toMatch(/width:\s*16px/u);
    expect(densityCanvas).toMatch(/height:\s*16px/u);
    expect(stylesheet).toContain(
      ':is(.ai-density-icon, .ai-density-option-icon)[data-density="compact"]',
    );
    expect(stylesheet).toContain(
      ':is(.ai-density-icon, .ai-density-option-icon)[data-density="standard"]',
    );
    expect(stylesheet).toContain(
      ':is(.ai-density-icon, .ai-density-option-icon)[data-density="detailed"]',
    );
    expect(stylesheet).toContain('.ai-density-icon.is-generating');
    expect(readRule(
      ':is(.ai-density-icon, .ai-density-option-icon)[data-density="standard"] .ai-density-star-primary',
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

  it('生成内容菜单为名称和说明预留稳定宽度', () => {
    expect(readRule('#ai-density-menu')).toMatch(/width:\s*232px/u);
    expect(readRule('#ai-density-menu')).toMatch(
      /max-width:\s*calc\(100vw - 18px\)/u,
    );
    expect(readRule('.ai-density-option-copy')).toMatch(/min-width:\s*0/u);
    expect(readRule('.ai-density-option-description')).toMatch(
      /color:\s*var\(--vscode-descriptionForeground\)/u,
    );
  });

  it('提交图标按钮使用固定尺寸且不改变左右分组', () => {
    expect(readRule('.commit-icon-button')).toMatch(/width:\s*28px/u);
    expect(readRule('.commit-icon-button')).toMatch(/min-width:\s*28px/u);
    expect(readRule('.commit-icon-button')).toMatch(/padding:\s*0/u);
    expect(readRule('.commit-actions')).toMatch(
      /justify-content:\s*space-between/u,
    );
  });

  it('提交内容在独立视图边界内滚动而不被下方视图裁切', () => {
    expect(readRule('.commit-layout .commit-panel')).toMatch(
      /height:\s*100%\s*!important/u,
    );
    expect(readRule('.commit-layout .commit-content')).toMatch(
      /height:\s*100%/u,
    );
    expect(readRule('.commit-layout .commit-content')).toMatch(
      /overflow-y:\s*auto/u,
    );
  });
});
