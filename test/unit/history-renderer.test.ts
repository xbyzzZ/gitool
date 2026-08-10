import { describe, expect, it } from 'vitest';
import type { CommitGraphNode } from '../../src/domain/history-model.js';
import {
  graphMetrics,
  renderCommitRowMarkup,
  renderGraphMarkup,
} from '../../src/webview/history-renderer.js';

function commit(overrides: Partial<CommitGraphNode> = {}): CommitGraphNode {
  return {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaa',
    parents: ['b'.repeat(40), 'c'.repeat(40)],
    author: '测试作者',
    authoredAt: '2026-08-10T08:00:00.000Z',
    subject: '合并功能分支',
    refs: [
      { name: 'main', kind: 'head' },
      { name: 'release', kind: 'local' },
      { name: 'origin/main', kind: 'remote' },
    ],
    lane: 1,
    color: 1,
    laneCount: 3,
    hasIncoming: true,
    parentLanes: [1, 2],
    parentEdges: [
      { fromLane: 1, toLane: 1, color: 1 },
      { fromLane: 1, toLane: 2, color: 2 },
    ],
    passingEdges: [{ fromLane: 0, toLane: 0, color: 0 }],
    ...overrides,
  };
}

describe('提交历史图渲染', () => {
  it('绘制经过线、入线、多个父提交连线和合并节点', () => {
    const html = renderGraphMarkup(commit(), 40, 12);
    expect(html.match(/class="graph-line/gu)).toHaveLength(4);
    expect(html).toContain('graph-node lane-color-1 current merge');
    expect(html).toContain('C 20');
  });

  it('按最大轨道数限制图区域宽度', () => {
    expect(graphMetrics([commit({ laneCount: 3 })])).toEqual({ width: 40, pitch: 12 });
    expect(graphMetrics([commit({ laneCount: 20 })]).width).toBe(92);
  });

  it('单行显示主题、紧凑引用、作者时间哈希，并转义动态内容', () => {
    const html = renderCommitRowMarkup(commit({ subject: '<修复>' }), {
      graphWidth: 40,
      lanePitch: 12,
      now: new Date('2026-08-10T09:00:00.000Z'),
    });
    expect(html).toContain('&lt;修复&gt;');
    expect(html).toContain('title="HEAD · main"');
    expect(html).toContain('commit-ref-label">main');
    expect(html).not.toContain('commit-ref-label">HEAD');
    expect(html).toContain('commit-ref local');
    expect(html).toContain('commit-ref remote');
    expect(html).toContain('history-author">测试作者');
    expect(html).toContain('history-time">1 小时前');
    expect(html).toContain('history-hash">aaaaaaa');
    expect(html).not.toContain('history-commit-primary');
    expect(html).not.toContain(' style=');
  });

  it('选中提交时显示选中状态且不再内联展开文件', () => {
    const html = renderCommitRowMarkup(commit(), {
      selected: true,
      graphWidth: 40,
      lanePitch: 12,
    });
    expect(html).toContain('history-entry selected');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('history-chevron');
    expect(html).not.toContain('history-files');
  });

  it('无引用提交不生成空标签容器占用主题空间', () => {
    const html = renderCommitRowMarkup(commit({ refs: [] }), {
      graphWidth: 40,
      lanePitch: 12,
    });
    expect(html).toContain('class="history-subject"');
    expect(html).not.toContain('class="history-refs"');
    expect(html).toContain('class="history-hash"');
  });
});
