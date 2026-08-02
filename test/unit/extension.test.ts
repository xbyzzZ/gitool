import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BuiltinChange,
  BuiltinGitApi,
  BuiltinHead,
  BuiltinRepository,
} from '../../src/git/builtin-git-api.js';

interface RegistrationState {
  readonly activeCommands: Map<string, vscode.Disposable>;
  readonly activeViews: Map<string, vscode.Disposable>;
  readonly activeContentProviders: Map<string, vscode.Disposable>;
  readonly commandDisposals: string[];
  readonly viewDisposals: string[];
  readonly registeredWebviews: {
    readonly id: string;
    readonly provider: vscode.WebviewViewProvider;
  }[];
  readonly createdTrees: {
    readonly id: string;
    readonly options: vscode.TreeViewOptions<unknown>;
    readonly tree: vscode.TreeView<unknown>;
    readonly checkboxListeners: Set<(
      event: vscode.TreeCheckboxChangeEvent<unknown>,
    ) => unknown>;
  }[];
  readonly gitOpenListeners: Set<(value: unknown) => unknown>;
  readonly gitCloseListeners: Set<(value: unknown) => unknown>;
  commandRegistrationError: {
    readonly id: string;
    readonly error: Error;
  } | undefined;
  trustRegistrationError: Error | undefined;
  gitExtension: vscode.Extension<unknown> | undefined;
}

const mocks = vi.hoisted(() => {
  const state: RegistrationState = {
    activeCommands: new Map(),
    activeViews: new Map(),
    activeContentProviders: new Map(),
    commandDisposals: [],
    viewDisposals: [],
    registeredWebviews: [],
    createdTrees: [],
    gitOpenListeners: new Set(),
    gitCloseListeners: new Set(),
    commandRegistrationError: undefined,
    trustRegistrationError: undefined,
    gitExtension: undefined,
  };

  const register = (
    active: Map<string, vscode.Disposable>,
    disposed: string[],
    id: string,
  ): vscode.Disposable => {
    if (active.has(id)) {
      throw new Error(`重复注册：${id}`);
    }
    const disposable: vscode.Disposable = {
      dispose(): void {
        if (active.delete(id)) {
          disposed.push(id);
        }
      },
    };
    active.set(id, disposable);
    return disposable;
  };

  return {
    state,
    EventEmitter: class<T> {
      private readonly listeners = new Set<(value: T) => unknown>();

      readonly event: vscode.Event<T> = (listener) => {
        this.listeners.add(listener);
        return {
          dispose: () => {
            this.listeners.delete(listener);
          },
        };
      };

      fire(value: T): void {
        for (const listener of this.listeners) {
          listener(value);
        }
      }

      dispose(): void {
        this.listeners.clear();
      }
    },
    getExtension: vi.fn(() => state.gitExtension),
    registerCommand: vi.fn((id: string) => {
      if (state.commandRegistrationError?.id === id) {
        const { error } = state.commandRegistrationError;
        state.commandRegistrationError = undefined;
        throw error;
      }
      return register(state.activeCommands, state.commandDisposals, id);
    }),
    registerWebviewViewProvider: vi.fn((
      id: string,
      provider: vscode.WebviewViewProvider,
    ) => {
      state.registeredWebviews.push({ id, provider });
      return register(state.activeViews, state.viewDisposals, id);
    }),
    registerTextDocumentContentProvider: vi.fn((id: string) =>
      register(state.activeContentProviders, [], id)),
    createTreeView: vi.fn((
      id: string,
      options: vscode.TreeViewOptions<unknown>,
    ) => {
      const registration = register(
        state.activeViews,
        state.viewDisposals,
        id,
      );
      const checkboxListeners = new Set<(
        event: vscode.TreeCheckboxChangeEvent<unknown>,
      ) => unknown>();
      const tree = {
        id,
        badge: undefined,
        description: undefined,
        message: undefined,
        onDidChangeCheckboxState: (
          listener: (
            event: vscode.TreeCheckboxChangeEvent<unknown>,
          ) => unknown,
        ) => {
          checkboxListeners.add(listener);
          return {
            dispose(): void {
              checkboxListeners.delete(listener);
            },
          };
        },
        dispose: () => {
          registration.dispose();
        },
      } as unknown as vscode.TreeView<unknown>;
      state.createdTrees.push({ id, options, tree, checkboxListeners });
      return tree;
    }),
    onDidGrantWorkspaceTrust: vi.fn(() => {
      if (state.trustRegistrationError !== undefined) {
        const error = state.trustRegistrationError;
        state.trustRegistrationError = undefined;
        throw error;
      }
      return { dispose: vi.fn() };
    }),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    deleteFile: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  EventEmitter: mocks.EventEmitter,
  commands: {
    registerCommand: mocks.registerCommand,
  },
  ExtensionMode: {
    Production: 1,
    Test: 3,
  },
  extensions: {
    getExtension: mocks.getExtension,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  window: {
    registerWebviewViewProvider: mocks.registerWebviewViewProvider,
    createTreeView: mocks.createTreeView,
    showErrorMessage: mocks.showErrorMessage,
    showWarningMessage: mocks.showWarningMessage,
  },
  workspace: {
    fs: { delete: mocks.deleteFile },
    isTrusted: true,
    onDidGrantWorkspaceTrust: mocks.onDidGrantWorkspaceTrust,
    registerTextDocumentContentProvider:
      mocks.registerTextDocumentContentProvider,
  },
}));

import {
  activate,
  deactivate,
  type GitoolRuntime,
} from '../../src/extension.js';

function eventFor(
  listeners: Set<(value: unknown) => unknown>,
): vscode.Event<unknown> {
  return (listener) => {
    listeners.add(listener);
    return {
      dispose(): void {
        listeners.delete(listener);
      },
    };
  };
}

function gitApi(
  repositories: readonly BuiltinRepository[] = [],
): BuiltinGitApi {
  return {
    git: { path: '/usr/bin/git' },
    repositories,
    onDidOpenRepository: eventFor(
      mocks.state.gitOpenListeners,
    ) as vscode.Event<never>,
    onDidCloseRepository: eventFor(
      mocks.state.gitCloseListeners,
    ) as vscode.Event<never>,
    toGitUri: (uri) => uri,
  };
}

function createEvent<T>(): {
  readonly event: vscode.Event<T>;
  readonly fire: (value: T) => void;
} {
  const listeners = new Set<(value: T) => unknown>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return {
        dispose(): void {
          listeners.delete(listener);
        },
      };
    },
    fire: (value) => {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

function testRepository(): BuiltinRepository & {
  readonly fireChange: () => void;
  readonly setChanges: (changes: readonly BuiltinChange[]) => void;
  readonly setHead: (head: BuiltinHead | undefined) => void;
} {
  const changed = createEvent<undefined>();
  const state: BuiltinRepository['state'] = {
    HEAD: { name: 'main' },
    remotes: [{ name: 'origin' }],
    indexChanges: [],
    workingTreeChanges: [{
      uri: { fsPath: '/workspace/repo/a.ts' } as vscode.Uri,
      status: 5,
    }],
    untrackedChanges: [],
    mergeChanges: [],
    onDidChange: changed.event,
  };
  return {
    rootUri: { fsPath: '/workspace/repo' } as vscode.Uri,
    state,
    status: () => Promise.resolve(),
    fetch: () => Promise.resolve(),
    pull: () => Promise.resolve(),
    push: () => Promise.resolve(),
    setBranchUpstream: () => Promise.resolve(),
    fireChange: () => {
      changed.fire(undefined);
    },
    setChanges: (changes) => {
      (state as { workingTreeChanges: readonly BuiltinChange[] })
        .workingTreeChanges = changes;
    },
    setHead: (head) => {
      const mutable = state as { HEAD?: BuiltinHead };
      if (head === undefined) {
        delete mutable.HEAD;
      } else {
        mutable.HEAD = head;
      }
    },
  };
}

function gitExtension(
  activateResult: () => unknown,
): vscode.Extension<unknown> {
  return {
    activate: vi.fn(async () => await activateResult()),
  } as unknown as vscode.Extension<unknown>;
}

function context(): vscode.ExtensionContext {
  return {
    extensionMode: 1,
    extensionUri: { fsPath: '/extension' } as vscode.Uri,
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

async function resolveLastProviderHtml(): Promise<string> {
  const provider = mocks.state.registeredWebviews.at(-1)?.provider;
  expect(provider).toBeDefined();
  const webview = {
    html: '',
    options: {},
  } as unknown as vscode.Webview;
  await provider?.resolveWebviewView(
    { webview } as unknown as vscode.WebviewView,
    { state: undefined },
    {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: vi.fn() }),
    },
  );
  return webview.html;
}

function createdTree(id: string): RegistrationState['createdTrees'][number] {
  const created = [...mocks.state.createdTrees]
    .reverse()
    .find((tree) => tree.id === id);
  if (created === undefined) {
    throw new Error(`尚未创建视图：${id}`);
  }
  return created;
}

beforeEach(() => {
  deactivate();
  mocks.state.activeCommands.clear();
  mocks.state.activeViews.clear();
  mocks.state.activeContentProviders.clear();
  mocks.state.commandDisposals.length = 0;
  mocks.state.viewDisposals.length = 0;
  mocks.state.registeredWebviews.length = 0;
  mocks.state.createdTrees.length = 0;
  mocks.state.gitOpenListeners.clear();
  mocks.state.gitCloseListeners.clear();
  mocks.state.commandRegistrationError = undefined;
  mocks.state.trustRegistrationError = undefined;
  mocks.state.gitExtension = undefined;
  vi.clearAllMocks();
});

describe('扩展激活', () => {
  it('内置 Git 缺失时进入 Git 不可用模式', async () => {
    const runtime = await activate(context());

    expect(runtime.mode).toBe('git-unavailable');
    expect(mocks.state.registeredWebviews.map(({ id }) => id)).toEqual([
      'gitool.commitView',
    ]);
    expect(mocks.state.createdTrees.map(({ id }) => id)).toEqual([
      'gitool.changesView',
      'gitool.historyView',
    ]);
    expect(createdTree('gitool.changesView').tree.message).toBe(
      createdTree('gitool.historyView').tree.message,
    );
    expect(
      createdTree('gitool.changesView').options.treeDataProvider.getChildren(),
    ).toEqual([]);
    expect(await resolveLastProviderHtml()).toContain('请启用内置 Git');
  });

  it('就绪运行时注册一个 Webview 和两个原生 TreeView', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));

    await activate(context());

    expect(mocks.state.registeredWebviews.map(({ id }) => id)).toEqual([
      'gitool.commitView',
    ]);
    expect(mocks.state.createdTrees.map(({ id }) => id)).toEqual([
      'gitool.changesView',
      'gitool.historyView',
    ]);
    expect(
      createdTree('gitool.changesView').options.manageCheckboxStateManually,
    ).toBe(true);
    expect(
      createdTree('gitool.changesView').checkboxListeners.size,
    ).toBe(1);
    expect(
      createdTree('gitool.historyView').options.showCollapseAll,
    ).toBe(true);
    expect(mocks.state.activeContentProviders.has('gitool-empty')).toBe(true);
  });

  it('仓库状态变化时同步变更徽标和历史同步描述', async () => {
    const repository = testRepository();
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi([repository]),
    }));

    await activate(context());

    expect(createdTree('gitool.changesView').tree.badge).toEqual({
      value: 1,
      tooltip: 'Gitool：1 个变更文件',
    });
    expect(createdTree('gitool.historyView').tree.description).toBe(
      '未设置上游',
    );

    repository.setChanges([]);
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    repository.fireChange();

    expect(createdTree('gitool.changesView').tree.badge).toBeUndefined();
    expect(createdTree('gitool.historyView').tree.description).toBe(
      'origin/main · ↑0 ↓0',
    );
  });

  it('就绪运行时按注册相反顺序释放 View 和命令', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    const runtime = await activate(context());
    const changesTree = createdTree('gitool.changesView');

    runtime.dispose();

    expect(mocks.state.viewDisposals).toEqual([
      'gitool.historyView',
      'gitool.changesView',
      'gitool.commitView',
    ]);
    expect(mocks.state.commandDisposals).toEqual([
      'gitool.openHistoryDiff',
      'gitool.refreshHistory',
      'gitool.pushAll',
      'gitool.pull',
      'gitool.openChange',
      'gitool.trashUntracked',
      'gitool.refreshChanges',
      'gitool.editRemote',
      'gitool.refresh',
    ]);
    expect(mocks.state.activeViews.size).toBe(0);
    expect(mocks.state.activeCommands.size).toBe(0);
    expect(mocks.state.activeContentProviders.size).toBe(0);
    expect(changesTree.checkboxListeners.size).toBe(0);
  });

  it.each([
    {
      name: '激活失败',
      extension: gitExtension(() => {
        throw new Error('Git 激活失败');
      }),
    },
    {
      name: '导出不满足 API 契约',
      extension: gitExtension(() => ({})),
    },
    {
      name: 'API 版本获取失败',
      extension: gitExtension(() => ({
        getAPI(): never {
          throw new Error('API 版本不受支持');
        },
      })),
    },
    {
      name: 'API 版本返回空值',
      extension: gitExtension(() => ({
        getAPI: () => undefined,
      })),
    },
  ])('内置 Git $name 时进入 Git 不可用模式', async ({ extension }) => {
    mocks.state.gitExtension = extension;

    await expect(activate(context())).resolves.toMatchObject({
      mode: 'git-unavailable',
    });
  });

  it('Gitool 部分注册失败时清理资源并显示遮蔽后的初始化根因', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    mocks.state.trustRegistrationError = new Error(
      '监听注册失败：https://user:secret@example.test/repo?token=abc',
    );

    const runtime = await activate(context());

    expect(runtime.mode).toBe('initialization-failed');
    expect(mocks.state.viewDisposals).toEqual([
      'gitool.historyView',
      'gitool.changesView',
      'gitool.commitView',
    ]);
    expect(mocks.state.commandDisposals).toEqual([
      'gitool.openHistoryDiff',
      'gitool.refreshHistory',
      'gitool.pushAll',
      'gitool.pull',
      'gitool.openChange',
      'gitool.trashUntracked',
      'gitool.refreshChanges',
      'gitool.editRemote',
      'gitool.refresh',
    ]);
    expect(mocks.state.gitOpenListeners.size).toBe(0);
    expect(mocks.state.gitCloseListeners.size).toBe(0);
    expect(mocks.state.activeViews.size).toBe(3);
    expect(mocks.state.activeCommands.size).toBe(1);
    expect(mocks.state.createdTrees.slice(-2).map(({ id }) => id)).toEqual([
      'gitool.changesView',
      'gitool.historyView',
    ]);
    expect(createdTree('gitool.changesView').tree.message).toContain(
      'Gitool 初始化失败',
    );
    expect(createdTree('gitool.changesView').tree.message).toBe(
      createdTree('gitool.historyView').tree.message,
    );

    const html = await resolveLastProviderHtml();
    expect(html).toContain('Gitool 初始化失败');
    expect(html).toContain(
      'https://***:***@example.test/repo?token=***',
    );
    expect(html).not.toContain('请启用内置 Git');

    const nextRuntime: GitoolRuntime = await activate(context());
    expect(nextRuntime.mode).toBe('ready');
    expect(mocks.state.activeViews.size).toBe(3);
    expect(mocks.state.activeCommands.size).toBe(9);
  });

  it('View 命令注册中途失败时清理此前注册的命令和运行时资源', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    mocks.state.commandRegistrationError = {
      id: 'gitool.pull',
      error: new Error('拉取命令注册失败'),
    };

    const runtime = await activate(context());

    expect(runtime.mode).toBe('initialization-failed');
    expect(mocks.state.commandDisposals).toEqual([
      'gitool.openChange',
      'gitool.trashUntracked',
      'gitool.refreshChanges',
      'gitool.editRemote',
      'gitool.refresh',
    ]);
    expect(mocks.state.viewDisposals).toEqual([
      'gitool.historyView',
      'gitool.changesView',
      'gitool.commitView',
    ]);
    expect(mocks.state.activeViews.size).toBe(3);
    expect([...mocks.state.activeCommands.keys()]).toEqual([
      'gitool.refresh',
    ]);
  });
});
