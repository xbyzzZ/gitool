import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { SelectionStore } from '../../src/domain/selection-store.js';
import type {
  BuiltinChange,
  BuiltinGitApi,
  BuiltinHead,
  BuiltinRemote,
  BuiltinRepository,
} from '../../src/git/builtin-git-api.js';
import type { CommitRequest } from '../../src/services/commit-service.js';
import { RepositoryOperationLock } from '../../src/services/operation-lock.js';
import {
  RepositoryService,
  type RepositoryServiceDependencies,
} from '../../src/services/repository-service.js';
import { RepositoryRegistry } from '../../src/services/repository-registry.js';

interface TestEventOptions {
  readonly onRegister?: () => void;
  readonly beforeDispose?: () => void;
  readonly onDispose?: () => void;
}

interface TestEvent<T> {
  readonly event: vscode.Event<T>;
  readonly fire: (value: T) => void;
  readonly listenerCount: () => number;
}

function createEvent<T>(options: TestEventOptions = {}): TestEvent<T> {
  const listeners = new Set<(value: T) => unknown>();
  return {
    event: (listener) => {
      options.onRegister?.();
      listeners.add(listener);
      return {
        dispose(): void {
          options.beforeDispose?.();
          listeners.delete(listener);
          options.onDispose?.();
        },
      };
    },
    fire: (value) => {
      for (const listener of listeners) {
        listener(value);
      }
    },
    listenerCount: () => listeners.size,
  };
}

function uri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

class TestRepository implements BuiltinRepository {
  readonly changed: TestEvent<undefined>;
  readonly rootUri: vscode.Uri;
  readonly state: BuiltinRepository['state'];
  statusCalls = 0;
  private statusEffect: (() => void) | undefined;

  constructor(
    rootPath: string,
    changes: {
      readonly index?: readonly BuiltinChange[];
      readonly working?: readonly BuiltinChange[];
      readonly untracked?: readonly BuiltinChange[];
      readonly merge?: readonly BuiltinChange[];
    } = {},
    changedOptions: TestEventOptions = {},
  ) {
    this.changed = createEvent<undefined>(changedOptions);
    this.rootUri = uri(rootPath);
    this.state = {
      HEAD: { name: 'main' },
      remotes: [{ name: 'origin' }],
      indexChanges: changes.index ?? [],
      workingTreeChanges: changes.working ?? [],
      untrackedChanges: changes.untracked ?? [],
      mergeChanges: changes.merge ?? [],
      onDidChange: this.changed.event,
    };
  }

  status(): Promise<void> {
    this.statusCalls += 1;
    this.statusEffect?.();
    return Promise.resolve();
  }

  fetch(): Promise<void> {
    return Promise.resolve();
  }

  pull(): Promise<void> {
    return Promise.resolve();
  }

  push(): Promise<void> {
    return Promise.resolve();
  }

  setBranchUpstream(): Promise<void> {
    return Promise.resolve();
  }

  setHead(head: BuiltinHead | undefined): void {
    const mutableState = this.state as { HEAD?: BuiltinHead };
    if (head === undefined) {
      delete mutableState.HEAD;
    } else {
      mutableState.HEAD = head;
    }
  }

  setRemotes(remotes: readonly BuiltinRemote[]): void {
    (this.state as { remotes: readonly BuiltinRemote[] }).remotes = remotes;
  }

  setChanges(changes: {
    readonly index?: readonly BuiltinChange[];
    readonly working?: readonly BuiltinChange[];
    readonly untracked?: readonly BuiltinChange[];
    readonly merge?: readonly BuiltinChange[];
  }): void {
    const mutableState = this.state as {
      indexChanges: readonly BuiltinChange[];
      workingTreeChanges: readonly BuiltinChange[];
      untrackedChanges: readonly BuiltinChange[];
      mergeChanges: readonly BuiltinChange[];
    };
    mutableState.indexChanges = changes.index ?? [];
    mutableState.workingTreeChanges = changes.working ?? [];
    mutableState.untrackedChanges = changes.untracked ?? [];
    mutableState.mergeChanges = changes.merge ?? [];
  }

  onStatus(effect: () => void): void {
    this.statusEffect = effect;
  }
}

class TestGitApi implements BuiltinGitApi {
  readonly git = { path: '/usr/bin/git' };
  readonly opened: TestEvent<BuiltinRepository>;
  readonly closed: TestEvent<BuiltinRepository>;
  readonly onDidOpenRepository: vscode.Event<BuiltinRepository>;
  readonly onDidCloseRepository: vscode.Event<BuiltinRepository>;

  constructor(
    readonly repositories: readonly BuiltinRepository[],
    options: {
      readonly opened?: TestEventOptions;
      readonly closed?: TestEventOptions;
    } = {},
  ) {
    this.opened = createEvent<BuiltinRepository>(options.opened);
    this.closed = createEvent<BuiltinRepository>(options.closed);
    this.onDidOpenRepository = this.opened.event;
    this.onDidCloseRepository = this.closed.event;
  }

  toGitUri(value: vscode.Uri): vscode.Uri {
    return value;
  }
}

function change(root: string, path: string, status = 5): BuiltinChange {
  return { uri: uri(`${root}/${path}`), status };
}

function createService(
  repositories: readonly BuiltinRepository[],
  trusted = true,
  overrides: Partial<RepositoryServiceDependencies> = {},
): {
  readonly service: RepositoryService;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly push: ReturnType<typeof vi.fn>;
  readonly trash: ReturnType<typeof vi.fn>;
  readonly remote: ReturnType<typeof vi.fn>;
  readonly addRemote: ReturnType<typeof vi.fn>;
  readonly gitApi: TestGitApi;
} {
  const commit = vi.fn().mockResolvedValue({
    commitHash: 'abc123',
    committedPaths: ['a.ts'],
  });
  const push = vi.fn().mockResolvedValue({
    kind: 'pushed',
    remote: 'origin',
    branch: 'main',
  });
  const trash = vi.fn().mockResolvedValue({
    kind: 'completed',
    succeeded: [],
    failed: [],
  });
  const remote = vi.fn().mockResolvedValue({
    name: 'origin',
    url: 'https://example.test/repo.git',
  });
  const addRemote = vi.fn().mockResolvedValue({
    name: 'origin',
    url: 'https://example.test/repo.git',
  });
  const gitApi = new TestGitApi(repositories);
  const service = new RepositoryService({
    gitApi,
    selectionStore: new SelectionStore(),
    commitService: { commit },
    pushService: { push },
    trashService: { moveToTrash: trash },
    remoteService: { setUrl: remote, add: addRemote },
    operationLock: new RepositoryOperationLock(),
    isWorkspaceTrusted: () => trusted,
    ...overrides,
  });
  return { service, commit, push, trash, remote, addRemote, gitApi };
}

describe('RepositoryService', () => {
  it('添加远程时通过受控写入链路调用远程服务', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    const { service, addRemote } = createService([repository]);

    await expect(service.addRemote({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).resolves.toEqual({
      name: 'origin',
      url: 'https://example.test/repo.git',
    });
    expect(addRemote).toHaveBeenCalledWith(
      root,
      'origin',
      'https://example.test/repo.git',
    );
  });

  it('默认提供变更数、同步、历史和 AI 状态', () => {
    const { service } = createService([]);

    expect(service.getViewModel()).toMatchObject({
      changeCount: 0,
      sync: { kind: 'no-upstream' },
      history: { kind: 'idle', commits: [] },
      ai: { kind: 'idle' },
    });
  });

  it('刷新历史后同时更新提交和领先落后位置', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    const commits = [{
      hash: '1'.repeat(40),
      shortHash: '1111111',
      parents: [],
      author: '许博阳',
      authoredAt: '2026-08-01T10:00:00.000Z',
      subject: '功能：示例',
      refs: [],
      lane: 0,
      parentLanes: [],
    }];
    const historyList = vi.fn().mockResolvedValue({ commits });
    const aheadBehind = vi.fn().mockResolvedValue({
      kind: 'ready',
      upstream: 'origin/main',
      ahead: 3,
      behind: 1,
    });
    const { service } = createService([repository], true, {
      historyService: {
        list: historyList,
        details: vi.fn(),
        aheadBehind,
      },
    });

    await service.refreshHistory({ repositoryId: root, version: 0 });

    expect(service.getViewModel()).toMatchObject({
      history: { kind: 'ready', commits },
      sync: {
        kind: 'ready',
        upstream: 'origin/main',
        ahead: 3,
        behind: 1,
      },
    });
  });

  it('AI 完成前选择变化时丢弃生成结果', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts'), change(root, 'b.ts')],
    });
    let resolveGeneration: ((value: {
      message: string;
      excluded: never[];
      modelId: string;
    }) => void) | undefined;
    const generate = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveGeneration = resolve;
    }));
    const { service } = createService([repository], true, {
      aiService: { generate },
    });
    const request = service.generateCommitMessage({
      repositoryId: root,
      version: 0,
      selectedIds: ['a.ts', 'b.ts'],
      density: 'standard',
    });
    service.setFileSelected('b.ts', false);
    resolveGeneration?.({
      message: '功能：AI 生成',
      excluded: [],
      modelId: 'test-model',
    });

    await expect(request).rejects.toThrow(
      '仓库状态已变化，本次生成结果已丢弃',
    );
    expect(service.getViewModel()).toMatchObject({
      commitMessage: '',
      ai: { kind: 'idle' },
    });
  });

  it('历史读取期间仓库版本变化时不写回过期结果', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    let resolveList: ((value: { commits: readonly never[] }) => void)
      | undefined;
    const list = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveList = resolve;
    }));
    const { service } = createService([repository], true, {
      historyService: {
        list,
        details: vi.fn(),
        aheadBehind: vi.fn().mockResolvedValue({ kind: 'no-upstream' }),
      },
    });
    const refresh = service.refreshHistory({
      repositoryId: root,
      version: 0,
    });
    repository.setChanges({ working: [change(root, 'new.ts')] });
    repository.changed.fire(undefined);
    resolveList?.({ commits: [] });

    await refresh;

    expect(service.getViewModel()).toMatchObject({
      version: 1,
      history: { kind: 'idle', commits: [] },
    });
  });

  it('远程同步与提交共享同一仓库写锁', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    let finishPull: (() => void) | undefined;
    const pull = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      finishPull = resolve;
    }));
    const { service, commit } = createService([repository], true, {
      syncService: {
        fetch: vi.fn(),
        pull,
        pushAll: vi.fn(),
      },
      historyService: {
        list: vi.fn().mockResolvedValue({ commits: [] }),
        details: vi.fn(),
        aheadBehind: vi.fn().mockResolvedValue({
          kind: 'ready',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        }),
      },
    });
    const pulling = service.pull({ repositoryId: root, version: 0 });
    await vi.waitFor(() => {
      expect(pull).toHaveBeenCalledTimes(1);
    });

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库正在执行写操作');
    expect(commit).not.toHaveBeenCalled();

    finishPull?.();
    await pulling;
  });
  it('普通提交写前同分支 HEAD 提交静默前移时拒绝旧请求', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      commit: '111',
    });
    repository.onStatus(() => {
      repository.setHead({
        name: 'main',
        commit: '222',
      });
    });
    const { service, commit } = createService([repository]);

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '过期提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(commit).not.toHaveBeenCalled();
    expect(service.getViewModel().version).toBe(1);
  });

  it('提交并推送写前同分支 HEAD 提交静默前移时拒绝旧请求', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      commit: '111',
    });
    repository.onStatus(() => {
      repository.setHead({
        name: 'main',
        commit: '222',
      });
    });
    const { service, commit, push } = createService([repository]);

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '过期提交并推送',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(commit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('选择推送远程前同分支 HEAD 提交静默前移时拒绝原请求', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      commit: '111',
    });
    const push = vi.fn().mockResolvedValue({
      kind: 'needs-remote',
      remotes: ['origin'],
    });
    const { service } = createService([repository], true, {
      pushService: { push },
    });
    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '创建待选远程提交',
      selectedIds: ['a.ts'],
    })).resolves.toMatchObject({ kind: 'needs-remote' });
    repository.onStatus(() => {
      repository.setHead({
        name: 'main',
        commit: '222',
      });
    });

    await expect(service.selectPushRemote({
      repositoryId: root,
      version: 0,
      remote: 'origin',
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(push).toHaveBeenCalledTimes(1);
  });

  it('重试推送前同分支 HEAD 提交静默前移时拒绝原请求', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      commit: '111',
      upstream: { remote: 'origin', name: 'main' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/original.git',
    }]);
    const push = vi.fn().mockRejectedValue(new Error('网络断开'));
    const { service } = createService([repository], true, {
      pushService: { push },
    });
    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '创建待重试提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');
    repository.onStatus(() => {
      repository.setHead({
        name: 'main',
        commit: '222',
        upstream: { remote: 'origin', name: 'main' },
      });
    });

    await expect(service.retryPush({
      repositoryId: root,
      version: 0,
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(push).toHaveBeenCalledTimes(1);
  });

  it('提交写入前在仓库锁内读取真实状态', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.onStatus(() => {
      repository.changed.fire(undefined);
    });
    const { service, commit } = createService([repository]);

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).resolves.toMatchObject({ commitHash: 'abc123' });

    expect(repository.statusCalls).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('提交写前静默改变所选文件分类时同步快照并拒绝旧请求', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      untracked: [change(root, 'a.ts', 7)],
    });
    const { service, commit } = createService([repository]);
    service.setFileSelected('a.ts', true);
    repository.onStatus(() => {
      repository.setChanges({
        index: [change(root, 'a.ts', 1)],
      });
    });

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '过期提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(repository.statusCalls).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(service.getViewModel()).toMatchObject({
      version: 1,
      changes: [{
        id: 'a.ts',
        staged: true,
        untracked: false,
      }],
    });
  });

  it('废纸篓写前静默把未跟踪文件加入索引时拒绝且不删除', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      untracked: [change(root, 'a.ts', 7)],
    });
    const { service, trash } = createService([repository]);
    service.setFileSelected('a.ts', true);
    repository.onStatus(() => {
      repository.setChanges({
        index: [change(root, 'a.ts', 1)],
      });
    });

    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(repository.statusCalls).toBe(1);
    expect(trash).not.toHaveBeenCalled();
  });

  it('提交并推送写前静默切换 HEAD 时拒绝且不提交', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service, commit, push } = createService([repository]);
    repository.onStatus(() => {
      repository.setHead({ name: 'other' });
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '过期分支提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(repository.statusCalls).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(service.getViewModel()).toMatchObject({
      version: 1,
      branch: 'other',
    });
  });

  it('重试推送前远程身份静默变化时拒绝原版本', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/original.git',
    }]);
    const push = vi.fn().mockRejectedValue(new Error('网络断开'));
    const { service } = createService([repository], true, {
      pushService: { push },
    });
    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '创建待重试提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');
    repository.onStatus(() => {
      repository.setRemotes([{
        name: 'origin',
        pushUrl: 'https://example.test/changed.git',
      }]);
    });

    await expect(service.retryPush({
      repositoryId: root,
      version: 0,
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');

    expect(repository.statusCalls).toBe(3);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('外部和本地状态变化均向视图订阅者发出通知', () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service } = createService([repository]);
    const versions: number[] = [];
    const listener = service.onDidChange(() => {
      versions.push(service.getViewModel().version);
    });

    repository.changed.fire(undefined);
    service.setFileSelected('a.ts', false);
    service.setCommitMessage('新提交信息');

    expect(versions).toEqual([0, 0, 0]);
    listener.dispose();
    service.setFileSelected('a.ts', true);
    expect(versions).toEqual([0, 0, 0]);
  });

  it('写操作的运行和完成状态均向视图订阅者发出通知', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    let finishCommit: ((value: {
      readonly commitHash: string;
      readonly committedPaths: readonly string[];
    }) => void) | undefined;
    const commit = vi.fn().mockReturnValue(new Promise((resolveCommit) => {
      finishCommit = resolveCommit;
    }));
    const { service } = createService([repository], true, {
      commitService: { commit },
    });
    const operations: string[] = [];
    service.onDidChange(() => {
      operations.push(service.getViewModel().operation.kind);
    });

    const pending = service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    });
    await vi.waitFor(() => {
      expect(operations).toEqual(['running']);
    });

    finishCommit?.({
      commitHash: 'abc123',
      committedPaths: ['a.ts'],
    });
    await pending;
    expect(operations).toEqual(['running', 'commit-succeeded']);
  });

  it('可把已创建但未推送的提交标记为可重试状态', () => {
    const repository = new TestRepository('/workspace/repo-a');
    const { service } = createService([repository]);
    const operations: string[] = [];
    service.onDidChange(() => {
      operations.push(service.getViewModel().operation.kind);
    });

    expect(service.reportPushFailure('abc123', '尚未选择远程')).toBe(true);
    expect(service.getViewModel().operation).toEqual({
      kind: 'push-failed',
      commitHash: 'abc123',
      message: '尚未选择远程',
    });
    expect(operations).toEqual(['push-failed']);
  });

  it('仓库状态事件触发后递增版本并重新合并选择', () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service } = createService([repository]);

    expect(service.getViewModel()).toMatchObject({
      version: 0,
      currentRepositoryId: root,
      selectedIds: ['a.ts'],
    });

    repository.setChanges({
      working: [
        change(root, 'a.ts'),
        change(root, 'b.ts'),
      ],
    });
    repository.changed.fire(undefined);

    expect(service.getViewModel()).toMatchObject({
      version: 1,
      selectedIds: ['a.ts', 'b.ts'],
    });
  });

  it('刷新引发无语义变化的状态事件时版本不递增', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    vi.spyOn(repository, 'status').mockImplementation(() => {
      repository.changed.fire(undefined);
      return Promise.resolve();
    });
    const { service } = createService([repository]);

    await expect(service.refresh()).resolves.toMatchObject({ version: 0 });
  });

  it('切换仓库时恢复各自的选择和提交信息', () => {
    const rootA = '/workspace/repo-a';
    const rootB = '/workspace/repo-b';
    const repositoryA = new TestRepository(rootA, {
      working: [change(rootA, 'a.ts')],
    });
    const repositoryB = new TestRepository(rootB, {
      working: [change(rootB, 'b.ts')],
    });
    const { service } = createService([repositoryA, repositoryB]);

    service.setFileSelected('a.ts', false);
    service.setCommitMessage('仓库 A');
    service.selectRepository(rootB);
    service.setCommitMessage('仓库 B');

    expect(service.getViewModel()).toMatchObject({
      currentRepositoryId: rootB,
      selectedIds: ['b.ts'],
      commitMessage: '仓库 B',
    });
    expect(service.selectRepository(rootA)).toMatchObject({
      currentRepositoryId: rootA,
      selectedIds: [],
      commitMessage: '仓库 A',
    });
  });

  it('切换已跟踪分组时保持冲突文件未选中', () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'normal.ts')],
      merge: [change(root, 'conflict.ts', 18)],
    });
    const { service } = createService([repository]);

    service.setGroup('tracked', false);
    service.setGroup('tracked', true);

    expect(service.getViewModel().selectedIds).toEqual(['normal.ts']);
  });

  it('旧版本提交请求在进入提交服务前被拒绝', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service, commit } = createService([repository]);
    repository.setChanges({
      working: [change(root, 'b.ts')],
    });
    repository.changed.fire(undefined);

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');
    expect(commit).not.toHaveBeenCalled();
  });

  it('进入提交服务后仍通过版本回调复核最新状态', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const commit = vi.fn(async (request: CommitRequest) => {
      repository.setChanges({
        working: [change(root, 'b.ts')],
      });
      repository.changed.fire(undefined);
      if (!await request.verifyVersion(request.expectedVersion)) {
        throw new Error('提交前版本复核失败');
      }
      return { commitHash: 'abc123', committedPaths: ['a.ts'] };
    });
    const { service } = createService([repository], true, {
      commitService: { commit },
    });

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('提交前版本复核失败');
    expect(service.getViewModel().version).toBe(1);
  });

  it('未信任工作区在所有写入口进入下游服务前被拒绝', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service, commit, addRemote } = createService([repository], false);
    const commitRequest = {
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    } as const;

    await expect(service.commit(commitRequest))
      .rejects.toThrow('未信任的工作区不能执行写操作');
    await expect(service.commitAndPush(commitRequest))
      .rejects.toThrow('未信任的工作区不能执行写操作');
    await expect(service.selectPushRemote({
      repositoryId: root,
      version: 0,
      remote: 'origin',
    })).rejects.toThrow('未信任的工作区不能执行写操作');
    await expect(service.retryPush({
      repositoryId: root,
      version: 0,
    })).rejects.toThrow('未信任的工作区不能执行写操作');
    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts'],
    })).rejects.toThrow('未信任的工作区不能执行写操作');
    await expect(service.setRemoteUrl({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).rejects.toThrow('未信任的工作区不能执行写操作');
    await expect(service.addRemote({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).rejects.toThrow('未信任的工作区不能执行写操作');
    expect(commit).not.toHaveBeenCalled();
    expect(addRemote).not.toHaveBeenCalled();
  });

  it('映射内置 Git 状态并把合并冲突纳入当前变更', () => {
    const root = '/workspace/../workspace/repo-a';
    const normalizedRoot = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      index: [
        change(normalizedRoot, 'staged.ts', 1),
        {
          ...change(normalizedRoot, 'renamed.ts', 3),
          originalUri: uri(`${normalizedRoot}/old.ts`),
        },
        {
          ...change(normalizedRoot, 'copied.ts', 4),
          originalUri: uri(`${normalizedRoot}/source.ts`),
        },
      ],
      working: [change(normalizedRoot, 'modified.ts', 5)],
      untracked: [change(normalizedRoot, 'new.ts', 7)],
      merge: [change(normalizedRoot, 'conflict.ts', 18)],
    });
    const { service } = createService([repository]);

    expect(service.getViewModel()).toMatchObject({
      currentRepositoryId: normalizedRoot,
      selectedIds: ['copied.ts', 'modified.ts', 'renamed.ts', 'staged.ts'],
      changes: [
        {
          id: 'conflict.ts',
          kind: 'conflicted',
          conflicted: true,
          commitPaths: ['conflict.ts'],
        },
        {
          id: 'copied.ts',
          kind: 'added',
          commitPaths: ['copied.ts'],
        },
        {
          id: 'modified.ts',
          kind: 'modified',
          unstaged: true,
        },
        {
          id: 'new.ts',
          kind: 'untracked',
          untracked: true,
        },
        {
          id: 'renamed.ts',
          kind: 'renamed',
          originalPath: 'old.ts',
          commitPaths: ['old.ts', 'renamed.ts'],
        },
        {
          id: 'staged.ts',
          kind: 'added',
          staged: true,
        },
      ],
    });
  });

  it('工作区变更列表中的状态 7 仍识别为未跟踪且默认不选中', () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'new.ts', 7)],
    });
    const { service } = createService([repository]);

    expect(service.getViewModel()).toMatchObject({
      selectedIds: [],
      changes: [{
        id: 'new.ts',
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      }],
    });
  });

  it('现有仓库状态映射失败时释放已注册的仓库监听', () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'unknown.ts', 99)],
    });

    expect(() => createService([repository])).toThrow('未知的 Git 状态：99');
    expect(repository.changed.listenerCount()).toBe(0);
  });

  it('关闭仓库和释放服务时注销对应监听器', () => {
    const repositoryA = new TestRepository('/workspace/repo-a');
    const repositoryB = new TestRepository('/workspace/repo-b');
    const { service, gitApi } = createService([repositoryA]);

    expect(repositoryA.changed.listenerCount()).toBe(1);
    expect(gitApi.opened.listenerCount()).toBe(1);
    expect(gitApi.closed.listenerCount()).toBe(1);

    gitApi.opened.fire(repositoryB);
    expect(repositoryB.changed.listenerCount()).toBe(1);
    gitApi.closed.fire(repositoryA);
    expect(repositoryA.changed.listenerCount()).toBe(0);
    expect(service.getViewModel().currentRepositoryId)
      .toBe('/workspace/repo-b');

    service.dispose();
    expect(repositoryB.changed.listenerCount()).toBe(0);
    expect(gitApi.opened.listenerCount()).toBe(0);
    expect(gitApi.closed.listenerCount()).toBe(0);
  });

  it('关闭仓库生命周期监听注册失败时释放已注册的打开监听', () => {
    const trace: string[] = [];
    const gitApi = new TestGitApi([], {
      opened: { onDispose: () => trace.push('打开监听') },
      closed: {
        onRegister: () => {
          throw new Error('关闭监听注册失败');
        },
      },
    });

    expect(() => new RepositoryRegistry(gitApi)).toThrow(
      '关闭监听注册失败',
    );
    expect(gitApi.opened.listenerCount()).toBe(0);
    expect(trace).toEqual(['打开监听']);
  });

  it('释放异常时继续按创建顺序的相反顺序清理全部监听', () => {
    const trace: string[] = [];
    const repository = new TestRepository('/workspace/repo-a', {}, {
      onDispose: () => trace.push('仓库监听'),
    });
    const gitApi = new TestGitApi([repository], {
      opened: { onDispose: () => trace.push('打开监听') },
      closed: {
        onDispose: () => {
          trace.push('关闭监听');
          throw new Error('关闭监听释放失败');
        },
      },
    });
    const registry = new RepositoryRegistry(gitApi);

    expect(() => {
      registry.dispose();
    }).toThrow(AggregateError);
    expect(trace).toEqual(['关闭监听', '打开监听', '仓库监听']);
    expect(repository.changed.listenerCount()).toBe(0);
    expect(gitApi.opened.listenerCount()).toBe(0);
    expect(gitApi.closed.listenerCount()).toBe(0);
  });

  it('动态打开仓库后按全部监听的真实创建顺序逆序释放', () => {
    const trace: string[] = [];
    const repositoryA = new TestRepository('/workspace/repo-a', {}, {
      onDispose: () => trace.push('仓库 A 监听'),
    });
    const repositoryB = new TestRepository('/workspace/repo-b', {}, {
      onDispose: () => trace.push('仓库 B 监听'),
    });
    const gitApi = new TestGitApi([repositoryA], {
      opened: { onDispose: () => trace.push('打开监听') },
      closed: { onDispose: () => trace.push('关闭监听') },
    });
    const registry = new RepositoryRegistry(gitApi);

    gitApi.opened.fire(repositoryB);
    registry.dispose();

    expect(trace).toEqual([
      '仓库 B 监听',
      '关闭监听',
      '打开监听',
      '仓库 A 监听',
    ]);
    expect(repositoryA.changed.listenerCount()).toBe(0);
    expect(repositoryB.changed.listenerCount()).toBe(0);
    expect(gitApi.opened.listenerCount()).toBe(0);
    expect(gitApi.closed.listenerCount()).toBe(0);
  });

  it('同路径新仓库打开后忽略旧实例的乱序关闭事件', () => {
    const root = '/workspace/repo-a';
    const oldRepository = new TestRepository(root);
    const newRepository = new TestRepository(root);
    const gitApi = new TestGitApi([oldRepository]);
    const registry = new RepositoryRegistry(gitApi);

    gitApi.opened.fire(newRepository);
    gitApi.closed.fire(oldRepository);

    expect(registry.get(root)?.repository).toBe(newRepository);
    expect(registry.getViewModel(true).currentRepositoryId).toBe(root);
    expect(newRepository.changed.listenerCount()).toBe(1);

    registry.dispose();
    expect(newRepository.changed.listenerCount()).toBe(0);
  });

  it('关闭仓库监听首次释放失败时保留句柄供最终释放重试', () => {
    let disposeAttempts = 0;
    const repository = new TestRepository('/workspace/repo-a', {}, {
      beforeDispose: () => {
        disposeAttempts += 1;
        if (disposeAttempts === 1) {
          throw new Error('仓库监听首次释放失败');
        }
      },
    });
    const gitApi = new TestGitApi([repository]);
    const registry = new RepositoryRegistry(gitApi);

    expect(() => {
      gitApi.closed.fire(repository);
    }).toThrow(
      '仓库监听首次释放失败',
    );
    expect(registry.getViewModel(true).currentRepositoryId).toBe(
      '/workspace/repo-a',
    );
    expect(repository.changed.listenerCount()).toBe(1);

    registry.dispose();

    expect(disposeAttempts).toBe(2);
    expect(repository.changed.listenerCount()).toBe(0);
  });

  it('同路径替换监听首次释放失败时保留旧句柄供最终释放重试', () => {
    let disposeAttempts = 0;
    const oldRepository = new TestRepository('/workspace/repo-a', {}, {
      beforeDispose: () => {
        disposeAttempts += 1;
        if (disposeAttempts === 1) {
          throw new Error('旧仓库监听首次释放失败');
        }
      },
    });
    const newRepository = new TestRepository('/workspace/repo-a');
    const gitApi = new TestGitApi([oldRepository]);
    const registry = new RepositoryRegistry(gitApi);

    expect(() => {
      gitApi.opened.fire(newRepository);
    }).toThrow(
      '旧仓库监听首次释放失败',
    );
    expect(registry.getViewModel(true).currentRepositoryId).toBe(
      '/workspace/repo-a',
    );
    expect(oldRepository.changed.listenerCount()).toBe(1);
    expect(newRepository.changed.listenerCount()).toBe(0);

    registry.dispose();

    expect(disposeAttempts).toBe(2);
    expect(oldRepository.changed.listenerCount()).toBe(0);
  });

  it('同路径仓库关闭重开后拒绝旧版本提交请求', async () => {
    const root = '/workspace/repo-a';
    const oldRepository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const newRepository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service, gitApi, commit } = createService([oldRepository]);
    const oldVersion = service.getViewModel().version;

    gitApi.closed.fire(oldRepository);
    gitApi.opened.fire(newRepository);

    expect(service.getViewModel().version).toBeGreaterThan(oldVersion);
    await expect(service.commit({
      repositoryId: root,
      version: oldVersion,
      message: '旧请求',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');
    expect(commit).not.toHaveBeenCalled();
  });

  it('同路径仓库关闭重开后拒绝旧版本废纸篓请求', async () => {
    const root = '/workspace/repo-a';
    const oldRepository = new TestRepository(root, {
      untracked: [change(root, 'a.ts', 7)],
    });
    const newRepository = new TestRepository(root, {
      untracked: [change(root, 'a.ts', 7)],
    });
    const { service, gitApi, trash } = createService([oldRepository]);
    const oldVersion = service.getViewModel().version;

    gitApi.closed.fire(oldRepository);
    gitApi.opened.fire(newRepository);

    await expect(service.trash({
      repositoryId: root,
      version: oldVersion,
      fileIds: ['a.ts'],
    })).rejects.toThrow('仓库状态已变化，请刷新后重试');
    expect(trash).not.toHaveBeenCalled();
  });

  it('提交服务临界复核时拒绝已关闭重开的仓库 generation', async () => {
    const root = '/workspace/repo-a';
    const oldRepository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const newRepository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const lifecycle: { gitApi?: TestGitApi } = {};
    const commit = vi.fn(async (request: CommitRequest) => {
      lifecycle.gitApi?.closed.fire(oldRepository);
      lifecycle.gitApi?.opened.fire(newRepository);
      if (!await request.verifyVersion(request.expectedVersion)) {
        throw new Error('提交前版本复核失败');
      }
      return { commitHash: 'abc123', committedPaths: ['a.ts'] };
    });
    const created = createService([oldRepository], true, {
      commitService: { commit },
    });
    lifecycle.gitApi = created.gitApi;

    await expect(created.service.commit({
      repositoryId: root,
      version: 0,
      message: '旧 generation 请求',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('提交前版本复核失败');
    expect(created.service.getViewModel().version).toBe(1);
  });

  it('不同 wrapper 的关闭事件不会封存当前仓库 generation', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const closeWrapper = new TestRepository('/workspace/./repo-a');
    const lifecycle: { gitApi?: TestGitApi } = {};
    const commit = vi.fn(async (request: CommitRequest) => {
      lifecycle.gitApi?.closed.fire(closeWrapper);
      if (!await request.verifyVersion(request.expectedVersion)) {
        throw new Error('提交前版本复核失败');
      }
      return { commitHash: 'abc123', committedPaths: ['a.ts'] };
    });
    const created = createService([repository], true, {
      commitService: { commit },
    });
    lifecycle.gitApi = created.gitApi;

    await expect(created.service.commit({
      repositoryId: root,
      version: 0,
      message: '关闭前请求',
      selectedIds: ['a.ts'],
    })).resolves.toEqual({
      commitHash: 'abc123',
      committedPaths: ['a.ts'],
    });
    expect(repository.changed.listenerCount()).toBe(1);
    expect(created.service.getViewModel().currentRepositoryId).toBe(root);
  });

  it('存在冲突时在进入任一写服务前拒绝操作', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      merge: [change(root, 'a.ts', 18)],
    });
    const {
      service,
      commit,
      trash,
      remote,
      addRemote,
    } = createService([repository]);

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('存在冲突文件，不能执行写操作');
    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts'],
    })).rejects.toThrow('存在冲突文件，不能执行写操作');
    await expect(service.setRemoteUrl({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).rejects.toThrow('存在冲突文件，不能执行写操作');
    await expect(service.addRemote({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).rejects.toThrow('存在冲突文件，不能执行写操作');
    expect(commit).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
    expect(addRemote).not.toHaveBeenCalled();
  });

  it('未知仓库在进入提交服务前被拒绝', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service, commit } = createService([repository]);

    await expect(service.commit({
      repositoryId: '/workspace/unknown',
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('仓库不存在或已关闭');
    expect(commit).not.toHaveBeenCalled();
  });

  it('同仓库写锁占用时拒绝第二个写操作且不调用下游服务', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    let finishCommit: ((value: {
      readonly commitHash: string;
      readonly committedPaths: readonly string[];
    }) => void) | undefined;
    const pendingCommit = new Promise<{
      readonly commitHash: string;
      readonly committedPaths: readonly string[];
    }>((resolveCommit) => {
      finishCommit = resolveCommit;
    });
    const commit = vi.fn().mockReturnValue(pendingCommit);
    const { service, trash } = createService([repository], true, {
      commitService: { commit },
    });

    const firstWrite = service.commit({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    });
    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts'],
    })).rejects.toThrow('仓库正在执行写操作');
    expect(trash).not.toHaveBeenCalled();

    finishCommit?.({ commitHash: 'abc123', committedPaths: ['a.ts'] });
    await expect(firstWrite).resolves.toMatchObject({ commitHash: 'abc123' });
  });

  it('延迟提交期间重复提交只调用一次下游且运行态保持到完成', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    let finishCommit: ((value: {
      readonly commitHash: string;
      readonly committedPaths: readonly string[];
    }) => void) | undefined;
    const commit = vi.fn().mockReturnValue(new Promise((resolveCommit) => {
      finishCommit = resolveCommit;
    }));
    const { service } = createService([repository], true, {
      commitService: { commit },
    });
    const request = {
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    } as const;

    const first = service.commit(request);
    await expect(service.commit(request))
      .rejects.toThrow('仓库正在执行写操作');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(service.getViewModel().operation).toEqual({
      kind: 'running',
      action: 'commit',
    });
    expect(service.getViewModel().commitMessage).toBe('提交');

    finishCommit?.({
      commitHash: 'abc123',
      committedPaths: ['a.ts'],
    });
    await expect(first).resolves.toMatchObject({ commitHash: 'abc123' });
    expect(service.getViewModel().operation).toEqual({
      kind: 'commit-succeeded',
      commitHash: 'abc123',
    });
  });

  it('提交失败时不推送', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const commit = vi.fn().mockRejectedValue(new Error('提交失败'));
    const { service, push } = createService([repository], true, {
      commitService: { commit },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('提交失败');
    expect(push).not.toHaveBeenCalled();
  });

  it('提交并推送在待选远程前同步自身产生的仓库变化', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      commit: '111',
    });
    const commit = vi.fn().mockImplementation(() => {
      repository.setChanges({});
      repository.setHead({
        name: 'main',
        commit: '222',
      });
      return Promise.resolve({
        commitHash: 'abc123',
        committedPaths: ['a.ts'],
      });
    });
    const push = vi.fn()
      .mockResolvedValueOnce({
        kind: 'needs-remote',
        remotes: ['origin'],
      })
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'main',
      });
    const { service } = createService([repository], true, {
      commitService: { commit },
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '提交并等待远程',
      selectedIds: ['a.ts'],
    })).resolves.toMatchObject({ kind: 'needs-remote' });
    expect(service.getViewModel()).toMatchObject({
      version: 1,
      changes: [],
    });

    await expect(service.selectPushRemote({
      repositoryId: root,
      version: 1,
      remote: 'origin',
    })).resolves.toMatchObject({ kind: 'pushed' });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('游离 HEAD 的提交并推送在提交服务前被拒绝', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead(undefined);
    const { service, commit, push } = createService([repository]);

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '禁止的提交并推送',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('当前处于游离 HEAD，不能提交并推送');
    expect(commit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('游离 HEAD 仍允许普通本地提交', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead(undefined);
    const { service, commit, push } = createService([repository]);

    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '本地提交',
      selectedIds: ['a.ts'],
    })).resolves.toMatchObject({ commitHash: 'abc123' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('提交期间切到游离 HEAD 不创建可回退到当前分支的推送上下文', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const commit = vi.fn().mockImplementation(() => {
      repository.setHead(undefined);
      return Promise.resolve({
        commitHash: 'abc123',
        committedPaths: ['a.ts'],
      });
    });
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('当前处于游离 HEAD，不能提交并推送'))
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'other',
        branch: 'other',
      });
    const { service } = createService([repository], true, {
      commitService: { commit },
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '提交后变为游离',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('当前处于游离 HEAD，不能提交并推送');
    repository.setHead({
      name: 'other',
      upstream: { remote: 'other', name: 'other' },
    });
    repository.setRemotes([{
      name: 'other',
      pushUrl: 'https://example.test/other.git',
    }]);
    repository.changed.fire(undefined);

    await expect(service.retryPush({
      repositoryId: root,
      version: 2,
    })).rejects.toThrow('没有可重试的推送');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('空目标分支的旧式推送上下文不得回退当前 upstream', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: '' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/origin.git',
    }]);
    const { service, commit, push } = createService([repository]);

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '空目标边界',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('推送重试上下文缺少目标分支，请重新提交并推送');
    repository.setHead({
      name: 'other',
      upstream: { remote: 'other', name: 'other' },
    });
    repository.setRemotes([{
      name: 'other',
      pushUrl: 'https://example.test/other.git',
    }]);
    repository.changed.fire(undefined);

    await expect(service.retryPush({
      repositoryId: root,
      version: 1,
    })).rejects.toThrow('没有可重试的推送');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('废纸篓服务失败后记录可观察的操作状态', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      untracked: [change(root, 'a.ts', 7)],
    });
    const trash = vi.fn().mockRejectedValue(new Error('系统废纸篓不可用'));
    const { service } = createService([repository], true, {
      trashService: { moveToTrash: trash },
    });

    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts'],
    })).rejects.toThrow('系统废纸篓不可用');
    expect(service.getViewModel().operation).toEqual({
      kind: 'failed',
      action: 'trash',
      message: '系统废纸篓不可用',
    });
  });

  it('废纸篓部分成功时返回明细并记录失败摘要', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      untracked: [
        change(root, 'a.ts', 7),
        change(root, 'b.ts', 7),
      ],
    });
    const trashResult = {
      kind: 'completed',
      succeeded: ['a.ts'],
      failed: [{ path: 'b.ts', message: '权限不足' }],
    } as const;
    const trash = vi.fn().mockResolvedValue(trashResult);
    const { service } = createService([repository], true, {
      trashService: { moveToTrash: trash },
    });

    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts', 'b.ts'],
    })).resolves.toEqual(trashResult);
    expect(service.getViewModel().operation).toEqual({
      kind: 'failed',
      action: 'trash',
      message: '移入废纸篓部分失败：成功 1 个，失败 1 个',
    });
  });

  it('废纸篓全部失败时返回明细并记录失败摘要', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      untracked: [
        change(root, 'a.ts', 7),
        change(root, 'b.ts', 7),
      ],
    });
    const trashResult = {
      kind: 'completed',
      succeeded: [],
      failed: [
        { path: 'a.ts', message: '权限不足' },
        { path: 'b.ts', message: '文件占用' },
      ],
    } as const;
    const trash = vi.fn().mockResolvedValue(trashResult);
    const { service } = createService([repository], true, {
      trashService: { moveToTrash: trash },
    });

    await expect(service.trash({
      repositoryId: root,
      version: 0,
      fileIds: ['a.ts', 'b.ts'],
    })).resolves.toEqual(trashResult);
    expect(service.getViewModel().operation).toEqual({
      kind: 'failed',
      action: 'trash',
      message: '移入废纸篓失败：成功 0 个，失败 2 个',
    });
  });

  it('远程修改失败后记录可观察的操作状态', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    const remote = vi.fn().mockRejectedValue(new Error('远程写入失败'));
    const { service } = createService([repository], true, {
      remoteService: { setUrl: remote, add: vi.fn() },
    });

    await expect(service.setRemoteUrl({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).rejects.toThrow('远程写入失败');
    expect(service.getViewModel().operation).toEqual({
      kind: 'failed',
      action: 'remote',
      message: '远程写入失败',
    });
  });

  it('远程添加失败后记录可观察的操作状态', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    const addRemote = vi.fn().mockRejectedValue(new Error('远程添加失败'));
    const { service } = createService([repository], true, {
      remoteService: { setUrl: vi.fn(), add: addRemote },
    });

    await expect(service.addRemote({
      repositoryId: root,
      version: 0,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    })).rejects.toThrow('远程添加失败');
    expect(service.getViewModel().operation).toEqual({
      kind: 'failed',
      action: 'remote',
      message: '远程添加失败',
    });
  });

  it('推送失败保存提交哈希，重试时不重复提交', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'main',
      });
    const { service, commit } = createService([repository], true, {
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');
    expect(service.getViewModel().operation).toEqual({
      kind: 'push-failed',
      commitHash: 'abc123',
      message: '网络断开',
    });

    await expect(service.retryPush({
      repositoryId: root,
      version: 0,
    })).resolves.toEqual({
      kind: 'pushed',
      remote: 'origin',
      branch: 'main',
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('HEAD 和上游变化后重试仍推送原提交到原目标', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'release/main' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/original.git',
    }]);
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'release/main',
      });
    const { service, commit } = createService([repository], true, {
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');

    repository.setHead({
      name: 'other',
      upstream: { remote: 'backup', name: 'other-target' },
    });
    repository.setRemotes([
      {
        name: 'origin',
        pushUrl: 'https://example.test/original.git',
      },
      {
        name: 'backup',
        pushUrl: 'https://example.test/backup.git',
      },
    ]);
    repository.changed.fire(undefined);

    await expect(service.retryPush({
      repositoryId: root,
      version: 1,
    })).resolves.toEqual({
      kind: 'pushed',
      remote: 'origin',
      branch: 'release/main',
    });
    const expectedPushRequest = {
      selectedRemote: 'origin',
      localBranch: 'main',
      exactRefspec: {
        sourceRef: 'abc123',
        targetBranch: 'release/main',
      },
    };
    expect(push).toHaveBeenNthCalledWith(
      1,
      repository,
      expectedPushRequest,
    );
    expect(push).toHaveBeenNthCalledWith(
      2,
      repository,
      expectedPushRequest,
    );
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('目标远程 URL 变化后拒绝重试原推送', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/original.git',
    }]);
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'main',
      });
    const { service, commit } = createService([repository], true, {
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/replaced.git',
    }]);
    repository.changed.fire(undefined);

    await expect(service.retryPush({
      repositoryId: root,
      version: 1,
    })).rejects.toThrow('推送目标远程已变化，请重新提交并推送');
    expect(push).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('普通提交成功后失效旧推送重试上下文', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/original.git',
    }]);
    const commit = vi.fn()
      .mockResolvedValueOnce({
        commitHash: 'old123',
        committedPaths: ['a.ts'],
      })
      .mockResolvedValueOnce({
        commitHash: 'new456',
        committedPaths: ['a.ts'],
      });
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'main',
      });
    const { service } = createService([repository], true, {
      commitService: { commit },
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '旧提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');
    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '新提交',
      selectedIds: ['a.ts'],
    })).resolves.toMatchObject({ commitHash: 'new456' });

    await expect(service.retryPush({
      repositoryId: root,
      version: 0,
    })).rejects.toThrow('没有可重试的推送');
    expect(commit).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('明确开始新的提交操作即失效旧推送重试上下文', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    repository.setHead({
      name: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });
    repository.setRemotes([{
      name: 'origin',
      pushUrl: 'https://example.test/original.git',
    }]);
    const commit = vi.fn()
      .mockResolvedValueOnce({
        commitHash: 'old123',
        committedPaths: ['a.ts'],
      })
      .mockRejectedValueOnce(new Error('新提交失败'));
    const push = vi.fn()
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce({
        kind: 'pushed',
        remote: 'origin',
        branch: 'main',
      });
    const { service } = createService([repository], true, {
      commitService: { commit },
      pushService: { push },
    });

    await expect(service.commitAndPush({
      repositoryId: root,
      version: 0,
      message: '旧提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('网络断开');
    await expect(service.commit({
      repositoryId: root,
      version: 0,
      message: '新提交',
      selectedIds: ['a.ts'],
    })).rejects.toThrow('新提交失败');

    await expect(service.retryPush({
      repositoryId: root,
      version: 0,
    })).rejects.toThrow('没有可重试的推送');
    expect(commit).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
