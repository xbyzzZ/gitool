import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuiltinGitApi } from '../../src/git/builtin-git-api.js';

interface RegistrationState {
  readonly activeCommands: Map<string, vscode.Disposable>;
  readonly activeViews: Map<string, vscode.Disposable>;
  readonly commandDisposals: string[];
  readonly viewDisposals: string[];
  readonly registeredProviders: vscode.WebviewViewProvider[];
  readonly gitOpenListeners: Set<(value: unknown) => unknown>;
  readonly gitCloseListeners: Set<(value: unknown) => unknown>;
  trustRegistrationError: Error | undefined;
  gitExtension: vscode.Extension<unknown> | undefined;
}

const mocks = vi.hoisted(() => {
  const state: RegistrationState = {
    activeCommands: new Map(),
    activeViews: new Map(),
    commandDisposals: [],
    viewDisposals: [],
    registeredProviders: [],
    gitOpenListeners: new Set(),
    gitCloseListeners: new Set(),
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
    getExtension: vi.fn(() => state.gitExtension),
    registerCommand: vi.fn((id: string) =>
      register(state.activeCommands, state.commandDisposals, id)),
    registerWebviewViewProvider: vi.fn((
      id: string,
      provider: vscode.WebviewViewProvider,
    ) => {
      state.registeredProviders.push(provider);
      return register(state.activeViews, state.viewDisposals, id);
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
    showErrorMessage: mocks.showErrorMessage,
    showWarningMessage: mocks.showWarningMessage,
  },
  workspace: {
    fs: { delete: mocks.deleteFile },
    isTrusted: true,
    onDidGrantWorkspaceTrust: mocks.onDidGrantWorkspaceTrust,
    registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
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

function gitApi(): BuiltinGitApi {
  return {
    git: { path: '/usr/bin/git' },
    repositories: [],
    onDidOpenRepository: eventFor(
      mocks.state.gitOpenListeners,
    ) as vscode.Event<never>,
    onDidCloseRepository: eventFor(
      mocks.state.gitCloseListeners,
    ) as vscode.Event<never>,
    toGitUri: (uri) => uri,
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
  const provider = mocks.state.registeredProviders.at(-1);
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

beforeEach(() => {
  deactivate();
  mocks.state.activeCommands.clear();
  mocks.state.activeViews.clear();
  mocks.state.commandDisposals.length = 0;
  mocks.state.viewDisposals.length = 0;
  mocks.state.registeredProviders.length = 0;
  mocks.state.gitOpenListeners.clear();
  mocks.state.gitCloseListeners.clear();
  mocks.state.trustRegistrationError = undefined;
  mocks.state.gitExtension = undefined;
  vi.clearAllMocks();
});

describe('扩展激活', () => {
  it('内置 Git 缺失时进入 Git 不可用模式', async () => {
    const runtime = await activate(context());

    expect(runtime.mode).toBe('git-unavailable');
    expect(await resolveLastProviderHtml()).toContain('请启用内置 Git');
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
    expect(mocks.state.viewDisposals).toEqual(['gitool.commitView']);
    expect(mocks.state.commandDisposals).toEqual(['gitool.refresh']);
    expect(mocks.state.gitOpenListeners.size).toBe(0);
    expect(mocks.state.gitCloseListeners.size).toBe(0);
    expect(mocks.state.activeViews.size).toBe(1);
    expect(mocks.state.activeCommands.size).toBe(1);

    const html = await resolveLastProviderHtml();
    expect(html).toContain('Gitool 初始化失败');
    expect(html).toContain(
      'https://***:***@example.test/repo?token=***',
    );
    expect(html).not.toContain('请启用内置 Git');

    const nextRuntime: GitoolRuntime = await activate(context());
    expect(nextRuntime.mode).toBe('ready');
    expect(mocks.state.activeViews.size).toBe(1);
    expect(mocks.state.activeCommands.size).toBe(1);
  });
});
