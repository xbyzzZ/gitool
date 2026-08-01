import { describe, expect, it } from 'vitest';
import type { CommitGraphNode } from '../../src/domain/history-model.js';
import { renderCommitRowMarkup } from '../../src/webview/history-renderer.js';

const commit: CommitGraphNode = {
  hash: 'd18e4b2'.padEnd(40, '0'),
  shortHash: 'd18e4b2',
  parents: [],
  author: '许博阳',
  authoredAt: '2026-08-01T10:00:00.000Z',
  subject: '功能：增加 AI 提交信息生成',
  refs: [
    { name: 'main', kind: 'head' },
    { name: 'origin/main', kind: 'remote' },
  ],
  lane: 0,
  parentLanes: [],
};

describe('renderCommitRowMarkup', () => {
  it('在同一提交行包含标题、作者、时间、短哈希和引用', () => {
    const html = renderCommitRowMarkup(commit, {
      now: new Date('2026-08-01T10:01:00.000Z'),
    });

    expect(html).toContain('class="commit-row"');
    expect(html).toContain('功能：增加 AI 提交信息生成');
    expect(html).toContain('许博阳 · 1 分钟前 · d18e4b2');
    expect(html).toContain('HEAD main');
    expect(html).toContain('origin/main');
    expect(html).not.toContain('class="commit-files"');
  });

  it('展开时把文件放入提交行下方且转义 Git 文本', () => {
    const html = renderCommitRowMarkup({
      ...commit,
      subject: '<script>危险</script>',
    }, {
      expanded: true,
      files: [{ status: 'M', path: 'src/<client>.ts' }],
      now: new Date('2026-08-01T10:01:00.000Z'),
    });

    expect(html).toContain('class="commit-files"');
    expect(html).toContain('src/&lt;client&gt;.ts');
    expect(html).not.toContain('<script>');
  });
});
