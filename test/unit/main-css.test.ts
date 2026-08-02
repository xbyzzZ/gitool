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
    expect(readRule('.ai-button.loading::before')).toMatch(
      /animation:\s*ai-button-spin/u,
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
