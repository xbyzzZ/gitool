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
  readonly lifecycleTrace: string[];
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
  treeRegistrationErrorAtId: string | undefined;
  treeMessageErrorAtId: string | undefined;
  repositoryOnDidChangeErrorAtCall: number | undefined;
  eventEmitterConstructionErrorAt: number | undefined;
  eventEmitterConstructionCount: number;
  disposalErrorAtLabel: string | undefined;
  trustRegistrationError: Error | undefined;
  gitExtension: vscode.Extension<unknown> | undefined;
}

const mocks = vi.hoisted(() => {
  const state: RegistrationState = {
    activeCommands: new Map(),
    activeViews: new Map(),
    activeContentProviders: new Map(),
    lifecycleTrace: [],
    commandDisposals: [],
    viewDisposals: [],
    registeredWebviews: [],
    createdTrees: [],
    gitOpenListeners: new Set(),
    gitCloseListeners: new Set(),
    commandRegistrationError: undefined,
    treeRegistrationErrorAtId: undefined,
    treeMessageErrorAtId: undefined,
    repositoryOnDidChangeErrorAtCall: undefined,
    eventEmitterConstructionErrorAt: undefined,
    eventEmitterConstructionCount: 0,
    disposalErrorAtLabel: undefined,
    trustRegistrationError: undefined,
    gitExtension: undefined,
  };

  const register = (
    active: Map<string, vscode.Disposable>,
    disposed: string[],
    id: string,
    lifecycleLabel: string,
  ): vscode.Disposable => {
    if (active.has(id)) {
      throw new Error(`重复注册：${id}`);
    }
    const disposable: vscode.Disposable = {
      dispose(): void {
        if (active.delete(id)) {
          disposed.push(id);
          state.lifecycleTrace.push(lifecycleLabel);
          if (state.disposalErrorAtLabel === lifecycleLabel) {
            state.disposalErrorAtLabel = undefined;
            throw new Error(`释放失败：${lifecycleLabel}`);
          }
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

      constructor() {
        state.eventEmitterConstructionCount += 1;
        if (
          state.eventEmitterConstructionErrorAt
          === state.eventEmitterConstructionCount
        ) {
          state.eventEmitterConstructionErrorAt = undefined;
          throw new Error('Provider 初始化失败');
        }
      }

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
      return register(
        state.activeCommands,
        state.commandDisposals,
        id,
        `command:${id}`,
      );
    }),
    registerWebviewViewProvider: vi.fn((
      id: string,
      provider: vscode.WebviewViewProvider,
    ) => {
      state.registeredWebviews.push({ id, provider });
      return register(
        state.activeViews,
        state.viewDisposals,
        id,
        `view:${id}`,
      );
    }),
    registerTextDocumentContentProvider: vi.fn((id: string) =>
      register(
        state.activeContentProviders,
        [],
        id,
        `content:${id}`,
      )),
    createTreeView: vi.fn((
      id: string,
      options: vscode.TreeViewOptions<unknown>,
    ) => {
      if (state.treeRegistrationErrorAtId === id) {
        state.treeRegistrationErrorAtId = undefined;
        throw new Error(`TreeView 注册失败：${id}`);
      }
      const registration = register(
        state.activeViews,
        state.viewDisposals,
        id,
        `view:${id}`,
      );
      const checkboxListeners = new Set<(
        event: vscode.TreeCheckboxChangeEvent<unknown>,
      ) => unknown>();
      let message: string | undefined;
      const tree = {
        id,
        badge: undefined,
        description: undefined,
        get message(): string | undefined {
          return message;
        },
        set message(value: string | undefined) {
          if (state.treeMessageErrorAtId === id) {
            state.treeMessageErrorAtId = undefined;
            throw new Error(`TreeView 消息设置失败：${id}`);
          }
          message = value;
        },
        onDidChangeCheckboxState: (
          listener: (
            event: vscode.TreeCheckboxChangeEvent<unknown>,
          ) => unknown,
        ) => {
          checkboxListeners.add(listener);
          return {
            dispose(): void {
              checkboxListeners.delete(listener);
              state.lifecycleTrace.push('checkbox:gitool.changesView');
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
      return {
        dispose: () => {
          state.lifecycleTrace.push('subscription:workspaceTrust');
        },
      };
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

vi.mock('../../src/services/repository-service.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/services/repository-service.js')
  >();
  return {
    ...actual,
    RepositoryService: class extends actual.RepositoryService {
      constructor(
        ...args: ConstructorParameters<typeof actual.RepositoryService>
      ) {
        super(...args);
        const onDidChange = this.onDidChange;
        let registrationCount = 0;
        Object.defineProperty(this, 'onDidChange', {
          value: ((listener, thisArgs, disposables) => {
            registrationCount += 1;
            if (
              mocks.state.repositoryOnDidChangeErrorAtCall
              === registrationCount
            ) {
              mocks.state.repositoryOnDidChangeErrorAtCall = undefined;
              throw new Error('仓库状态同步订阅失败');
            }
            const inner = onDidChange(listener, thisArgs);
            const registrationIndex = registrationCount;
            const disposable: vscode.Disposable = {
              dispose: () => {
                mocks.state.lifecycleTrace.push(
                  `subscription:repository:${String(registrationIndex)}`,
                );
                inner.dispose();
              },
            };
            disposables?.push(disposable);
            return disposable;
          }) satisfies vscode.Event<void>,
        });
      }

      override dispose(): void {
        mocks.state.lifecycleTrace.push('service:repository');
        super.dispose();
      }
    },
  };
});

import {
  activate,
  deactivate,
  type GitoolRuntime,
} from '../../src/extension.js';
import { ChangeTreeProvider } from '../../src/views/change-tree-provider.js';
import { HistoryTreeProvider } from '../../src/views/history-tree-provider.js';
import { GitoolViewProvider } from '../../src/webview/view-provider.js';

// eslint-disable-next-line @typescript-eslint/unbound-method -- 测试通过 call 显式绑定实际实例。
const disposeChangeProvider = ChangeTreeProvider.prototype.dispose;
// eslint-disable-next-line @typescript-eslint/unbound-method -- 测试通过 call 显式绑定实际实例。
const disposeHistoryProvider = HistoryTreeProvider.prototype.dispose;
// eslint-disable-next-line @typescript-eslint/unbound-method -- 测试通过 call 显式绑定实际实例。
const disposeCommitProvider = GitoolViewProvider.prototype.dispose;

function eventFor(
  listeners: Set<(value: unknown) => unknown>,
  lifecycleLabel: string,
): vscode.Event<unknown> {
  return (listener) => {
    listeners.add(listener);
    return {
      dispose(): void {
        listeners.delete(listener);
        mocks.state.lifecycleTrace.push(lifecycleLabel);
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
      'subscription:gitOpen',
    ) as vscode.Event<never>,
    onDidCloseRepository: eventFor(
      mocks.state.gitCloseListeners,
      'subscription:gitClose',
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

const readyLifecycleDisposalOrder = [
  'subscription:workspaceTrust',
  'command:gitool.openHistoryDiff',
  'command:gitool.refreshHistory',
  'command:gitool.pushAll',
  'command:gitool.pull',
  'command:gitool.openChange',
  'command:gitool.trashUntracked',
  'command:gitool.refreshChanges',
  'command:gitool.editRemote',
  'command:gitool.refresh',
  'subscription:repository:3',
  'view:gitool.historyView',
  'checkbox:gitool.changesView',
  'view:gitool.changesView',
  'view:gitool.commitView',
  'content:gitool-empty',
  'provider:history',
  'subscription:repository:2',
  'provider:changes',
  'subscription:repository:1',
  'provider:commit',
  'service:repository',
  'subscription:gitClose',
  'subscription:gitOpen',
] as const;

beforeEach(() => {
  deactivate();
  mocks.state.activeCommands.clear();
  mocks.state.activeViews.clear();
  mocks.state.activeContentProviders.clear();
  mocks.state.lifecycleTrace.length = 0;
  mocks.state.commandDisposals.length = 0;
  mocks.state.viewDisposals.length = 0;
  mocks.state.registeredWebviews.length = 0;
  mocks.state.createdTrees.length = 0;
  mocks.state.gitOpenListeners.clear();
  mocks.state.gitCloseListeners.clear();
  mocks.state.commandRegistrationError = undefined;
  mocks.state.treeRegistrationErrorAtId = undefined;
  mocks.state.treeMessageErrorAtId = undefined;
  mocks.state.repositoryOnDidChangeErrorAtCall = undefined;
  mocks.state.eventEmitterConstructionErrorAt = undefined;
  mocks.state.eventEmitterConstructionCount = 0;
  mocks.state.disposalErrorAtLabel = undefined;
  mocks.state.trustRegistrationError = undefined;
  mocks.state.gitExtension = undefined;
  vi.clearAllMocks();
  vi.spyOn(ChangeTreeProvider.prototype, 'dispose').mockImplementation(
    function tracedChangeProviderDispose(this: ChangeTreeProvider): void {
      mocks.state.lifecycleTrace.push('provider:changes');
      disposeChangeProvider.call(this);
    },
  );
  vi.spyOn(HistoryTreeProvider.prototype, 'dispose').mockImplementation(
    function tracedHistoryProviderDispose(this: HistoryTreeProvider): void {
      mocks.state.lifecycleTrace.push('provider:history');
      disposeHistoryProvider.call(this);
    },
  );
  vi.spyOn(GitoolViewProvider.prototype, 'dispose').mockImplementation(
    function tracedCommitProviderDispose(this: GitoolViewProvider): void {
      mocks.state.lifecycleTrace.push('provider:commit');
      disposeCommitProvider.call(this);
    },
  );
});

describe('扩展激活', () => {
  it.each([
    'gitool.changesView',
    'gitool.historyView',
  ])('错误视图 %s 的消息设置失败时释放已创建的 TreeView', async (viewId) => {
    mocks.state.treeMessageErrorAtId = viewId;

    await expect(activate(context())).rejects.toThrow(
      `TreeView 消息设置失败：${viewId}`,
    );

    expect(mocks.state.activeViews.size).toBe(0);
  });

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
    expect(mocks.state.lifecycleTrace).toEqual(
      readyLifecycleDisposalOrder,
    );
  });

  it('Provider 初始化失败时按统一生命周期栈清理已创建资源', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    mocks.state.eventEmitterConstructionErrorAt = 2;

    const runtime = await activate(context());

    expect(runtime.mode).toBe('initialization-failed');
    expect(mocks.state.lifecycleTrace).toEqual([
      'provider:changes',
      'subscription:repository:1',
      'provider:commit',
      'service:repository',
      'subscription:gitClose',
      'subscription:gitOpen',
    ]);
  });

  it('TreeView 注册失败时按统一生命周期栈清理已创建资源', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    mocks.state.treeRegistrationErrorAtId = 'gitool.historyView';

    const runtime = await activate(context());

    expect(runtime.mode).toBe('initialization-failed');
    expect(mocks.state.lifecycleTrace).toEqual([
      'checkbox:gitool.changesView',
      'view:gitool.changesView',
      'view:gitool.commitView',
      'content:gitool-empty',
      'provider:history',
      'subscription:repository:2',
      'provider:changes',
      'subscription:repository:1',
      'provider:commit',
      'service:repository',
      'subscription:gitClose',
      'subscription:gitOpen',
    ]);
  });

  it('同步订阅注册失败时按统一生命周期栈清理已创建资源', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    mocks.state.repositoryOnDidChangeErrorAtCall = 3;

    const runtime = await activate(context());

    expect(runtime.mode).toBe('initialization-failed');
    expect(mocks.state.lifecycleTrace).toEqual([
      'view:gitool.historyView',
      'checkbox:gitool.changesView',
      'view:gitool.changesView',
      'view:gitool.commitView',
      'content:gitool-empty',
      'provider:history',
      'subscription:repository:2',
      'provider:changes',
      'subscription:repository:1',
      'provider:commit',
      'service:repository',
      'subscription:gitClose',
      'subscription:gitOpen',
    ]);
  });

  it('嵌套 Disposable 释放失败时继续按统一生命周期栈清理', async () => {
    mocks.state.gitExtension = gitExtension(() => ({
      getAPI: () => gitApi(),
    }));
    const runtime = await activate(context());
    mocks.state.disposalErrorAtLabel = 'view:gitool.changesView';

    expect(() => {
      runtime.dispose();
    }).toThrow(AggregateError);

    expect(mocks.state.lifecycleTrace).toEqual(
      readyLifecycleDisposalOrder,
    );
    expect(mocks.state.activeViews.size).toBe(0);
    expect(mocks.state.activeCommands.size).toBe(0);
    expect(mocks.state.activeContentProviders.size).toBe(0);
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
