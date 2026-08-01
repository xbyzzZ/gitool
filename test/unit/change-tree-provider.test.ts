import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileChange } from '../../src/domain/change-model.js';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { RepositoryService } from '../../src/services/repository-service.js';

const vscodeMocks = vi.hoisted(() => ({
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
  checkboxListeners: new Set<(event: {
    readonly items: readonly [ChangeTreeNode, vscode.TreeItemCheckboxState][];
  }) => void>(),
  createTreeView: vi.fn(() => ({
    onDidChangeCheckboxState: (listener: (event: {
      readonly items: readonly [ChangeTreeNode, vscode.TreeItemCheckboxState][];
    }) => void) => {
      vscodeMocks.checkboxListeners.add(listener);
      return { dispose: () => vscodeMocks.checkboxListeners.delete(listener) };
    },
    dispose: vi.fn(),
  })),
  TreeItem: class {
    resourceUri: vscode.Uri | undefined;
    iconPath: vscode.ThemeIcon | undefined;
    description: string | undefined;
    checkboxState: vscode.TreeItemCheckboxState | undefined;
    contextValue: string | undefined;
    command: vscode.Command | undefined;

    constructor(
      readonly label: string,
      readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {}
  },
}));

vi.mock('vscode', () => ({
  EventEmitter: vscodeMocks.EventEmitter,
  ThemeIcon: { File: { id: 'file' } },
  TreeItem: vscodeMocks.TreeItem,
  TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: {
    joinPath: (base: vscode.Uri, ...parts: readonly string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
  },
  window: {
    createTreeView: vscodeMocks.createTreeView,
  },
}));

import {
  ChangeTreeProvider,
  createChangeTreeView,
  type ChangeTreeNode,
} from '../../src/views/change-tree-provider.js';

function change(path: string): FileChange {
  return {
    id: path,
    path,
    kind: 'modified',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    commitPaths: [path],
  };
}

function viewModel(): RepositoryViewModel {
  return {
    version: 1,
    trusted: true,
    currentRepositoryId: 'repo',
    repositories: [{ id: 'repo', label: 'repo', rootPath: '/workspace/repo' }],
    branch: 'main',
    detached: false,
    changes: [change('src/webview/render.ts')],
    changeCount: 1,
    selectedIds: ['src/webview/render.ts'],
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
  };
}

interface ServiceDouble {
  readonly service: RepositoryService;
  readonly setFileSelected: ReturnType<typeof vi.fn>;
  readonly setGroup: ReturnType<typeof vi.fn>;
  readonly fireChange: () => void;
}

function createService(): ServiceDouble {
  const setFileSelected = vi.fn();
  const setGroup = vi.fn();
  const changeListeners = new Set<() => void>();
  const service = {
    onDidChange: (listener: () => void) => {
      changeListeners.add(listener);
      return { dispose: () => changeListeners.delete(listener) };
    },
    getViewModel: () => viewModel(),
    getRepository: () => ({
      rootUri: { fsPath: '/workspace/repo' } as vscode.Uri,
    }),
    setFileSelected,
    setGroup,
  } as unknown as RepositoryService;
  return {
    service,
    setFileSelected,
    setGroup,
    fireChange: () => {
      for (const listener of changeListeners) {
        listener();
      }
    },
  };
}

function fileNode(path: string): ChangeTreeNode {
  return {
    kind: 'file',
    repositoryId: 'repo',
    change: change(path),
  };
}

function createdTreeProvider(): ChangeTreeProvider {
  const calls = vscodeMocks.createTreeView.mock.calls as unknown as readonly [
    string,
    { readonly treeDataProvider: ChangeTreeProvider },
  ][];
  const options = calls.at(-1)?.[1] as {
    readonly treeDataProvider: ChangeTreeProvider;
  } | undefined;
  if (options === undefined) {
    throw new Error('尚未创建当前变更树');
  }
  return options.treeDataProvider;
}

function currentFileNode(provider: ChangeTreeProvider): ChangeTreeNode {
  const section = provider.getChildren()[0];
  if (section?.kind !== 'section') {
    throw new Error('待提交分区不存在');
  }
  const directory = provider.getChildren(section)[0];
  if (directory?.kind !== 'directory') {
    throw new Error('待提交目录不存在');
  }
  const file = provider.getChildren(directory)[0];
  if (file?.kind !== 'file') {
    throw new Error('待提交文件不存在');
  }
  return file;
}

beforeEach(() => {
  vscodeMocks.checkboxListeners.clear();
  vi.clearAllMocks();
});

describe('当前变更树', () => {
  it('仓库状态变化时刷新树节点', () => {
    const created = createService();
    const provider = new ChangeTreeProvider({ service: created.service });
    const refresh = vi.fn();
    provider.onDidChangeTreeData(refresh);

    created.fireChange();

    expect(refresh).toHaveBeenCalledWith(undefined);
  });

  it('文件节点使用当前文件图标主题并在同一行显示目录和状态', () => {
    const provider = new ChangeTreeProvider({ service: createService().service });
    const item = provider.getTreeItem(fileNode('src/webview/render.ts'));

    expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/webview/render.ts');
    expect(item.iconPath).toBe(vscode.ThemeIcon.File);
    expect(item.label).toBe('render.ts');
    expect(item.description).toBe('src/webview · M');
    expect(item.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
  });

  it('把文件复选框变化写回当前仓库选择状态', () => {
    const created = createService();
    createChangeTreeView({ service: created.service });
    const node = currentFileNode(createdTreeProvider());

    expect(vscodeMocks.createTreeView).toHaveBeenCalledWith(
      'gitool.changesView',
      expect.objectContaining({ manageCheckboxStateManually: true }),
    );

    vscodeMocks.checkboxListeners.forEach((listener) => {
      listener({
        items: [[node, vscode.TreeItemCheckboxState.Unchecked]],
      });
    });

    expect(created.setFileSelected).toHaveBeenCalledWith(
      'src/webview/render.ts',
      false,
    );
  });

  it('分区复选框变化写回当前仓库分区选择状态', () => {
    const created = createService();
    createChangeTreeView({ service: created.service });
    const section = createdTreeProvider().getChildren()[0];
    expect(section).toEqual({ kind: 'section', section: 'tracked' });
    if (section === undefined) {
      throw new Error('待提交分区不存在');
    }

    vscodeMocks.checkboxListeners.forEach((listener) => {
      listener({
        items: [[section, vscode.TreeItemCheckboxState.Unchecked]],
      });
    });

    expect(created.setGroup).toHaveBeenCalledWith('tracked', false);
  });

  it('冲突文件不提供复选框', () => {
    const provider = new ChangeTreeProvider({ service: createService().service });
    const conflictedNode: ChangeTreeNode = {
      kind: 'file',
      repositoryId: 'repo',
      change: {
        ...change('conflict.ts'),
        kind: 'conflicted',
        conflicted: true,
      },
    };

    expect(provider.getTreeItem(conflictedNode).checkboxState).toBeUndefined();
  });

  it('忽略不属于当前树的复选框节点', () => {
    const created = createService();
    createChangeTreeView({ service: created.service });

    vscodeMocks.checkboxListeners.forEach((listener) => {
      listener({
        items: [[fileNode('outside.ts'), vscode.TreeItemCheckboxState.Unchecked]],
      });
    });

    expect(created.setFileSelected).not.toHaveBeenCalled();
  });
});
