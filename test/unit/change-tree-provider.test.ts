import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileChange } from '../../src/domain/change-model.js';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinRepository } from '../../src/git/builtin-git-api.js';

const vscodeMocks = vi.hoisted(() => {
  class ThemeIcon {
    static readonly File = new ThemeIcon('file');

    constructor(readonly id: string) {}
  }

  class TreeItem {
    resourceUri: vscode.Uri | undefined;
    iconPath: vscode.ThemeIcon | undefined;
    description: string | boolean | undefined;
    tooltip: string | vscode.MarkdownString | undefined;
    checkboxState: vscode.TreeItemCheckboxState | undefined;
    contextValue: string | undefined;
    command: vscode.Command | undefined;

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

  return { ThemeIcon, TreeItem, EventEmitter };
});

vi.mock('vscode', () => ({
  EventEmitter: vscodeMocks.EventEmitter,
  ThemeIcon: vscodeMocks.ThemeIcon,
  TreeItem: vscodeMocks.TreeItem,
  TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Uri: {
    joinPath: (base: vscode.Uri, ...parts: readonly string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
  },
}));

import {
  ChangeTreeProvider,
  type ChangeTreeNode,
  type ChangeTreeService,
} from '../../src/views/change-tree-provider.js';

function change(
  path: string,
  options: Partial<Pick<FileChange, 'untracked' | 'conflicted' | 'staged'>> = {},
): FileChange {
  const untracked = options.untracked === true;
  const conflicted = options.conflicted === true;
  return {
    id: path,
    path,
    kind: conflicted ? 'conflicted' : untracked ? 'untracked' : 'modified',
    staged: options.staged === true,
    unstaged: !untracked,
    untracked,
    conflicted,
    commitPaths: [path],
  };
}

function model(changes: readonly FileChange[]): RepositoryViewModel {
  return {
    version: 3,
    trusted: true,
    currentRepositoryId: '/workspace/repo',
    repositories: [{
      id: '/workspace/repo',
      label: 'repo',
      rootPath: '/workspace/repo',
    }],
    branch: 'main',
    detached: false,
    changes,
    changeCount: changes.length,
    selectedIds: changes.filter((item) => !item.untracked).map((item) => item.id),
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
  };
}

class ServiceHarness implements ChangeTreeService {
  private readonly changed = new vscodeMocks.EventEmitter<void>();
  private current: RepositoryViewModel;
  readonly onDidChange = this.changed.event;

  constructor(changes: readonly FileChange[]) {
    this.current = model(changes);
  }

  getViewModel(): RepositoryViewModel {
    return this.current;
  }

  getRepository(id: string): BuiltinRepository | undefined {
    if (id !== this.current.currentRepositoryId) {
      return undefined;
    }
    return {
      rootUri: { fsPath: id } as vscode.Uri,
    } as BuiltinRepository;
  }

  setFileSelected(fileId: string, selected: boolean): RepositoryViewModel {
    const ids = new Set(this.current.selectedIds);
    if (selected) {
      ids.add(fileId);
    } else {
      ids.delete(fileId);
    }
    this.current = { ...this.current, selectedIds: [...ids] };
    this.changed.fire();
    return this.current;
  }

  setGroup(
    group: 'tracked' | 'untracked',
    selected: boolean,
  ): RepositoryViewModel {
    const ids = new Set(this.current.selectedIds);
    for (const item of this.current.changes) {
      if (item.conflicted || item.untracked !== (group === 'untracked')) {
        continue;
      }
      if (selected) {
        ids.add(item.id);
      } else {
        ids.delete(item.id);
      }
    }
    this.current = { ...this.current, selectedIds: [...ids] };
    this.changed.fire();
    return this.current;
  }
}

interface TreeHarness {
  readonly tree: vscode.TreeView<ChangeTreeNode>;
  readonly fireCheckboxes: (
    items: readonly [ChangeTreeNode, vscode.TreeItemCheckboxState][],
  ) => void;
}

function createTreeHarness(): TreeHarness {
  let listener: ((event: vscode.TreeCheckboxChangeEvent<ChangeTreeNode>) => unknown)
    | undefined;
  const tree = {
    description: undefined,
    onDidChangeCheckboxState: (
      next: (event: vscode.TreeCheckboxChangeEvent<ChangeTreeNode>) => unknown,
    ) => {
      listener = next;
      return { dispose: () => { listener = undefined; } };
    },
  } as unknown as vscode.TreeView<ChangeTreeNode>;
  return {
    tree,
    fireCheckboxes: (items) => listener?.({ items }),
  };
}

function findNode(
  nodes: readonly ChangeTreeNode[],
  predicate: (node: ChangeTreeNode) => boolean,
): ChangeTreeNode {
  const result = nodes.find(predicate);
  if (result === undefined) {
    throw new Error('测试节点不存在');
  }
  return result;
}

describe('当前变更原生文件树', () => {
  let changes: readonly FileChange[];
  let service: ServiceHarness;
  let provider: ChangeTreeProvider;

  beforeEach(() => {
    changes = [
      change('src/job.py'),
      change('notebooks/report.ipynb', { untracked: true }),
    ];
    service = new ServiceHarness(changes);
    provider = new ChangeTreeProvider(service);
  });

  it('不返回没有文件的分组', () => {
    const trackedOnly = new ChangeTreeProvider(new ServiceHarness([
      change('src/job.py'),
    ]));

    expect(trackedOnly.getChildren().map((node) => (
      node.kind === 'section' ? node.section : node.kind
    ))).toEqual(['tracked']);
  });

  it('Python 文件节点使用当前 VS Code 文件图标主题', () => {
    const tracked = findNode(
      provider.getChildren(),
      (node) => node.kind === 'section' && node.section === 'tracked',
    );
    const directory = provider.getChildren(tracked)[0];
    if (directory === undefined) {
      throw new Error('缺少目录节点');
    }
    const file = provider.getChildren(directory)[0];
    if (file === undefined) {
      throw new Error('缺少文件节点');
    }

    const item = provider.getTreeItem(file);

    expect(item.resourceUri?.fsPath).toBe('/workspace/repo/src/job.py');
    expect(item.iconPath).toBe(vscodeMocks.ThemeIcon.File);
    expect(item.label).toBe('job.py');
    expect(item.description).toContain('src');
  });

  it('文件复选框变化写回选择状态', () => {
    const tracked = findNode(
      provider.getChildren(),
      (node) => node.kind === 'section' && node.section === 'tracked',
    );
    const directory = provider.getChildren(tracked)[0];
    const file = directory === undefined
      ? undefined
      : provider.getChildren(directory)[0];
    if (file === undefined) {
      throw new Error('缺少文件节点');
    }
    const harness = createTreeHarness();
    provider.bindCheckboxes(harness.tree);

    harness.fireCheckboxes([[file, 0]]);

    expect(service.getViewModel().selectedIds).not.toContain('src/job.py');
  });

  it('未跟踪分组复选框变化写回整组状态', () => {
    const untracked = findNode(
      provider.getChildren(),
      (node) => node.kind === 'section' && node.section === 'untracked',
    );
    const harness = createTreeHarness();
    provider.bindCheckboxes(harness.tree);

    harness.fireCheckboxes([[untracked, 1]]);

    expect(service.getViewModel().selectedIds).toContain(
      'notebooks/report.ipynb',
    );
  });
});
