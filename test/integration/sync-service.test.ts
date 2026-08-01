import type * as vscode from 'vscode';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuiltinRepository } from '../../src/git/builtin-git-api.js';
import { SyncService } from '../../src/services/sync-service.js';
import {
  createTestRepository,
  type TestRepository,
} from '../helpers/git-repository.js';

describe('真实仓库远程同步', () => {
  const repositories: TestRepository[] = [];

  afterEach(async () => {
    await Promise.all(repositories.splice(0).map(async (repository) => {
      await repository.dispose();
    }));
  });

  it('一次推送当前分支全部未同步提交', async () => {
    const local = await createTestRepository();
    const remote = await createTestRepository();
    repositories.push(local, remote);
    await remote.git('config', 'receive.denyCurrentBranch', 'updateInstead');
    await local.write('file.txt', '0\n');
    await local.git('add', '--', 'file.txt');
    await local.git('commit', '-m', '测试：初始提交');
    await local.git('remote', 'add', 'origin', remote.root);
    await local.git('push', '--set-upstream', 'origin', 'main');
    for (let index = 1; index <= 3; index += 1) {
      await local.write('file.txt', `${String(index)}\n`);
      await local.git('add', '--', 'file.txt');
      await local.git('commit', '-m', `测试：本地提交 ${String(index)}`);
    }
    const repository: BuiltinRepository = {
      rootUri: { fsPath: local.root } as vscode.Uri,
      state: {
        HEAD: {
          name: 'main',
          upstream: { remote: 'origin', name: 'main' },
        },
        remotes: [{ name: 'origin' }],
        indexChanges: [],
        workingTreeChanges: [],
        untrackedChanges: [],
        mergeChanges: [],
        onDidChange: () => ({ dispose: () => undefined }),
      },
      status: () => Promise.resolve(),
      fetch: async () => {
        await local.git('fetch');
      },
      pull: async () => {
        await local.git('pull');
      },
      push: async (remoteName, branchName, setUpstream) => {
        await local.git(
          'push',
          ...(setUpstream === true ? ['--set-upstream'] : []),
          remoteName ?? 'origin',
          branchName ?? 'main',
        );
      },
      setBranchUpstream: () => Promise.resolve(),
    };

    await new SyncService().pushAll(repository, {
      localBranch: 'main',
      ahead: 3,
      behind: 0,
    });

    expect(await remote.git('rev-parse', 'HEAD')).toBe(
      await local.git('rev-parse', 'HEAD'),
    );
  });
});
