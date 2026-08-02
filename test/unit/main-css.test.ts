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

  it('历史展开使用连续轨道且文件区不形成独立卡片', () => {
    expect(readRule('.commit-row')).toMatch(/min-height:\s*32px/u);
    expect(stylesheet).not.toMatch(
      /\.commit-files\s*\{[^}]*(?:margin-left|border-left|background)/su,
    );
    expect(readRule('.commit-file')).toMatch(/min-height:\s*28px/u);
    expect(readRule('.commit-file')).toMatch(
      /grid-template-columns:\s*28px 19px minmax\(60px, auto\) minmax\(0, 1fr\) 18px/u,
    );
    expect(readRule('.commit-file-graph::before')).toMatch(/width:\s*2px/u);
    expect(readRule('.commit-file-directory')).toMatch(/min-width:\s*0/u);
    expect(readRule('.commit-file-directory')).toMatch(/overflow:\s*hidden/u);
    expect(readRule('.commit-file-directory')).toMatch(
      /text-overflow:\s*ellipsis/u,
    );
    expect(readRule('.commit-file-status')).toMatch(/width:\s*18px/u);
    expect(readRule('.commit-file-status')).toMatch(/grid-column:\s*5/u);
  });

  it('历史区不额外吞掉布局状态之外的剩余高度', () => {
    expect(readRule('.history-panel')).toMatch(/min-height:\s*66px/u);
    expect(readRule('.history-panel')).toMatch(/flex:\s*none/u);
  });
});
