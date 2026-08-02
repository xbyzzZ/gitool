import type * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitGraphNode } from '../../src/domain/history-model.js';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinRepository } from '../../src/git/builtin-git-api.js';

const vscodeMocks = vi.hoisted(() => {
  class ThemeColor {
    constructor(readonly id: string) {}
  }

  class ThemeIcon {
    static readonly File = new ThemeIcon('file');

    constructor(
      readonly id: string,
      readonly color?: ThemeColor,
    ) {}
  }

  class TreeItem {
    description: string | boolean | undefined;
    tooltip: string | vscode.MarkdownString | undefined;
    iconPath: vscode.ThemeIcon | undefined;
    resourceUri: vscode.Uri | undefined;
    command: vscode.Command | undefined;
    contextValue: string | undefined;

    constructor(
      readonly label: string,
      readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {}
  }

  class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => unknown>();
    readonly event: vscode.Event<T> = (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };

    fire(value: T): void {
      for (const listener of this.listeners) {
        listener(value);
      }
    }

    dispose(): void {
      this.listeners.clear();
    }
  }

  return { EventEmitter, ThemeColor, ThemeIcon, TreeItem };
});

vi.mock('vscode', () => ({
  EventEmitter: vscodeMocks.EventEmitter,
  ThemeColor: vscodeMocks.ThemeColor,
  ThemeIcon: vscodeMocks.ThemeIcon,
  TreeItem: vscodeMocks.TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: {
    joinPath: (base: vscode.Uri, ...parts: readonly string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
  },
}));

import {
  HistoryTreeProvider,
  type HistoryTreeNode,
  type HistoryTreeService,
} from '../../src/views/history-tree-provider.js';

function commit(
  hash: string,
  refs: CommitGraphNode['refs'] = [],
): CommitGraphNode {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: [],
    author: '许博阳',
    authoredAt: '2026-08-02T07:55:00.000Z',
    subject: hash === 'newest' ? '修复：原生历史列表' : `提交 ${hash}`,
    refs,
    lane: 0,
    parentLanes: [],
  };
}

function model(
  commits: readonly CommitGraphNode[],
  overrides: Partial<RepositoryViewModel> = {},
): RepositoryViewModel {
  return {
    version: 7,
    trusted: true,
    currentRepositoryId: '/workspace/repo',
    repositories: [{
      id: '/workspace/repo',
      label: 'repo',
      rootPath: '/workspace/repo',
    }],
    branch: 'main',
    detached: false,
    changes: [],
    changeCount: 0,
    selectedIds: [],
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: {
      kind: 'ready',
      upstream: 'origin/main',
      ahead: 3,
      behind: 1,
    },
    history: { kind: 'ready', commits },
    ai: { kind: 'idle' },
    ...overrides,
  };
}

class ServiceHarness implements HistoryTreeService {
  private readonly changed = new vscodeMocks.EventEmitter<void>();
  private current: RepositoryViewModel;
  readonly onDidChange = this.changed.event;

  constructor(initial: RepositoryViewModel) {
    this.current = initial;
  }

  getViewModel(): RepositoryViewModel {
    return this.current;
  }

  getRepository(): BuiltinRepository | undefined {
    return undefined;
  }

  loadCommitDetails(): never {
    throw new Error('本测试不读取提交详情');
  }

  reportFailure(): boolean {
    return true;
  }

  replaceModel(next: RepositoryViewModel): void {
    this.current = next;
    this.changed.fire();
  }
}

function createTree(): vscode.TreeView<HistoryTreeNode> {
  return {
    description: '',
    message: '',
  } as unknown as vscode.TreeView<HistoryTreeNode>;
}

function iconId(provider: HistoryTreeProvider, node: HistoryTreeNode): string {
  return (provider.getTreeItem(node).iconPath as { readonly id: string }).id;
}

function firstNode(nodes: readonly HistoryTreeNode[]): HistoryTreeNode {
  const node = nodes[0];
  if (node === undefined) {
    throw new Error('测试提交节点不存在');
  }
  return node;
}

describe('原生提交历史树', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T08:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('按服务顺序生成单行提交节点并显示全部引用', () => {
    const service = new ServiceHarness(model([
      commit('newest', [
        { kind: 'head', name: 'main' },
        { kind: 'remote', name: 'origin/main' },
      ]),
      commit('merge'),
      commit('oldest'),
    ]));
    const provider = new HistoryTreeProvider(service);

    const nodes = provider.getChildren();

    expect(nodes.map((node) => node.commit.hash))
      .toEqual(['newest', 'merge', 'oldest']);
    const item = provider.getTreeItem(firstNode(nodes));
    expect(item.label).toBe('修复：原生历史列表');
    expect(item.description).toBe(
      '许博阳 · 5 分钟前 · newest · HEAD main · origin/main',
    );
    expect(item.collapsibleState).toBe(1);
  });

  it('用原生图标优先表达 HEAD 本地远程和普通提交', () => {
    const service = new ServiceHarness(model([
      commit('head', [{ kind: 'head', name: 'main' }]),
      commit('local', [{ kind: 'local', name: 'feature/native' }]),
      commit('remote', [{ kind: 'remote', name: 'origin/main' }]),
      commit('plain'),
    ]));
    const provider = new HistoryTreeProvider(service);
    const nodes = provider.getChildren();

    expect(nodes.map((node) => iconId(provider, node))).toEqual([
      'target',
      'git-branch',
      'cloud',
      'git-commit',
    ]);
  });

  it('把同步和历史状态写入原生 View 元数据', () => {
    const service = new ServiceHarness(model([commit('newest')], {
      history: { kind: 'loading', commits: [commit('newest')] },
    }));
    const provider = new HistoryTreeProvider(service);
    const tree = createTree();

    provider.bindView(tree);

    expect(tree.description).toBe('origin/main · ↑3 ↓1');
    expect(tree.message).toBe('正在读取提交历史…');

    service.replaceModel(model([]));
    expect(tree.message).toBe('暂无提交记录');
  });
});
