import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { BuiltinRepository } from '../../src/git/builtin-git-api.js';
import { SyncService } from '../../src/services/sync-service.js';

function repository(options: {
  readonly branch?: string;
  readonly upstream?: { readonly remote: string; readonly name: string };
  readonly remotes?: readonly string[];
} = {}): {
  readonly value: BuiltinRepository;
  readonly fetch: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly pull: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly push: ReturnType<typeof vi.fn<BuiltinRepository['push']>>;
} {
  const fetch = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const pull = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const push = vi.fn<BuiltinRepository['push']>(() => Promise.resolve());
  const value: BuiltinRepository = {
    rootUri: { fsPath: '/repo' } as vscode.Uri,
    state: {
      HEAD: {
        ...(options.branch === undefined ? {} : { name: options.branch }),
        ...(options.upstream === undefined
          ? {}
          : { upstream: options.upstream }),
      },
      remotes: (options.remotes ?? []).map((name) => ({ name })),
      indexChanges: [],
      workingTreeChanges: [],
      untrackedChanges: [],
      mergeChanges: [],
      onDidChange: () => ({ dispose: () => undefined }),
    },
    status: () => Promise.resolve(),
    fetch,
    pull,
    push,
    setBranchUpstream: () => Promise.resolve(),
  };
  return { value, fetch, pull, push };
}

describe('远程同步服务', () => {
  it('远程刷新只执行 fetch', async () => {
    const repo = repository({ branch: 'main' });

    await new SyncService().fetch(repo.value);

    expect(repo.fetch).toHaveBeenCalledOnce();
    expect(repo.pull).not.toHaveBeenCalled();
  });

  it('拉取不传 rebase 参数以遵循仓库配置', async () => {
    const repo = repository({
      branch: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });

    await new SyncService().pull(repo.value);

    expect(repo.pull).toHaveBeenCalledWith();
  });

  it('已有上游时推送当前分支全部领先提交', async () => {
    const repo = repository({
      branch: 'main',
      upstream: { remote: 'origin', name: 'main' },
      remotes: ['origin'],
    });

    const result = await new SyncService().pushAll(repo.value, {
      localBranch: 'main',
      ahead: 3,
      behind: 0,
    });

    expect(repo.push).toHaveBeenCalledWith('origin', 'main', false);
    expect(result).toEqual({ kind: 'pushed', remote: 'origin', branch: 'main' });
  });

  it('没有领先提交时拒绝无意义推送', async () => {
    const repo = repository({
      branch: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });

    await expect(new SyncService().pushAll(repo.value, {
      localBranch: 'main',
      ahead: 0,
      behind: 0,
    })).rejects.toThrow('没有待推送的本地提交');
    expect(repo.push).not.toHaveBeenCalled();
  });

  it('本地落后或分叉时拒绝非快进推送', async () => {
    const repo = repository({
      branch: 'main',
      upstream: { remote: 'origin', name: 'main' },
    });

    await expect(new SyncService().pushAll(repo.value, {
      localBranch: 'main',
      ahead: 2,
      behind: 1,
    })).rejects.toThrow('当前分支落后于上游，请先拉取并解决分歧');
    expect(repo.push).not.toHaveBeenCalled();
  });

  it('没有上游时返回已有远程供用户选择', async () => {
    const repo = repository({ branch: 'main', remotes: ['origin', 'backup'] });

    await expect(new SyncService().pushAll(repo.value, {
      localBranch: 'main',
      ahead: 2,
      behind: 0,
    })).resolves.toEqual({
      kind: 'needs-remote',
      remotes: ['origin', 'backup'],
    });
    expect(repo.push).not.toHaveBeenCalled();
  });

  it('选择远程后推送同名分支并建立上游', async () => {
    const repo = repository({ branch: 'main', remotes: ['origin'] });

    await new SyncService().pushAll(repo.value, {
      localBranch: 'main',
      ahead: 2,
      behind: 0,
      selectedRemote: 'origin',
    });

    expect(repo.push).toHaveBeenCalledWith('origin', 'main', true);
  });

  it('游离 HEAD 时拒绝拉取和推送', async () => {
    const repo = repository({ remotes: ['origin'] });
    const service = new SyncService();

    await expect(service.pull(repo.value)).rejects.toThrow('游离 HEAD');
    await expect(service.pushAll(repo.value, {
      localBranch: '',
      ahead: 1,
      behind: 0,
    })).rejects.toThrow('游离 HEAD');
  });
});
