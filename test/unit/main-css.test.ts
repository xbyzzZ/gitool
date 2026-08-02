import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve('media/main.css'), 'utf8');

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [...stylesheet.matchAll(
    new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, 'gu'),
  )];
  expect(matches, `未找到 ${selector} 样式规则`).not.toHaveLength(0);
  return matches.map((match) => match[1] ?? '').join('\n');
}

describe('提交信息 Webview 样式', () => {
  it('使用 VS Code 基线字号且不固定按钮高度', () => {
    expect(readRule('body')).toMatch(/(?:^|;)\s*padding:\s*0\s*;/u);
    expect(readRule(':root')).toMatch(
      /font-size:\s*var\(--vscode-font-size\)/u,
    );
    expect(readRule('button')).not.toMatch(/(?:min-)?height\s*:/u);
  });

  it('删除已迁移变更树、历史树和手绘分隔轨道规则', () => {
    for (const selector of [
      '.change-group', '.file-row', '.history-list', '.commit-row',
      '.pane-resizer',
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      expect(stylesheet).not.toMatch(new RegExp(`(?:^|\\n)${escaped}\\s*\\{`, 'u'));
    }
  });
});
