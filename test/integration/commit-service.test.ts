import { chmod } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/domain/change-model.js';
import { GitRunner } from '../../src/git/git-runner.js';
import type { GitResult } from '../../src/git/git-types.js';
import { CommitService } from '../../src/services/commit-service.js';
import {
  createTestRepository,
  type TestRepository,
} from '../helpers/git-repository.js';

const repositories: TestRepository[] = [];

async function createRepository(): Promise<TestRepository> {
  const repository = await createTestRepository();
  repositories.push(repository);
  return repository;
}

function fileChange(
  path: string,
  overrides: Partial<FileChange> = {},
): FileChange {
  return {
    id: path,
    path,
    kind: 'modified',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    commitPaths: [path],
    ...overrides,
  };
}

class FailingCleanupGitRunner extends GitRunner {
  override run(
    _repositoryRoot: string,
    args: readonly string[],
  ): Promise<GitResult> {
    if (args[0] === 'add') {
      return Promise.reject(new Error('准备索引失败'));
    }
    if (args[0] === 'rm') {
      return Promise.reject(new Error('恢复索引失败'));
    }
    return Promise.reject(new Error(`未预期的 Git 命令：${String(args[0])}`));
  }
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(async (repository) => {
    await repository.dispose();
  }));
});

describe('CommitService', () => {
  it('只提交所选文件并保留未选文件的暂存内容', async () => {
    const repo = await createRepository();
    await repo.write('selected.txt', '初始\n');
    await repo.write('staged.txt', '初始\n');
    await repo.git('add', '.');
    await repo.git('commit', '-m', '初始提交');

    await repo.write('selected.txt', '本次提交\n');
    await repo.write('staged.txt', '保留暂存\n');
    await repo.git('add', 'staged.txt');

    const service = new CommitService(new GitRunner());
    const result = await service.commit({
      repositoryRoot: repo.root,
      message: '只提交选择项',
      expectedVersion: 1,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('selected.txt')],
    });

    expect(result.committedPaths).toEqual(['selected.txt']);
    expect(await repo.git('show', 'HEAD:selected.txt')).toBe('本次提交');
    expect(await repo.git('diff', '--cached', '--name-only')).toBe('staged.txt');
  });

  it('提交选中的未跟踪文件并保留未选中的未跟踪状态', async () => {
    const repo = await createRepository();
    await repo.write('tracked.txt', '初始\n');
    await repo.git('add', '.');
    await repo.git('commit', '-m', '初始提交');
    await repo.write('selected-new.txt', '选中\n');
    await repo.write('unselected-new.txt', '未选中\n');

    const service = new CommitService(new GitRunner());
    await service.commit({
      repositoryRoot: repo.root,
      message: '提交选中的未跟踪文件',
      expectedVersion: 2,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('selected-new.txt', {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })],
    });

    expect(await repo.git('show', 'HEAD:selected-new.txt')).toBe('选中');
    expect(await repo.status()).toBe('?? unselected-new.txt');
  });

  it('提交钩子拒绝后恢复选中文件的未跟踪状态和内容', async () => {
    const repo = await createRepository();
    await repo.write('tracked.txt', '初始\n');
    await repo.git('add', '.');
    await repo.git('commit', '-m', '初始提交');
    await repo.write('selected-new.txt', '必须保留\n');
    const contentHashBefore = await repo.git('hash-object', 'selected-new.txt');
    await repo.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 23\n');
    await chmod(`${repo.root}/.git/hooks/pre-commit`, 0o700);

    const service = new CommitService(new GitRunner());
    await expect(service.commit({
      repositoryRoot: repo.root,
      message: '钩子将拒绝',
      expectedVersion: 3,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('selected-new.txt', {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })],
    })).rejects.toThrow();

    expect(await repo.status()).toBe('?? selected-new.txt');
    expect(await repo.git('hash-object', 'selected-new.txt')).toBe(contentHashBefore);
  });

  it('安全提交包含空格、中文和短横线开头的文件名', async () => {
    const repo = await createRepository();
    await repo.write('tracked.txt', '初始\n');
    await repo.git('add', '.');
    await repo.git('commit', '-m', '初始提交');
    const paths = ['含 空格.txt', '中文.txt', '-危险参数.txt'];
    for (const path of paths) {
      await repo.write(path, `${path}\n`);
    }

    const service = new CommitService(new GitRunner());
    const result = await service.commit({
      repositoryRoot: repo.root,
      message: '提交特殊文件名',
      expectedVersion: 4,
      verifyVersion: () => Promise.resolve(true),
      files: paths.map((path) => fileChange(path, {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })),
    });

    expect(result.committedPaths).toEqual(
      ['-危险参数.txt', '中文.txt', '含 空格.txt'],
    );
    const committedPaths = await repo.git(
      '-c',
      'core.quotePath=false',
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      'HEAD',
    );
    expect(committedPaths.split('\u0000').filter(Boolean)).toEqual(
      ['-危险参数.txt', '中文.txt', '含 空格.txt'],
    );
  });

  it('主提交错误与索引清理错误同时保留在顶层错误中', async () => {
    const service = new CommitService(new FailingCleanupGitRunner());
    const failure = await service.commit({
      repositoryRoot: '/不会执行真实命令',
      message: '验证错误合并',
      expectedVersion: 5,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('selected-new.txt', {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })],
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toContain('准备索引失败');
    expect((failure as AggregateError).message).toContain('恢复索引失败');
  });
});
