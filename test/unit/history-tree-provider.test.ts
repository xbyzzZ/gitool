import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitGraphNode } from '../../src/domain/history-model.js';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { RepositoryService } from '../../src/services/repository-service.js';

const vscodeMocks = vi.hoisted(() => {
  class ThemeIcon {
    static readonly File = new ThemeIcon('file');

    constructor(readonly id: string) {}
  }

  return {
    EventEmitter: class<T> {
      private readonly listeners = new Set<(value: T) => void>();

      readonly event: vscode.Event<T> = (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };

      fire(value: T): void {
        for (const listener of this.listeners) {
          listener(value);
        }
      }
    },
    ThemeIcon,
    TreeItem: class {
      resourceUri: vscode.Uri | undefined;
      iconPath: vscode.ThemeIcon | undefined;
      description: string | undefined;
      tooltip: string | undefined;
      command: vscode.Command | undefined;

      constructor(
        readonly label: string,
        readonly collapsibleState: vscode.TreeItemCollapsibleState,
      ) {}
    },
  };
});

vi.mock('vscode', () => ({
  EventEmitter: vscodeMocks.EventEmitter,
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
  type HistoryCommitNode,
} from '../../src/views/history-tree-provider.js';

const commit: CommitGraphNode = {
  hash: 'abc1234'.padEnd(40, '0'),
  shortHash: 'abc1234',
  parents: [],
  author: '许博阳',
  authoredAt: '2026-08-02T02:55:00.000Z',
  subject: '界面：迁移原生提交历史',
  refs: [{ name: 'main', kind: 'head' }],
  lane: 0,
  parentLanes: [],
};

function viewModel(options: {
  readonly repositoryId?: string;
  readonly version?: number;
} = {}): RepositoryViewModel {
  const repositoryId = options.repositoryId ?? '/workspace/repo';
  return {
    version: options.version ?? 7,
    trusted: true,
    currentRepositoryId: repositoryId,
    repositories: [{
      id: repositoryId,
      label: 'repo',
      rootPath: repositoryId,
    }],
    branch: 'main',
    detached: false,
    changes: [],
    changeCount: 0,
    selectedIds: [],
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: { kind: 'ready', upstream: 'origin/main', ahead: 2, behind: 1 },
    history: { kind: 'ready', commits: [commit] },
    ai: { kind: 'idle' },
  };
}

interface ServiceDouble {
  readonly service: RepositoryService;
  readonly loadCommitDetails: ReturnType<typeof vi.fn>;
  readonly setViewModel: (model: RepositoryViewModel) => void;
  readonly fireChange: () => void;
}

function createService(initialModel = viewModel()): ServiceDouble {
  let model = initialModel;
  const loadCommitDetails = vi.fn();
  const changeListeners = new Set<() => void>();
  const service = {
    onDidChange: (listener: () => void) => {
      changeListeners.add(listener);
      return { dispose: () => changeListeners.delete(listener) };
    },
    getViewModel: () => model,
    getRepository: (repositoryId: string) => {
      const repository = model.repositories.find((item) => item.id === repositoryId);
      return repository === undefined ? undefined : { rootUri: { fsPath: repository.rootPath } };
    },
    loadCommitDetails,
  } as unknown as RepositoryService;
  return {
    service,
    loadCommitDetails,
    setViewModel: (nextModel: RepositoryViewModel) => {
      model = nextModel;
    },
    fireChange: () => {
      for (const listener of changeListeners) {
        listener();
      }
    },
  };
}

function historyCommitNode(provider: HistoryTreeProvider): HistoryCommitNode {
  const node = provider.getChildren()[0];
  if (node?.kind !== 'commit') {
    throw new Error('提交节点不存在');
  }
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T03:00:00.000Z'));
});

describe('提交历史树', () => {
  it('提交节点在单行显示主题和元数据并使用提交图标', () => {
    const provider = new HistoryTreeProvider({ service: createService().service });
    const item = provider.getTreeItem(historyCommitNode(provider));

    expect(item.label).toBe('界面：迁移原生提交历史');
    expect(item.description).toBe('许博阳 · 5 分钟前 · abc1234 · HEAD main');
    expect(item.iconPath).toEqual(new vscode.ThemeIcon('git-commit'));
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
  });

  it('描述当前分支与上游同步状态', () => {
    const provider = new HistoryTreeProvider({ service: createService().service });

    expect(provider.getDescription()).toBe('origin/main · ↑2 ↓1');
  });

  it('展开提交时按需加载文件并使用当前文件图标主题', async () => {
    const created = createService();
    created.loadCommitDetails.mockResolvedValue({
      hash: commit.hash,
      files: [{ status: 'M', path: 'src/render.ts' }],
    });
    const provider = new HistoryTreeProvider({ service: created.service });
    const commitNode = historyCommitNode(provider);

    const children = await provider.getChildren(commitNode);
    const child = children[0];
    if (child === undefined) {
      throw new Error('提交文件节点不存在');
    }
    const item = provider.getTreeItem(child);

    expect(created.loadCommitDetails).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo', version: 7, hash: commit.hash,
    });
    expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/render.ts');
    expect(item.iconPath).toBe(vscode.ThemeIcon.File);
    expect(item.label).toBe('render.ts');
    expect(item.description).toBe('src · M');
    expect(item.command?.command).toBe('gitool.openHistoryDiff');
  });

  it('同一提交复用详情缓存并在版本变化后重新加载', async () => {
    const created = createService();
    created.loadCommitDetails.mockResolvedValue({ hash: commit.hash, files: [] });
    const provider = new HistoryTreeProvider({ service: created.service });
    const initialNode = historyCommitNode(provider);

    await provider.getChildren(initialNode);
    await provider.getChildren(initialNode);

    created.setViewModel({ ...viewModel(), version: 8 });
    created.fireChange();
    const updatedNode = historyCommitNode(provider);
    await provider.getChildren(updatedNode);

    created.setViewModel(viewModel());
    created.fireChange();
    const restoredNode = historyCommitNode(provider);
    await provider.getChildren(restoredNode);

    expect(created.loadCommitDetails).toHaveBeenCalledTimes(3);
    expect(created.loadCommitDetails).toHaveBeenNthCalledWith(1, {
      repositoryId: '/workspace/repo', version: 7, hash: commit.hash,
    });
    expect(created.loadCommitDetails).toHaveBeenNthCalledWith(2, {
      repositoryId: '/workspace/repo', version: 8, hash: commit.hash,
    });
    expect(created.loadCommitDetails).toHaveBeenNthCalledWith(3, {
      repositoryId: '/workspace/repo', version: 7, hash: commit.hash,
    });
  });

  it('仓库切换后清空旧仓库的提交详情缓存', async () => {
    const created = createService();
    created.loadCommitDetails.mockResolvedValue({ hash: commit.hash, files: [] });
    const provider = new HistoryTreeProvider({ service: created.service });
    const firstNode = historyCommitNode(provider);

    await provider.getChildren(firstNode);
    await provider.getChildren(firstNode);

    created.setViewModel(viewModel({ repositoryId: '/workspace/other' }));
    created.fireChange();
    await provider.getChildren(historyCommitNode(provider));

    created.setViewModel(viewModel());
    created.fireChange();
    await provider.getChildren(historyCommitNode(provider));

    expect(created.loadCommitDetails).toHaveBeenCalledTimes(3);
    expect(created.loadCommitDetails).toHaveBeenNthCalledWith(3, {
      repositoryId: '/workspace/repo', version: 7, hash: commit.hash,
    });
  });
});
