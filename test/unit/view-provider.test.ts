import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinGitApi } from '../../src/git/builtin-git-api.js';
import type { RepositoryService } from '../../src/services/repository-service.js';

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
}

function createServiceDouble(initialModel = model()): ServiceDouble {
  const getViewModel = vi.fn().mockReturnValue(initialModel);
  const commitAndPush = vi.fn();
  const commit = vi.fn();
  const selectPushRemote = vi.fn();
  const trash = vi.fn();
  const reportFailure = vi.fn().mockReturnValue(true);
  const setRemoteUrl = vi.fn();
  const getRepository = vi.fn().mockReturnValue({
    rootUri: uri('/workspace/repo'),
    state: {
      remotes: [],
    },
  });
  const service = {
    onDidChange: () => ({ dispose: vi.fn() }),
    getViewModel,
    getRepository,
    getFileChange: vi.fn(),
    reportFailure,
    reportPushFailure: vi.fn().mockReturnValue(true),
    refresh: vi.fn().mockResolvedValue(initialModel),
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
  };
}

interface ViewHarness {
  readonly view: vscode.WebviewView;
  readonly receive: (message: unknown) => void;
  readonly postMessage: ReturnType<typeof vi.fn>;
}

function createViewHarness(): ViewHarness {
  let messageListener: ((message: unknown) => unknown) | undefined;
  const postMessage = vi.fn().mockResolvedValue(true);
  const webview = {
    cspSource: 'vscode-webview://gitool',
    html: '',
    options: {},
    asWebviewUri: (value: vscode.Uri) => value,
    onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
      messageListener = listener;
      return { dispose: vi.fn() };
    },
    postMessage,
  } as unknown as vscode.Webview;
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

function createProvider(service: RepositoryService): GitoolViewProvider {
  const gitApi = {
    toGitUri: vi.fn((value: vscode.Uri) => value),
  } as unknown as BuiltinGitApi;
  return new GitoolViewProvider({
    extensionUri: uri('/extension/gitool'),
    gitApi,
    repositoryService: service,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitoolViewProvider', () => {
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
