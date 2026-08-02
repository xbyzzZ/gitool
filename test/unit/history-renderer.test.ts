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

  it('展开时把文件名、目录、图标和状态放入连续文件行', () => {
    const html = renderCommitRowMarkup({
      ...commit,
      subject: '<script>危险</script>',
    }, {
      expanded: true,
      files: [
        { status: 'M', path: 'src/webview/render.ts' },
        { status: 'A', path: '.gitignore' },
      ],
      now: new Date('2026-08-01T10:01:00.000Z'),
    });

    expect(html).toContain('class="commit-files"');
    expect(html.match(/class="commit-file-graph"/gu)).toHaveLength(2);
    expect(html).toContain(
      'class="commit-file-icon file-icon codicon codicon-file-code blue"',
    );
    expect(html).toContain('class="commit-file-name">render.ts</span>');
    expect(html).toContain(
      'class="commit-file-directory">src/webview</span>',
    );
    expect(html).toContain(
      'class="commit-file-icon file-icon codicon codicon-git-commit yellow"',
    );
    expect(html).toContain('class="commit-file-name">.gitignore</span>');
    expect(html).not.toContain('class="commit-file-directory"></span>');
    expect(html).toContain('data-path="src/webview/render.ts"');
    expect(html).toContain('class="commit-file-status">M</span>');
    expect(html).not.toContain('<script>');
  });
});
