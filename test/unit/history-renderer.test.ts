import { describe, expect, it } from 'vitest';
import type { CommitGraphNode } from '../../src/domain/history-model.js';
import type { HistoryState } from '../../src/domain/view-model.js';
import {
  bindHistoryEntry,
  formatRelativeTime,
  historyGraphMarkup,
  historyListMarkup,
  laneXs,
  type HistoryRenderCallbacks,
  type RenderedHistoryFile,
} from '../../src/webview/history-renderer.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const NO_EXPANDED = new Set<string>();
const NO_DETAILS = new Map<string, readonly RenderedHistoryFile[]>();

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
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
    [minutesAgo(180), '3 小时前'],
    [daysAgo(1.2), '昨天'],
    [daysAgo(3), '3 天前'],
    [daysAgo(13), '2 周前'],
    [daysAgo(90), '13 周前'],
    [new Date(NOW + 60_000).toISOString(), '刚刚'],
    ['无效时间', ''],
  ])('把 %s 格式化为 %s', (iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected);
  });
});

describe('historyListMarkup', () => {
  it('渲染条目骨架：commit-entry 数据属性与 entry-head 双行结构', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit({ lane: 1 })],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.statusVisible).toBe(false);
    expect(view.markup).toContain('<section class="commit-entry"');
    expect(view.markup).toContain(`data-hash="${'a'.repeat(40)}"`);
    expect(view.markup).toContain('data-kind="normal"');
    expect(view.markup).toContain('data-lane="1"');
    expect(view.markup).toContain('data-search="功能：测试提交 张三 aaaaaaa"');
    expect(view.markup).toContain('class="entry-head" role="button" tabindex="0" aria-expanded="false" aria-label="展开提交 aaaaaaa"');
    expect(view.markup).toContain('<svg class="chevron"');
    expect(view.markup).toContain('class="subject">功能：测试提交</span>');
    expect(view.markup).toContain('class="badges"');
    expect(view.markup).toContain('class="row-meta"');
    expect(view.markup).toContain('meta-author">张三</span>');
    expect(view.markup).toContain('meta-time">30 分钟前</span>');
    expect(view.markup.match(/class="meta-sep"/g)?.length).toBe(2);
    expect(view.markup).toContain('<div class="files"></div>');
  });

  it('渲染哈希复制按钮：完整哈希在 data-hash，展示短哈希与复制图标', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit()],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.markup).toContain(`class="hash-btn" type="button" data-hash="${'a'.repeat(40)}" title="复制提交哈希"`);
    expect(view.markup).toContain('>aaaaaaa<svg class="copy-icon"');
  });

  it('按引用类型渲染徽章：HEAD 胶囊、本地分支、远程云图标', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit({
        refs: [
          { name: 'main', kind: 'head' },
          { name: 'feature/x', kind: 'local' },
          { name: 'origin/main', kind: 'remote' },
        ],
      })],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.markup).toContain('class="badge-head" title="HEAD · main">HEAD</span>');
    expect(view.markup).toContain('class="badge-branch" title="feature/x"');
    expect(view.markup).toContain('badge-branch" title="feature/x"><svg');
    expect(view.markup).toContain('class="badge-origin" title="origin/main"');
    expect(view.markup).toContain('class="origin-txt">origin/main</span>');
  });

  it('标记当前提交：is-current 类与 data-kind="current"', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit({ refs: [{ name: 'main', kind: 'head' }] })],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.markup).toContain('class="commit-entry is-current"');
    expect(view.markup).toContain('data-kind="current"');
  });

  it('多父提交渲染为 merge 类型', () => {
    const view = historyListMarkup({
      kind: 'ready',
      commits: [commit({ parents: ['b'.repeat(40), 'c'.repeat(40)] })],
    }, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.markup).toContain('data-kind="merge"');
    expect(view.markup).not.toContain('is-current');
  });

  it('展开的提交带 is-open 并渲染文件行', () => {
    const hash = 'a'.repeat(40);
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      new Set([hash]),
      new Map([[hash, [
        { file: { status: 'M', path: 'src/webview/render.ts' }, iconClass: null },
        { file: { status: 'A', path: 'package.json' }, iconClass: 'gitool-file-icon-3' },
        { file: { status: 'R100', path: 'docs/new.md', originalPath: 'docs/old.md' } },
      ]]]),
      NOW,
    );

    expect(view.markup).toContain('class="commit-entry is-open"');
    expect(view.markup).toContain('aria-expanded="true"');
    expect(view.markup).toContain('class="history-file" type="button" data-od-id="history-file" data-status="M" data-path="src/webview/render.ts"');
    expect(view.markup).toContain('class="status-block"');
    expect(view.markup).toContain('<svg class="file-icon"');
    expect(view.markup).toContain('class="file-icon gitool-file-icon-3"');
    expect(view.markup).toContain('class="file-name">render.ts</span>');
    expect(view.markup).toContain('class="file-dir">src/webview/</span>');
    expect(view.markup).toContain('class="file-dir"></span>');
    expect(view.markup).toContain('class="diff-link">打开 diff</span>');
    expect(view.markup).toContain('data-status="R"');
    expect(view.markup).toContain('title="docs/old.md → docs/new.md"');
  });

  it('展开但文件为空时渲染合并占位', () => {
    const hash = 'a'.repeat(40);
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      new Set([hash]),
      new Map([[hash, []]]),
      NOW,
    );

    expect(view.markup).toContain('<div class="files-empty">合并提交 · 无文件变更</div>');
  });

  it('展开但文件未加载时渲染读取提示', () => {
    const hash = 'a'.repeat(40);
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      new Set([hash]),
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).toContain('<div class="files-empty">正在读取提交文件…</div>');
  });

  it('未展开的提交不渲染文件内容', () => {
    const view = historyListMarkup(
      { kind: 'ready', commits: [commit()] },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).not.toContain('is-open');
    expect(view.markup).not.toContain('history-file');
    expect(view.markup).not.toContain('files-empty');
  });

  it('转义提交主题与作者中的 HTML 特殊字符', () => {
    const view = historyListMarkup(
      {
        kind: 'ready',
        commits: [commit({
          subject: '<img src=x onerror=alert(1)>',
          author: '<script>alert(1)</script>',
        })],
      },
      NO_EXPANDED,
      NO_DETAILS,
      NOW,
    );

    expect(view.markup).not.toContain('<img');
    expect(view.markup).not.toContain('<script>');
    expect(view.markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
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
    expect(view.markup).toContain('commit-entry');
  });

  it('加载中保留已有提交列表', () => {
    const history: HistoryState = { kind: 'loading', commits: [commit()] };
    const view = historyListMarkup(history, NO_EXPANDED, NO_DETAILS, NOW);

    expect(view.statusVisible).toBe(false);
    expect(view.markup).toContain('commit-entry');
  });
});

describe('laneXs', () => {
  it('单轨道固定在 0.33 倍宽度处', () => {
    expect(laneXs(1, 54)).toEqual([18]);
  });

  it('双轨道对齐原型的 0.33 / 0.78 比例', () => {
    expect(laneXs(2, 54)).toEqual([18, 42]);
    expect(laneXs(2, 46)).toEqual([15, 36]);
  });

  it('中间轨道线性插值，轨道数封顶为 6', () => {
    expect(laneXs(3, 100)).toEqual([33, 56, 78]);
    expect(laneXs(20, 54)).toHaveLength(6);
  });
});

describe('historyGraphMarkup', () => {
  it('无可见锚点时返回空字符串', () => {
    expect(historyGraphMarkup([], [commit()], 54, 100)).toBe('');
    expect(historyGraphMarkup([{ hash: '未知', y: 16 }], [commit()], 54, 100)).toBe('');
  });

  it('普通提交渲染为实心圆节点', () => {
    const svg = historyGraphMarkup(
      [{ hash: 'a'.repeat(40), y: 16 }],
      [commit()],
      54,
      100,
    );

    expect(svg).toContain('<svg id="graph-svg" viewBox="0 0 54 100" preserveAspectRatio="none" width="54" height="100"');
    expect(svg).toContain('<circle cx="18" cy="16" r="3.5" style="fill:var(--lane-1)"/>');
  });

  it('当前提交渲染发光双环加实心点', () => {
    const head = commit({ refs: [{ name: 'main', kind: 'head' }] });
    const svg = historyGraphMarkup([{ hash: head.hash, y: 16 }], [head], 54, 100);

    expect(svg).toContain('r="8.5" style="stroke:var(--accent)"');
    expect(svg).toContain('r="6" style="stroke:var(--accent)"');
    expect(svg).toContain('r="3.5" style="fill:var(--lane-1)"');
  });

  it('合并提交渲染空心双环', () => {
    const merge = commit({ parents: ['b'.repeat(40), 'c'.repeat(40)] });
    const svg = historyGraphMarkup([{ hash: merge.hash, y: 16 }], [merge], 54, 100);

    expect(svg).toContain('r="5" style="stroke:var(--lane-1);fill:var(--surface)"');
    expect(svg).toContain('r="2.6" style="stroke:var(--lane-1)"');
  });

  it('同轨道父子边渲染为直线', () => {
    const parent = commit({ hash: 'b'.repeat(40), shortHash: 'bbbbbbb' });
    const child = commit({
      parents: [parent.hash],
      parentEdges: [{ fromLane: 0, toLane: 0, color: 0 }],
    });
    const svg = historyGraphMarkup(
      [{ hash: child.hash, y: 16 }, { hash: parent.hash, y: 72 }],
      [child, parent],
      54,
      100,
    );

    expect(svg).toContain('<path d="M 18 16 L 18 72" style="stroke:var(--lane-1)" stroke-width="1.5" fill="none" opacity="0.55"/>');
    expect(svg).not.toContain('C ');
  });

  it('跨轨道边渲染为竖线加贝塞尔汇入', () => {
    const parent = commit({ hash: 'b'.repeat(40), shortHash: 'bbbbbbb', lane: 0, color: 0 });
    const child = commit({
      lane: 1,
      color: 1,
      parents: [parent.hash],
      parentEdges: [{ fromLane: 1, toLane: 0, color: 1 }],
    });
    const svg = historyGraphMarkup(
      [{ hash: child.hash, y: 16 }, { hash: parent.hash, y: 72 }],
      [child, parent],
      54,
      100,
    );

    expect(svg).toContain('<path d="M 42 16 L 42 44" style="stroke:var(--lane-2)"');
    expect(svg).toContain('<path d="M 42 44 C 42 72, 18 72, 18 72" style="stroke:var(--lane-2)"');
  });

  it('父提交不在可见锚点中时跳过该边', () => {
    const child = commit({
      parents: ['b'.repeat(40)],
      parentEdges: [{ fromLane: 0, toLane: 0, color: 0 }],
    });
    const svg = historyGraphMarkup(
      [{ hash: child.hash, y: 16 }],
      [child],
      54,
      100,
    );

    expect(svg).not.toContain('<path');
    expect(svg).toContain('<circle');
  });

  it('节点颜色按 commit.color 映射 lane 色板并循环', () => {
    const colored = commit({ color: 7 });
    const svg = historyGraphMarkup([{ hash: colored.hash, y: 16 }], [colored], 54, 100);

    expect(svg).toContain('var(--lane-2)');
  });
});

interface FakeEventInit {
  readonly target?: unknown;
  readonly key?: string;
  readonly preventDefault?: () => void;
  readonly stopPropagation?: () => void;
}

class FakeElement {
  readonly dataset: Record<string, string> = {};
  closestHit: FakeElement | null = null;
  private readonly attributes: Record<string, string> = {};
  private readonly listeners = new Map<string, EventListener[]>();
  private readonly selections = new Map<string, FakeElement[]>();

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  addEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string, init: FakeEventInit = {}): void {
    const event = {
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      ...init,
    };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as unknown as Event);
    }
  }

  closest(selector: string): FakeElement | null {
    return selector === '.hash-btn' ? this.closestHit : null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.selections.get(selector)?.[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.selections.get(selector) ?? [];
  }

  attach(selector: string, element: FakeElement): void {
    const list = this.selections.get(selector) ?? [];
    list.push(element);
    this.selections.set(selector, list);
  }
}

function fakeEntry(hash: string): {
  readonly entry: FakeElement;
  readonly head: FakeElement;
  readonly hashButton: FakeElement;
} {
  const entry = new FakeElement();
  const head = new FakeElement();
  const hashButton = new FakeElement();
  entry.dataset.hash = hash;
  hashButton.dataset.hash = hash;
  hashButton.closestHit = hashButton;
  head.setAttribute('aria-expanded', 'false');
  entry.attach('.entry-head', head);
  entry.attach('.hash-btn', hashButton);
  return { entry, head, hashButton };
}

function fakeCallbacks(): {
  readonly callbacks: HistoryRenderCallbacks;
  readonly calls: { readonly kind: string; readonly args: readonly unknown[] }[];
} {
  const calls: { kind: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    callbacks: {
      toggleCommit: (...args: unknown[]) => { calls.push({ kind: 'toggle', args }); },
      openCommitDiff: (...args: unknown[]) => { calls.push({ kind: 'diff', args }); },
      copyHash: (...args: unknown[]) => { calls.push({ kind: 'copy', args }); },
    },
  };
}

describe('bindHistoryEntry', () => {
  it('点击 entry-head 切换展开状态', () => {
    const { entry, head } = fakeEntry('a'.repeat(40));
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    head.dispatch('click', { target: head });

    expect(calls).toEqual([{ kind: 'toggle', args: ['a'.repeat(40), true] }]);
  });

  it('已展开的条目点击后回调收起', () => {
    const { entry, head } = fakeEntry('a'.repeat(40));
    head.setAttribute('aria-expanded', 'true');
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    head.dispatch('click', { target: head });

    expect(calls).toEqual([{ kind: 'toggle', args: ['a'.repeat(40), false] }]);
  });

  it('点击落在哈希按钮上时不触发切换', () => {
    const { entry, head, hashButton } = fakeEntry('a'.repeat(40));
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    head.dispatch('click', { target: hashButton });

    expect(calls).toEqual([]);
  });

  it('点击哈希按钮只复制哈希，不切换展开', () => {
    const { entry, hashButton } = fakeEntry('a'.repeat(40));
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    hashButton.dispatch('click', { target: hashButton });

    expect(calls).toEqual([{ kind: 'copy', args: ['a'.repeat(40)] }]);
  });

  it('Enter 与空格键在 entry-head 上触发切换', () => {
    const { entry, head } = fakeEntry('a'.repeat(40));
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    head.dispatch('keydown', { target: head, key: 'Enter' });
    head.dispatch('keydown', { target: head, key: ' ' });

    expect(calls.map((call) => call.kind)).toEqual(['toggle', 'toggle']);
  });

  it('按键事件来自子元素时不触发切换', () => {
    const { entry, head } = fakeEntry('a'.repeat(40));
    const child = new FakeElement();
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    head.dispatch('keydown', { target: child, key: 'Enter' });

    expect(calls).toEqual([]);
  });

  it('点击文件行打开对应 diff', () => {
    const { entry } = fakeEntry('a'.repeat(40));
    const file = new FakeElement();
    file.dataset.path = 'src/webview/render.ts';
    entry.attach('.history-file', file);
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    file.dispatch('click', { target: file });

    expect(calls).toEqual([{ kind: 'diff', args: ['a'.repeat(40), 'src/webview/render.ts'] }]);
  });

  it('缺少 data-hash 的条目不绑定任何回调', () => {
    const { entry, head, hashButton } = fakeEntry('a'.repeat(40));
    delete entry.dataset.hash;
    const { callbacks, calls } = fakeCallbacks();
    bindHistoryEntry(entry as unknown as HTMLElement, callbacks);

    head.dispatch('click', { target: head });
    hashButton.dispatch('click', { target: hashButton });

    expect(calls).toEqual([]);
  });
});
