import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinGitApi } from '../../src/git/builtin-git-api.js';
import type { RepositoryService } from '../../src/services/repository-service.js';

const vscodeMocks = vi.hoisted(() => ({
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vscodeMocks.showErrorMessage,
    showQuickPick: vscodeMocks.showQuickPick,
  },
  Uri: { joinPath: vi.fn() },
}));

import { GitoolViewProvider } from '../../src/webview/view-provider.js';

function uri(path: string): vscode.Uri {
  return {
    path,
    fsPath: path,
    with(change: { readonly path?: string }): vscode.Uri {
      return uri(change.path ?? path);
    },
    toString: () => `file://${path}`,
  } as vscode.Uri;
}

function model(overrides: Partial<RepositoryViewModel> = {}): RepositoryViewModel {
  return {
    version: 0,
    trusted: true,
    currentRepositoryId: '/workspace/repo',
    repositories: [{ id: '/workspace/repo', label: 'repo', rootPath: '/workspace/repo' }],
    branch: 'main', detached: false, changes: [], changeCount: 1,
    selectedIds: ['a.ts'], commitMessage: '旧文案', operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' }, history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' }, ...overrides,
  };
}

interface ServiceDouble {
  readonly service: RepositoryService;
  readonly getViewModel: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly commitAndPush: ReturnType<typeof vi.fn>;
  readonly selectPushRemote: ReturnType<typeof vi.fn>;
  readonly generateCommitMessage: ReturnType<typeof vi.fn>;
}

function createServiceDouble(initialModel = model()): ServiceDouble {
  const service = {
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    getViewModel: vi.fn(() => initialModel),
    reportFailure: vi.fn(() => true), reportPushFailure: vi.fn(() => true),
    selectRepository: vi.fn(), setCommitMessage: vi.fn(),
    commit: vi.fn().mockResolvedValue({ commitHash: 'abc123', committedPaths: ['a.ts'] }),
    commitAndPush: vi.fn(), selectPushRemote: vi.fn(), retryPush: vi.fn(),
    refresh: vi.fn().mockResolvedValue(initialModel),
    generateCommitMessage: vi.fn(),
  };
  return { ...service, service: service as unknown as RepositoryService };
}

function createHarness(): { readonly view: vscode.WebviewView; readonly receive: (message: unknown) => void; readonly postMessage: ReturnType<typeof vi.fn> } {
  let listener: ((message: unknown) => unknown) | undefined;
  const postMessage = vi.fn().mockResolvedValue(true);
  const webview = {
    cspSource: 'vscode-webview://gitool', html: '', options: {},
    asWebviewUri: (value: vscode.Uri) => value,
    onDidReceiveMessage: (value: (message: unknown) => unknown) => {
      listener = value;
      return { dispose: vi.fn() };
    },
    postMessage,
  } as unknown as vscode.Webview;
  return {
    view: { webview, onDidDispose: () => ({ dispose: vi.fn() }) } as unknown as vscode.WebviewView,
    receive: (message) => {
      if (listener === undefined) throw new Error('Webview 消息监听器尚未注册');
      listener(message);
    },
    postMessage,
  };
}

function createProvider(service: RepositoryService): GitoolViewProvider {
  return new GitoolViewProvider({
    extensionUri: uri('/extension/gitool'),
    gitApi: {} as BuiltinGitApi,
    repositoryService: service,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('GitoolViewProvider', () => {
  it('Webview 就绪后返回提交输入所需状态', async () => {
    const currentModel = model();
    const created = createServiceDouble(currentModel);
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);

    harness.receive({ type: 'ready' });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith({
        type: 'state', model: currentModel,
      });
    });
  });

  it('在活动栏徽标显示当前仓库改动文件数', () => {
    const created = createServiceDouble(model({ changeCount: 4 }));
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    expect(harness.view.badge).toEqual({ value: 4, tooltip: 'Gitool：4 个变更文件' });
  });

  it('提交使用消息绑定的最终文案而不是旧模型文案', async () => {
    const created = createServiceDouble();
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({ type: 'commit', repositoryId: '/workspace/repo', version: 0, message: '新文案', requestId: 'request-1' });

    await vi.waitFor(() => {
      expect(created.commit).toHaveBeenCalledWith(expect.objectContaining({
        repositoryId: '/workspace/repo', version: 0, message: '新文案',
      }));
    });
  });

  it('选择远程后继续推送原提交且不再次提交', async () => {
    const created = createServiceDouble();
    created.commitAndPush.mockResolvedValue({ kind: 'needs-remote', remotes: ['origin'] });
    created.selectPushRemote.mockResolvedValue({ kind: 'pushed', remote: 'origin', branch: 'main' });
    vscodeMocks.showQuickPick.mockResolvedValue({ label: 'origin', remote: 'origin' });
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({ type: 'commitAndPush', repositoryId: '/workspace/repo', version: 0, message: '提交', requestId: 'request-1' });

    await vi.waitFor(() => {
      expect(created.selectPushRemote).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo', version: 0, remote: 'origin',
      });
    });
    expect(created.commitAndPush).toHaveBeenCalledTimes(1);
  });

  it('把 AI 密度和所选文件交给仓库服务', async () => {
    const created = createServiceDouble();
    created.generateCommitMessage.mockResolvedValue({ message: '功能：生成信息', excluded: [], modelId: 'copilot-test' });
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({ type: 'generateCommitMessage', repositoryId: '/workspace/repo', version: 0, selectedIds: ['a.ts'], density: 'detailed', requestId: 'ai-1' });

    await vi.waitFor(() => {
      expect(created.generateCommitMessage).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo', version: 0, selectedIds: ['a.ts'], density: 'detailed',
      }, expect.any(AbortSignal));
    });
  });
});
