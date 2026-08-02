import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
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
  readonly onDidChange: ReturnType<typeof vi.fn>;
  readonly getViewModel: ReturnType<typeof vi.fn>;
  readonly reportFailure: ReturnType<typeof vi.fn>;
  readonly selectRepository: ReturnType<typeof vi.fn>;
  readonly setCommitMessage: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly commitAndPush: ReturnType<typeof vi.fn>;
  readonly selectPushRemote: ReturnType<typeof vi.fn>;
  readonly retryPush: ReturnType<typeof vi.fn>;
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

interface HarnessOptions {
  readonly receiveRegistrationError?: Error;
  readonly viewRegistrationError?: Error;
  readonly onReceiveDispose?: () => void;
  readonly onViewDispose?: () => void;
}

function createHarness(options: HarnessOptions = {}): {
  readonly view: vscode.WebviewView;
  readonly receive: (message: unknown) => void;
  readonly receiveListenerCount: () => number;
  readonly postMessage: ReturnType<typeof vi.fn>;
} {
  let listener: ((message: unknown) => unknown) | undefined;
  const postMessage = vi.fn().mockResolvedValue(true);
  const webview = {
    cspSource: 'vscode-webview://gitool', html: '', options: {},
    asWebviewUri: (value: vscode.Uri) => value,
    onDidReceiveMessage: (value: (message: unknown) => unknown) => {
      if (options.receiveRegistrationError !== undefined) {
        throw options.receiveRegistrationError;
      }
      listener = value;
      return {
        dispose: () => {
          listener = undefined;
          options.onReceiveDispose?.();
        },
      };
    },
    postMessage,
  } as unknown as vscode.Webview;
  return {
    view: {
      webview,
      onDidDispose: () => {
        if (options.viewRegistrationError !== undefined) {
          throw options.viewRegistrationError;
        }
        return { dispose: () => options.onViewDispose?.() };
      },
    } as unknown as vscode.WebviewView,
    receive: (message) => {
      if (listener === undefined) throw new Error('Webview 消息监听器尚未注册');
      listener(message);
    },
    receiveListenerCount: () => listener === undefined ? 0 : 1,
    postMessage,
  };
}

function createProvider(service: RepositoryService): GitoolViewProvider {
  return new GitoolViewProvider({
    extensionUri: uri('/extension/gitool'),
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

  it('第二个订阅注册失败时释放已注册的消息订阅', () => {
    const trace: string[] = [];
    const created = createServiceDouble();
    created.onDidChange.mockImplementation(() => {
      throw new Error('仓库状态订阅失败');
    });
    const provider = createProvider(created.service);
    const harness = createHarness({
      onReceiveDispose: () => trace.push('消息订阅'),
    });

    expect(() => {
      provider.resolveWebviewView(harness.view);
    }).toThrow(
      '仓库状态订阅失败',
    );
    expect(trace).toEqual(['消息订阅']);
    expect(harness.receiveListenerCount()).toBe(0);
  });

  it('第三个订阅注册失败时逆序释放前两个订阅', () => {
    const trace: string[] = [];
    const created = createServiceDouble();
    created.onDidChange.mockReturnValue({
      dispose: () => trace.push('仓库状态订阅'),
    });
    const provider = createProvider(created.service);
    const harness = createHarness({
      viewRegistrationError: new Error('视图释放订阅失败'),
      onReceiveDispose: () => trace.push('消息订阅'),
    });

    expect(() => {
      provider.resolveWebviewView(harness.view);
    }).toThrow(
      '视图释放订阅失败',
    );
    expect(trace).toEqual(['仓库状态订阅', '消息订阅']);
    expect(harness.receiveListenerCount()).toBe(0);
  });

  it('订阅释放异常时继续逆序清理其余订阅并聚合错误', () => {
    const trace: string[] = [];
    const created = createServiceDouble();
    created.onDidChange.mockReturnValue({
      dispose: () => {
        trace.push('仓库状态订阅');
        throw new Error('仓库状态订阅释放失败');
      },
    });
    const provider = createProvider(created.service);
    const harness = createHarness({
      onReceiveDispose: () => trace.push('消息订阅'),
      onViewDispose: () => trace.push('视图释放订阅'),
    });
    provider.resolveWebviewView(harness.view);

    expect(() => {
      provider.dispose();
    }).toThrow(AggregateError);
    expect(trace).toEqual([
      '视图释放订阅',
      '仓库状态订阅',
      '消息订阅',
    ]);
    expect(harness.receiveListenerCount()).toBe(0);
  });

  it('提交使用消息绑定的最终文案而不是旧模型文案', async () => {
    const created = createServiceDouble(model({ selectedIds: ['a.ts', 'b.ts'] }));
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({ type: 'commit', repositoryId: '/workspace/repo', version: 0, message: '新文案', requestId: 'request-1' });

    await vi.waitFor(() => {
      expect(created.commit).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo',
        version: 0,
        message: '新文案',
        selectedIds: ['a.ts', 'b.ts'],
      });
    });
  });

  it('拒绝旧仓库同版本的提交请求', async () => {
    const created = createServiceDouble(model({
      currentRepositoryId: '/workspace/repo-b',
      repositories: [{
        id: '/workspace/repo-b', label: 'repo-b', rootPath: '/workspace/repo-b',
      }],
    }));
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({
      type: 'commit', repositoryId: '/workspace/repo-a', version: 0,
      message: '仓库 A 提交', requestId: 'old-repository',
    });

    await vi.waitFor(() => {
      expect(created.reportFailure).toHaveBeenCalledWith(
        '提交',
        '界面来源仓库与当前仓库不一致，请等待刷新',
      );
    });
    expect(created.commit).not.toHaveBeenCalled();
  });

  it('选择远程后继续推送原提交且不再次提交', async () => {
    const created = createServiceDouble();
    created.commitAndPush.mockResolvedValue({ kind: 'needs-remote', remotes: ['origin'] });
    created.selectPushRemote.mockResolvedValue({ kind: 'pushed', remote: 'origin', branch: 'main' });
    vscodeMocks.showQuickPick.mockResolvedValue({ label: 'origin', remote: 'origin' });
    created.getViewModel.mockReturnValueOnce(model());
    created.getViewModel.mockReturnValueOnce(model());
    created.getViewModel.mockReturnValue(model({ version: 1 }));
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({ type: 'commitAndPush', repositoryId: '/workspace/repo', version: 0, message: '提交', requestId: 'request-1' });

    await vi.waitFor(() => {
      expect(created.selectPushRemote).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo', version: 1, remote: 'origin',
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

  it('重试推送使用当前仓库和消息版本', async () => {
    const created = createServiceDouble();
    created.retryPush.mockResolvedValue({
      kind: 'pushed', remote: 'origin', branch: 'main',
    });
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({
      type: 'retryPush', repositoryId: '/workspace/repo', version: 0,
      requestId: 'retry-1',
    });

    await vi.waitFor(() => {
      expect(created.retryPush).toHaveBeenCalledWith({
        repositoryId: '/workspace/repo', version: 0,
      });
    });
  });

  it('取消 AI 生成会中止仍在运行的请求', async () => {
    const created = createServiceDouble();
    let rejectGeneration: (reason: unknown) => void = () => undefined;
    const generation = new Promise<void>((_resolve, reject) => {
      rejectGeneration = reject;
    });
    created.generateCommitMessage.mockReturnValue(generation);
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({
      type: 'generateCommitMessage', repositoryId: '/workspace/repo', version: 0,
      selectedIds: ['a.ts'], density: 'standard', requestId: 'ai-1',
    });
    await vi.waitFor(() => {
      expect(created.generateCommitMessage).toHaveBeenCalledOnce();
    });
    const signal = created.generateCommitMessage.mock.calls[0]?.[1] as AbortSignal;
    harness.receive({
      type: 'cancelCommitMessageGeneration', repositoryId: '/workspace/repo',
      requestId: 'ai-1',
    });

    await vi.waitFor(() => {
      expect(signal.aborted).toBe(true);
    });
    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalled();
    });
    const postCountBeforeRejection = harness.postMessage.mock.calls.length;
    rejectGeneration(new Error('已取消'));
    await vi.waitFor(() => {
      expect(harness.postMessage.mock.calls.length)
        .toBeGreaterThan(postCountBeforeRejection);
    });
    expect(created.reportFailure).not.toHaveBeenCalled();
  });

  it('切换仓库后回传对应 acknowledgedRequestId', async () => {
    const created = createServiceDouble();
    const provider = createProvider(created.service);
    const harness = createHarness();
    provider.resolveWebviewView(harness.view);
    harness.receive({
      type: 'selectRepository', repositoryId: '/workspace/repo-b',
      requestId: 'switch-1',
    });

    await vi.waitFor(() => {
      expect(created.selectRepository).toHaveBeenCalledWith('/workspace/repo-b');
      expect(harness.postMessage).toHaveBeenCalledWith({
        type: 'state', model: model(), acknowledgedRequestId: 'switch-1',
      });
    });
  });
});
