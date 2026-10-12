import { describe, expect, it } from 'vitest';
import type { CommitGraphNode } from '../../src/domain/history-model.js';
import type { HistoryState } from '../../src/domain/view-model.js';
import {
  formatRelativeTime,
  graphMetrics,
  historyListMarkup,
  type RenderedHistoryFile,
} from '../../src/webview/history-renderer.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const NO_EXPANDED = new Set<string>();
const NO_DETAILS = new Map<string, readonly RenderedHistoryFile[]>();

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function commit(overrides: Partial<CommitGraphNode> = {}): CommitGraphNode {
  return {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaa',
    parents: [],
    author: '张三',
    authoredAt: minutesAgo(30),
    subject: '功能：测试提交',
    refs: [],
    lane: 0,
    color: 0,
    laneCount: 1,
    hasIncoming: false,
    parentLanes: [],
    parentEdges: [],
    passingEdges: [],
    ...overrides,
  };
}

describe('formatRelativeTime', () => {
  it.each([
    [minutesAgo(0), '刚刚'],
    [minutesAgo(5), '5 分钟前'],
    [new Date(NOW - 3 * 3_600_000).toISOString(), '3 小时前'],
    [new Date(NOW - 2 * 86_400_000).toISOString(), '2 天前'],
    [new Date(NOW - 90 * 86_400_000).toISOString(), '3 个月前'],
    [new Date(NOW - 800 * 86_400_000).toISOString(), '2 年前'],
    [new Date(NOW + 60_000).toISOString(), '刚刚'],
    ['无效时间', ''],
  ])('把 %s 格式化为 %s', (iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected);
  });
});

describe('graphMetrics', () => {
  it('单轨道时使用最小宽度', () => {
    expect(graphMetrics([commit()])).toEqual({ width: 16, pitch: 12 });
  });

  it('多轨道时按轨道数加宽并封顶', () => {
    expect(graphMetrics([commit({ laneCount: 3 })]).width).toBe(40);
    expect(graphMetrics([commit({ laneCount: 20 })]).width).toBe(92);
  });
});

describe('historyListMarkup', () => {
  it('渲染单行提交：提交线图、主题、引用徽章与元数据', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit({
        refs: [
          { name: 'main', kind: 'head' },
          { name: 'origin/main', kind: 'remote' },
        ],
      })],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.statusVisible).toBe(false);
    expect(view.markup).toContain('class="history-commit-row"');
    expect(view.markup).toContain('<svg class="commit-graph"');
    expect(view.markup).toContain('class="graph-node lane-color-0 current"');
    expect(view.markup).toContain('codicon-chevron-right');
    expect(view.markup).toContain('history-subject">功能：测试提交</span>');
    expect(view.markup).toContain('commit-ref head');
    expect(view.markup).toContain('commit-ref-label">main</span>');
    expect(view.markup).toContain('commit-ref remote');
    expect(view.markup).toContain('commit-ref-label">origin/main</span>');
    expect(view.markup).toContain('history-hash">aaaaaaa</span>');
    expect(view.markup).toContain('history-author">张三</span>');
    expect(view.markup).toContain('history-time">30 分钟前</span>');
    expect(view.markup).toContain('aria-expanded="false"');
  });

  it('head 提交的图节点渲染为实心当前点，合并提交渲染为大圆点', () => {
    const head = historyListMarkup(
      { kind: 'ready', commits: [commit({ refs: [{ name: 'main', kind: 'head' }] })] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );
    const merge = historyListMarkup(
      { kind: 'ready', commits: [commit({ parents: ['b'.repeat(40), 'c'.repeat(40)] })] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(head.markup).toContain('graph-node lane-color-0 current');
    expect(merge.markup).toContain('graph-node lane-color-0 merge');
    expect(merge.markup).toContain('r="4"');
  });

  it('有父边与经过边时渲染连线', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit({
        hasIncoming: true,
        parentEdges: [{ fromLane: 0, toLane: 0, color: 1 }],
        passingEdges: [{ fromLane: 1, toLane: 1, color: 2 }],
      })],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.markup.match(/class="graph-line/g)?.length).toBe(3);
    expect(view.markup).toContain('lane-color-1');
    expect(view.markup).toContain('lane-color-2');
  });

  it('无引用的提交不渲染引用容器', () => {
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).not.toContain('history-refs');
  });

  it('转义提交主题中的 HTML 特殊字符', () => {
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit({ subject: '<img src=x onerror=alert(1)>' })] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).not.toContain('<img');
    expect(view.markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('展开的提交渲染文件列表与向下箭头', () => {
    const hash = 'a'.repeat(40);
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      new Set([hash]),
      new Map([[hash, [
        { file: { status: 'modified', path: 'src/extension.ts' }, iconClass: null },
        { file: { status: 'added', path: 'docs/guide.md' } },
      ]]]),
      NOW,
    );

    expect(view.markup).toContain('history-entry expanded');
    expect(view.markup).toContain('aria-expanded="true"');
    expect(view.markup).toContain('codicon-chevron-down');
    expect(view.markup).toContain('class="history-files"');
    expect(view.markup).toContain('history-file-name">extension.ts</span>');
    expect(view.markup).toContain('history-file-directory">src</span>');
    expect(view.markup).toContain('history-status-m">modified</span>');
    expect(view.markup).toContain('data-path="docs/guide.md"');
  });

  it('展开但文件未加载时显示读取提示', () => {
    const hash = 'a'.repeat(40);
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      new Set([hash]),
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).toContain('history-files-status">正在读取提交文件…</p>');
  });

  it('未展开的提交不渲染文件列表', () => {
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).not.toContain('history-files');
  });

  it('空历史显示暂无提交记录', () => {
    const view = historyListMarkup(
      { kind: 'ready', commits: [] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.status).toBe('暂无提交记录');
    expect(view.statusVisible).toBe(true);
    expect(view.markup).toBe('');
  });

  it('读取中显示加载提示', () => {
    const view = historyListMarkup(
      { kind: 'loading', commits: [] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.status).toBe('正在读取提交历史…');
    expect(view.statusVisible).toBe(true);
  });

  it('失败且无历史时显示错误信息', () => {
    const view = historyListMarkup(
      { kind: 'failed', commits: [], message: '读取历史失败' },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.status).toBe('读取历史失败');
    expect(view.statusVisible).toBe(true);
  });

  it('失败但已有历史时保留列表并隐藏状态', () => {
    const view = historyListMarkup(
      { kind: 'failed', commits: [commit()], message: '读取历史失败' },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.statusVisible).toBe(false);
    expect(view.markup).toContain('history-commit-row');
  });

  it('加载中保留已有提交列表', () => {
    const history: HistoryState = { kind: 'loading', commits: [commit()] };
    const view = historyListMarkup(history, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.statusVisible).toBe(false);
    expect(view.markup).toContain('history-commit-row');
  });
});
