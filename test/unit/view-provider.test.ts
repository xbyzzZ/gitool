import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinGitApi } from '../../src/git/builtin-git-api.js';
import type { RepositoryService } from '../../src/services/repository-service.js';
import {
  AiModelSelectionStore,
  type AiModelSelectionPersistence,
} from '../../src/services/ai-model-selection-store.js';

const vscodeMocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showTextDocument: vi.fn(),
  showWarningMessage: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: { executeCommand: vscodeMocks.executeCommand },
  FileType: { Directory: 2 },
  Uri: {
    from: (components: { readonly scheme: string; readonly path: string }) => ({
      scheme: components.scheme,
      path: components.path,
      fsPath: components.path,
      toString: () => `${components.scheme}:${components.path}`,
    }),
    joinPath: (base: vscode.Uri, ...parts: readonly string[]) => uri(
      [base.path, ...parts].join('/').replaceAll('//', '/'),
    ),
  },
  window: {
    showErrorMessage: vscodeMocks.showErrorMessage,
    showInputBox: vscodeMocks.showInputBox,
    showQuickPick: vscodeMocks.showQuickPick,
    showTextDocument: vscodeMocks.showTextDocument,
    showWarningMessage: vscodeMocks.showWarningMessage,
  },
  workspace: { fs: { stat: vscodeMocks.stat } },
}));

import { GitoolViewProvider } from '../../src/webview/view-provider.js';

function uri(path: string): vscode.Uri {
  return {
    fsPath: path,
    path,
    with(change: { readonly path?: string }): vscode.Uri {
      return uri(change.path ?? path);
    },
    toString(): string {
      return `file://${path}`;
    },
  } as vscode.Uri;
}

function model(
  overrides: Partial<RepositoryViewModel> = {},
): RepositoryViewModel {
  return {
    version: 0,
    trusted: true,
    currentRepositoryId: '/workspace/repo',
    repositories: [{
      id: '/workspace/repo',
      label: 'repo',
      rootPath: '/workspace/repo',
    }],
    branch: 'main',
    detached: false,
    changes: [{
      id: 'a.ts',
      path: 'a.ts',
      kind: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['a.ts'],
    }],
    changeCount: 1,
    selectedIds: ['a.ts'],
    commitMessage: '提交',
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
    ...overrides,
    hasRemote: overrides.hasRemote ?? false,
    hasHeadCommit: overrides.hasHeadCommit ?? true,
  };
}

interface ServiceDouble {
  readonly service: RepositoryService;
  readonly getViewModel: ReturnType<typeof vi.fn>;
  readonly getRepository: ReturnType<typeof vi.fn>;
  readonly commitAndPush: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly selectPushRemote: ReturnType<typeof vi.fn>;
  readonly trash: ReturnType<typeof vi.fn>;
  readonly reportFailure: ReturnType<typeof vi.fn>;
  readonly setRemoteUrl: ReturnType<typeof vi.fn>;
  readonly addRemote: ReturnType<typeof vi.fn>;
  readonly refresh: ReturnType<typeof vi.fn>;
  readonly refreshHistory: ReturnType<typeof vi.fn>;
  readonly loadCommitDetails: ReturnType<typeof vi.fn>;
  readonly fetchHistory: ReturnType<typeof vi.fn>;
  readonly pull: ReturnType<typeof vi.fn>;
  readonly pushAll: ReturnType<typeof vi.fn>;
  readonly generateCommitMessage: ReturnType<typeof vi.fn>;
  readonly listAiModels: ReturnType<typeof vi.fn>;
  readonly fireChange: () => void;
}

function createServiceDouble(initialModel = model()): ServiceDouble {
  const getViewModel = vi.fn().mockReturnValue(initialModel);
  const commitAndPush = vi.fn();
  const commit = vi.fn();
  const selectPushRemote = vi.fn();
  const trash = vi.fn();
  const reportFailure = vi.fn().mockReturnValue(true);
  const setRemoteUrl = vi.fn();
  const addRemote = vi.fn();
  const refresh = vi.fn().mockResolvedValue(initialModel);
  const refreshHistory = vi.fn().mockResolvedValue(undefined);
  const loadCommitDetails = vi.fn();
  const fetchHistory = vi.fn().mockResolvedValue(undefined);
  const pull = vi.fn().mockResolvedValue(undefined);
  const pushAll = vi.fn();
  const generateCommitMessage = vi.fn();
  const listAiModels = vi.fn().mockResolvedValue([]);
  const changeListeners = new Set<() => unknown>();
  const getRepository = vi.fn().mockReturnValue({
    rootUri: uri('/workspace/repo'),
    state: {
      remotes: [],
    },
  });
  const service = {
    onDidChange: (listener: () => unknown) => {
      changeListeners.add(listener);
      return { dispose: () => changeListeners.delete(listener) };
    },
    getViewModel,
    getRepository,
    getFileChange: vi.fn(),
    reportFailure,
    reportPushFailure: vi.fn().mockReturnValue(true),
    refresh,
    selectRepository: vi.fn(),
    setFileSelected: vi.fn(),
    setGroup: vi.fn(),
    setCommitMessage: vi.fn(),
    commit,
    commitAndPush,
    selectPushRemote,
    retryPush: vi.fn(),
    trash,
    setRemoteUrl,
    addRemote,
    refreshHistory,
    loadCommitDetails,
    fetchHistory,
    pull,
    pushAll,
    generateCommitMessage,
    listAiModels,
  } as unknown as RepositoryService;
  return {
    service,
    getViewModel,
    getRepository,
    commitAndPush,
    commit,
    selectPushRemote,
    trash,
    reportFailure,
    setRemoteUrl,
    addRemote,
    refresh,
    refreshHistory,
    loadCommitDetails,
    fetchHistory,
    pull,
    pushAll,
    generateCommitMessage,
    listAiModels,
    fireChange: () => {
      for (const listener of changeListeners) {
        listener();
      }
    },
  };
}

interface ViewHarness {
  readonly view: vscode.WebviewView;
  readonly receive: (message: unknown) => void;
  readonly postMessage: ReturnType<typeof vi.fn>;
}

function createViewHarness(options: {
  readonly emitReadyWhenHtmlSet?: boolean;
} = {}): ViewHarness {
  let messageListener: ((message: unknown) => unknown) | undefined;
  let html = '';
  const postMessage = vi.fn().mockResolvedValue(true);
  const webview = {
    cspSource: 'vscode-webview://gitool',
    options: {},
    asWebviewUri: (value: vscode.Uri) => value,
    onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
      messageListener = listener;
      return { dispose: vi.fn() };
    },
    postMessage,
  } as unknown as vscode.Webview;
  Object.defineProperty(webview, 'html', {
    configurable: true,
    get: () => html,
    set: (value: string) => {
      html = value;
      if (options.emitReadyWhenHtmlSet === true) {
        messageListener?.({ type: 'ready' });
      }
    },
  });
  const view = {
    webview,
    onDidDispose: () => ({ dispose: vi.fn() }),
  } as unknown as vscode.WebviewView;
  return {
    view,
    postMessage,
    receive: (message) => {
      if (messageListener === undefined) {
        throw new Error('Webview 消息监听器尚未注册');
      }
      messageListener(message);
    },
  };
}

function createSelectionStore(
  initial: Record<string, { readonly id: string; readonly name: string }> = {},
): AiModelSelectionStore {
  let value: unknown = initial;
  const persistence = {
    get: () => value,
    update: (_key: string, next: unknown) => {
      value = next;
      return Promise.resolve();
    },
  } satisfies AiModelSelectionPersistence;
  return new AiModelSelectionStore(persistence);
}

function createProvider(
  service: RepositoryService,
  aiModelSelectionStore = createSelectionStore(),
): GitoolViewProvider {
  const gitApi = {
    toGitUri: vi.fn((value: vscode.Uri) => value),
  } as unknown as BuiltinGitApi;
  return new GitoolViewProvider({
    extensionUri: uri('/extension/gitool'),
    gitApi,
    repositoryService: service,
    aiModelSelectionStore,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitoolViewProvider', () => {
  it('在写入 Webview HTML 前注册消息监听以接住首次 ready', async () => {
    const created = createServiceDouble();
    const provider = createProvider(created.service);
    const harness = createViewHarness({ emitReadyWhenHtmlSet: true });

    provider.resolveWebviewView(harness.view);

    await vi.waitFor(() => {
      expect(created.refresh).toHaveBeenCalledOnce();
    });
  });

  it('Webview 首次就绪时先刷新仓库快照并读取提交历史', async () => {
    const created = createServiceDouble();
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({ type: 'ready' });

    await vi.waitFor(() => {
      expect(created.refresh).toHaveBeenCalledOnce();
    });
    expect(created.refreshHistory).not.toHaveBeenCalled();
  });

  it('在活动栏徽标显示当前仓库改动文件数并在清空后移除', async () => {
    const created = createServiceDouble(model({ changeCount: 4 }));
    const provider = createProvider(created.service);
    const harness = createViewHarness();

    provider.resolveWebviewView(harness.view);

    expect(harness.view.badge).toEqual({
      value: 4,
      tooltip: 'Gitool：4 个变更文件',
    });

    created.getViewModel.mockReturnValue(model({
      changes: [],
      selectedIds: [],
      changeCount: 0,
    }));
    created.fireChange();
    await vi.waitFor(() => {
      expect(harness.view.badge).toBeUndefined();
    });
  });

  it('路由远程刷新、拉取和推送全部消息', async () => {
    const created = createServiceDouble();
    created.pushAll.mockResolvedValue({
      kind: 'pushed',
      remote: 'origin',
      branch: 'main',
    });
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    for (const type of ['fetchHistory', 'pull', 'pushAll'] as const) {
      harness.receive({
        type,
        repositoryId: '/workspace/repo',
        version: 0,
        requestId: `request-${type}`,
      });
    }

    await vi.waitFor(() => {
      expect(created.fetchHistory).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
      });
      expect(created.pull).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
      });
      expect(created.pushAll).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
      });
    });
  });

  it('推送全部在无上游时选择远程并继续建立上游', async () => {
    const created = createServiceDouble();
    created.pushAll
      .mockResolvedValueOnce({ kind: 'needs-remote', remotes: ['origin'] })
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'main',
      });
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'pushAll',
      repositoryId: '/workspace/repo',
      version: 0,
      requestId: 'push-all-1',
    });

    await vi.waitFor(() => {
      expect(created.pushAll).toHaveBeenNthCalledWith(2, {
        repositoryId: '/workspace/repo',
        version: 0,
        selectedRemote: 'origin',
      });
    });
  });

  it('把 AI 密度和所选文件交给仓库服务', async () => {
    const created = createServiceDouble();
    created.generateCommitMessage.mockResolvedValue({
      message: '功能：生成信息',
      excluded: [],
      modelId: 'copilot-test',
    });
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'generateCommitMessage',
      repositoryId: '/workspace/repo',
      version: 0,
      selectedIds: ['a.ts'],
      density: 'detailed',
      requestId: 'ai-1',
    });

    await vi.waitFor(() => {
      expect(created.generateCommitMessage).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
        selectedIds: ['a.ts'],
        density: 'detailed',
      }, expect.any(AbortSignal));
    });
  });

  it('选择具体 AI 模型后按仓库保存并用于生成', async () => {
    const created = createServiceDouble();
    created.listAiModels.mockResolvedValue([
      {
        id: 'model-1', name: '模型一', vendor: 'copilot',
        family: 'family-1', version: '1', maxInputTokens: 8192,
      },
      {
        id: 'model-2', name: '模型二', vendor: 'copilot',
        family: 'family-2', version: '2', maxInputTokens: 16_384,
      },
    ]);
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[2]),
    );
    const store = createSelectionStore();
    const provider = createProvider(created.service, store);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'selectAiModel',
      repositoryId: '/workspace/repo',
      requestId: 'select-model-1',
    });

    await vi.waitFor(() => {
      expect(store.get('/workspace/repo')).toEqual({
        id: 'model-2',
        name: '模型二',
      });
    });
    expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'state',
      aiModelSelection: { id: 'model-2', name: '模型二' },
      acknowledgedRequestId: 'select-model-1',
    }));

    harness.receive({
      type: 'generateCommitMessage',
      repositoryId: '/workspace/repo',
      version: 0,
      selectedIds: ['a.ts'],
      density: 'standard',
      requestId: 'generate-model-1',
    });

    await vi.waitFor(() => {
      expect(created.generateCommitMessage).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
        selectedIds: ['a.ts'],
        density: 'standard',
        modelId: 'model-2',
      }, expect.any(AbortSignal));
    });
  });

  it('取消模型选择时保留当前仓库原选择', async () => {
    const created = createServiceDouble();
    created.listAiModels.mockResolvedValue([{
      id: 'model-1', name: '模型一', vendor: 'copilot',
      family: 'family-1', version: '1', maxInputTokens: 8192,
    }]);
    vscodeMocks.showQuickPick.mockResolvedValue(undefined);
    const store = createSelectionStore({
      '/workspace/repo': { id: 'model-1', name: '模型一' },
    });
    const provider = createProvider(created.service, store);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'selectAiModel',
      repositoryId: '/workspace/repo',
      requestId: 'select-model-cancel',
    });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        acknowledgedRequestId: 'select-model-cancel',
      }));
    });
    expect(store.get('/workspace/repo')).toEqual({
      id: 'model-1',
      name: '模型一',
    });
  });

  it('选择自动模式时清除当前仓库显式模型', async () => {
    const created = createServiceDouble();
    created.listAiModels.mockResolvedValue([{
      id: 'model-1', name: '模型一', vendor: 'copilot',
      family: 'family-1', version: '1', maxInputTokens: 8192,
    }]);
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    const store = createSelectionStore({
      '/workspace/repo': { id: 'model-1', name: '模型一' },
    });
    const provider = createProvider(created.service, store);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'selectAiModel',
      repositoryId: '/workspace/repo',
      requestId: 'select-model-auto',
    });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        acknowledgedRequestId: 'select-model-auto',
      }));
    });
    expect(store.get('/workspace/repo')).toBeUndefined();
  });

  it('没有可用模型时仍允许清除失效的显式选择', async () => {
    const created = createServiceDouble();
    created.listAiModels.mockResolvedValue([]);
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    const store = createSelectionStore({
      '/workspace/repo': { id: 'missing-model', name: '已失效模型' },
    });
    const provider = createProvider(created.service, store);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'selectAiModel',
      repositoryId: '/workspace/repo',
      requestId: 'select-model-empty',
    });

    await vi.waitFor(() => {
      expect(vscodeMocks.showQuickPick).toHaveBeenCalledWith([
        expect.objectContaining({ label: '自动选择（推荐）' }),
      ], expect.any(Object));
      expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        acknowledgedRequestId: 'select-model-empty',
      }));
    });
    expect(store.get('/workspace/repo')).toBeUndefined();
  });

  it('重建 Webview 后从工作区状态恢复当前仓库模型', async () => {
    const created = createServiceDouble();
    const store = createSelectionStore({
      '/workspace/repo': { id: 'model-1', name: '模型一' },
    });
    const provider = createProvider(created.service, store);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({ type: 'ready' });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'state',
        aiModelSelection: { id: 'model-1', name: '模型一' },
      }));
    });
  });

  it('选择远程后继续推送原提交且不再次提交', async () => {
    const created = createServiceDouble();
    created.commitAndPush.mockResolvedValue({
      kind: 'needs-remote',
      remotes: ['origin'],
    });
    created.selectPushRemote.mockResolvedValue({
      kind: 'pushed',
      remote: 'origin',
      branch: 'main',
    });
    created.getViewModel
      .mockReturnValueOnce(model())
      .mockReturnValueOnce(model())
      .mockReturnValue(model({ version: 1 }));
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'commitAndPush',
      repositoryId: '/workspace/repo',
      version: 0,
      message: '提交',
      requestId: 'request-1',
    });

    await vi.waitFor(() => {
      expect(created.selectPushRemote).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 1,
        remote: 'origin',
      });
    });
    expect(created.commitAndPush).toHaveBeenCalledTimes(1);
    expect(created.selectPushRemote).toHaveBeenCalledTimes(1);
  });

  it('远程 URL 含凭据时只显示遮蔽值且不回填敏感原文', async () => {
    const created = createServiceDouble();
    const repository = {
      rootUri: uri('/workspace/repo'),
      state: {
        remotes: [{
          name: 'origin',
          fetchUrl: 'https://user:secret@example.test/repo.git',
        }],
      },
    };
    created.getRepository.mockReturnValue(repository);
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    vscodeMocks.showInputBox.mockResolvedValue(undefined);
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'editRemoteUrl',
      repositoryId: '/workspace/repo',
      version: 0,
      requestId: 'request-1',
    });

    await vi.waitFor(() => {
      expect(vscodeMocks.showInputBox).toHaveBeenCalled();
    });
    expect(vscodeMocks.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          description: 'https://***:***@example.test/repo.git',
          remoteName: 'origin',
        }),
      ],
      expect.any(Object),
    );
    expect(vscodeMocks.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '',
        placeHolder: 'https://***:***@example.test/repo.git',
      }),
    );
    expect(JSON.stringify(vscodeMocks.showQuickPick.mock.calls))
      .not.toContain('user:secret');
    expect(JSON.stringify(vscodeMocks.showInputBox.mock.calls))
      .not.toContain('user:secret');
    expect(created.setRemoteUrl).not.toHaveBeenCalled();
  });

  it('无远程时收集 URL 并添加 origin', async () => {
    const created = createServiceDouble();
    created.addRemote.mockResolvedValue({
      name: 'origin',
      url: 'https://example.test/repo.git',
    });
    vscodeMocks.showInputBox.mockResolvedValue(
      'https://example.test/repo.git',
    );
    vscodeMocks.showWarningMessage.mockResolvedValue('确认添加');
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'editRemoteUrl',
      repositoryId: '/workspace/repo',
      version: 0,
      requestId: 'add-remote-1',
    });

    await vi.waitFor(() => {
      expect(created.addRemote).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
        remote: 'origin',
        url: 'https://example.test/repo.git',
      });
    });
    expect(vscodeMocks.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Gitool：添加远程 origin',
        value: '',
      }),
    );
    expect(vscodeMocks.showQuickPick).not.toHaveBeenCalled();
    expect(created.refresh).toHaveBeenCalledOnce();
    expect(created.reportFailure).not.toHaveBeenCalled();
  });

  it('无远程时取消输入不写入失败状态', async () => {
    const created = createServiceDouble();
    vscodeMocks.showInputBox.mockResolvedValue(undefined);
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'editRemoteUrl',
      repositoryId: '/workspace/repo',
      version: 0,
      requestId: 'add-remote-cancel-input',
    });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          acknowledgedRequestId: 'add-remote-cancel-input',
        }),
      );
    });
    expect(created.addRemote).not.toHaveBeenCalled();
    expect(created.setRemoteUrl).not.toHaveBeenCalled();
    expect(created.reportFailure).not.toHaveBeenCalled();
  });

  it('添加远程时遮蔽确认信息中的凭据但写入原始 URL', async () => {
    const created = createServiceDouble();
    const sensitiveUrl = 'https://user:secret@example.test/repo.git';
    vscodeMocks.showInputBox.mockResolvedValue(sensitiveUrl);
    vscodeMocks.showWarningMessage.mockResolvedValue('确认添加');
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'editRemoteUrl',
      repositoryId: '/workspace/repo',
      version: 0,
      requestId: 'add-remote-sensitive',
    });

    await vi.waitFor(() => {
      expect(created.addRemote).toHaveBeenCalledWith(
        expect.objectContaining({ url: sensitiveUrl }),
      );
    });
    expect(JSON.stringify(vscodeMocks.showWarningMessage.mock.calls))
      .not.toContain('user:secret');
    expect(JSON.stringify(vscodeMocks.showWarningMessage.mock.calls))
      .toContain('https://***:***@example.test/repo.git');
  });

  it('无远程时取消确认不添加 origin', async () => {
    const created = createServiceDouble();
    vscodeMocks.showInputBox.mockResolvedValue(
      'https://example.test/repo.git',
    );
    vscodeMocks.showWarningMessage.mockResolvedValue(undefined);
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'editRemoteUrl',
      repositoryId: '/workspace/repo',
      version: 0,
      requestId: 'add-remote-cancel-confirm',
    });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          acknowledgedRequestId: 'add-remote-cancel-confirm',
        }),
      );
    });
    expect(created.addRemote).not.toHaveBeenCalled();
    expect(created.setRemoteUrl).not.toHaveBeenCalled();
    expect(created.reportFailure).not.toHaveBeenCalled();
  });

  it('提交使用消息绑定的最终文案而不是旧模型文案', async () => {
    const initialModel = model({ commitMessage: '旧文案' });
    const created = createServiceDouble(initialModel);
    created.commit.mockResolvedValue({
      commitHash: 'abc123',
      committedPaths: ['a.ts'],
    });
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'commit',
      repositoryId: '/workspace/repo',
      version: 0,
      message: '新文案',
      requestId: 'request-1',
    });

    await vi.waitFor(() => {
      expect(created.commit).toHaveBeenCalledWith(expect.objectContaining({
        repositoryId: '/workspace/repo',
        version: 0,
        message: '新文案',
      }));
      expect(harness.postMessage).toHaveBeenCalledWith({
        type: 'state',
        model: initialModel,
        acknowledgedRequestId: 'request-1',
      });
    });
  });

  it('拒绝把旧仓库界面的提交和舍弃请求应用到同版本新仓库', async () => {
    const created = createServiceDouble(model({
      currentRepositoryId: '/workspace/repo-b',
      repositories: [{
        id: '/workspace/repo-b',
        label: 'repo-b',
        rootPath: '/workspace/repo-b',
      }],
    }));
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'commit',
      repositoryId: '/workspace/repo-a',
      version: 0,
      message: '仓库 A 的提交',
      requestId: 'request-1',
    });
    harness.receive({
      type: 'trash',
      repositoryId: '/workspace/repo-a',
      version: 0,
      fileIds: ['a.ts'],
      requestId: 'request-2',
    });

    await vi.waitFor(() => {
      expect(created.reportFailure).toHaveBeenCalledTimes(2);
    });
    expect(created.commit).not.toHaveBeenCalled();
    expect(created.trash).not.toHaveBeenCalled();
  });

  it('重复写请求被锁拒绝时不覆盖仍在运行的状态', async () => {
    const runningModel = model({
      operation: { kind: 'running', action: 'commit' },
    });
    const created = createServiceDouble(runningModel);
    created.commit.mockRejectedValue(new Error('仓库正在执行写操作'));
    const provider = createProvider(created.service);
    const harness = createViewHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({
      type: 'commit',
      repositoryId: '/workspace/repo',
      version: 0,
      message: '提交',
      requestId: 'request-1',
    });

    await vi.waitFor(() => {
      expect(created.commit).toHaveBeenCalledTimes(1);
    });
    expect(created.reportFailure).not.toHaveBeenCalled();
    expect(created.service.getViewModel().operation).toEqual({
      kind: 'running',
      action: 'commit',
    });
  });
});
