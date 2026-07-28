import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { SelectionStore } from '../../src/domain/selection-store.js';
import type {
  BuiltinChange,
  BuiltinGitApi,
  BuiltinRepository,
} from '../../src/git/builtin-git-api.js';
import type { CommitRequest } from '../../src/services/commit-service.js';
import { RepositoryOperationLock } from '../../src/services/operation-lock.js';
import {
  RepositoryService,
  type RepositoryServiceDependencies,
} from '../../src/services/repository-service.js';

interface TestEvent<T> {
  readonly event: vscode.Event<T>;
  readonly fire: (value: T) => void;
  readonly listenerCount: () => number;
}

function createEvent<T>(): TestEvent<T> {
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
    listenerCount: () => listeners.size,
  };
}

function uri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

class TestRepository implements BuiltinRepository {
  readonly changed = createEvent<undefined>();
  readonly rootUri: vscode.Uri;
  readonly state: BuiltinRepository['state'];

  constructor(
    rootPath: string,
    changes: {
      readonly index?: readonly BuiltinChange[];
      readonly working?: readonly BuiltinChange[];
      readonly untracked?: readonly BuiltinChange[];
      readonly merge?: readonly BuiltinChange[];
    } = {},
  ) {
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
    return Promise.resolve();
  }

  push(): Promise<void> {
    return Promise.resolve();
  }
}

class TestGitApi implements BuiltinGitApi {
  readonly git = { path: '/usr/bin/git' };
  readonly opened = createEvent<BuiltinRepository>();
  readonly closed = createEvent<BuiltinRepository>();
  readonly onDidOpenRepository = this.opened.event;
  readonly onDidCloseRepository = this.closed.event;

  constructor(readonly repositories: readonly BuiltinRepository[]) {}

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
  const gitApi = new TestGitApi(repositories);
  const service = new RepositoryService({
    gitApi,
    selectionStore: new SelectionStore(),
    commitService: { commit },
    pushService: { push },
    trashService: { moveToTrash: trash },
    remoteService: { setUrl: remote },
    operationLock: new RepositoryOperationLock(),
    isWorkspaceTrusted: () => trusted,
    ...overrides,
  });
  return { service, commit, push, trash, remote, gitApi };
}

describe('RepositoryService', () => {
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

    repository.changed.fire(undefined);

    expect(service.getViewModel()).toMatchObject({
      version: 1,
      selectedIds: ['a.ts'],
    });
  });

  it('刷新引发状态事件时版本只递增一次', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    vi.spyOn(repository, 'status').mockImplementation(() => {
      repository.changed.fire(undefined);
      return Promise.resolve();
    });
    const { service } = createService([repository]);

    await expect(service.refresh()).resolves.toMatchObject({ version: 1 });
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

  it('旧版本提交请求在进入提交服务前被拒绝', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      working: [change(root, 'a.ts')],
    });
    const { service, commit } = createService([repository]);
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
    const { service, commit } = createService([repository], false);
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
    expect(commit).not.toHaveBeenCalled();
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

  it('存在冲突时在进入任一写服务前拒绝操作', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root, {
      merge: [change(root, 'a.ts', 18)],
    });
    const { service, commit, trash, remote } = createService([repository]);

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
    expect(commit).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
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

  it('远程修改失败后记录可观察的操作状态', async () => {
    const root = '/workspace/repo-a';
    const repository = new TestRepository(root);
    const remote = vi.fn().mockRejectedValue(new Error('远程写入失败'));
    const { service } = createService([repository], true, {
      remoteService: { setUrl: remote },
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
});
