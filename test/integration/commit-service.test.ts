import { access, chmod, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/domain/change-model.js';
import { GitRunner } from '../../src/git/git-runner.js';
import type {
  GitMachineOutput,
  GitResult,
} from '../../src/git/git-types.js';
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
    if (args[1] === 'add') {
      return Promise.reject(new Error('准备索引失败'));
    }
    if (args[1] === 'rm') {
      return Promise.reject(new Error('恢复索引失败'));
    }
    return Promise.reject(new Error(`未预期的 Git 命令：${String(args[0])}`));
  }
}

class InconsistentScopeGitRunner extends GitRunner {
  override run(): Promise<GitResult> {
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }

  override runForMachineParsing(
    _repositoryRoot: string,
    args: readonly string[],
  ): Promise<GitMachineOutput> {
    if (args[0] === 'rev-parse') {
      return Promise.resolve({ rawStdout: `${'a'.repeat(40)}\n` });
    }
    if (args[0] === 'diff-tree') {
      return Promise.resolve({
        rawStdout:
          'M\u0000https://alice:secret@example.com/a?token=raw123\u0000',
      });
    }
    return Promise.reject(new Error(`未预期的 Git 命令：${String(args[0])}`));
  }
}

class InspectingMessageGitRunner extends GitRunner {
  messageFile: string | undefined;
  messageFileMode: number | undefined;

  override async run(
    _repositoryRoot: string,
    args: readonly string[],
  ): Promise<GitResult> {
    const fileOptionIndex = args.indexOf('--file');
    const messageFile = args[fileOptionIndex + 1];
    if (fileOptionIndex < 0 || messageFile === undefined) {
      throw new Error('提交命令缺少消息文件');
    }
    this.messageFile = messageFile;
    this.messageFileMode = (await stat(messageFile)).mode & 0o777;
    throw new Error('模拟提交失败');
  }
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(async (repository) => {
    await repository.dispose();
  }));
});

describe('CommitService', () => {
  it('在没有父提交的仓库中创建只包含所选路径的根提交', async () => {
    const repo = await createRepository();
    await repo.write('root-selected.txt', '根提交\n');
    await repo.write('root-unselected.txt', '保持未跟踪\n');

    const service = new CommitService(new GitRunner());
    const result = await service.commit({
      repositoryRoot: repo.root,
      message: '创建根提交',
      expectedVersion: 1,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('root-selected.txt', {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })],
    });

    expect(result.commitHash).toBe(await repo.git('rev-parse', 'HEAD'));
    expect(await repo.git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(await repo.status()).toBe('?? root-unselected.txt');
  });

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

  it('重命名提交严格包含旧路径和新路径', async () => {
    const repo = await createRepository();
    await repo.write('旧名称.txt', '保持内容\n');
    await repo.git('add', '旧名称.txt');
    await repo.git('commit', '-m', '初始提交');
    await repo.git('mv', '旧名称.txt', '新名称.txt');

    const service = new CommitService(new GitRunner());
    const result = await service.commit({
      repositoryRoot: repo.root,
      message: '提交重命名',
      expectedVersion: 4,
      verifyVersion: () => Promise.resolve(true),
      files: [{
        ...fileChange('新名称.txt'),
        originalPath: '旧名称.txt',
        kind: 'renamed',
        staged: true,
        unstaged: false,
        commitPaths: ['旧名称.txt', '新名称.txt'],
      }],
    });

    expect(result.committedPaths).toEqual(['新名称.txt', '旧名称.txt']);
    expect((await repo.git(
      '-c',
      'core.quotePath=false',
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      'HEAD',
    )).split('\u0000').filter(Boolean).sort()).toEqual(
      ['新名称.txt', '旧名称.txt'].sort(),
    );
  });

  it('选中文件同时含暂存和未暂存修改时提交工作区最终内容', async () => {
    const repo = await createRepository();
    await repo.write('both.txt', '初始\n');
    await repo.git('add', 'both.txt');
    await repo.git('commit', '-m', '初始提交');
    await repo.write('both.txt', '暂存版本\n');
    await repo.git('add', 'both.txt');
    await repo.write('both.txt', '工作区最终版本\n');

    const service = new CommitService(new GitRunner());
    await service.commit({
      repositoryRoot: repo.root,
      message: '提交最终内容',
      expectedVersion: 5,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('both.txt', {
        staged: true,
        unstaged: true,
      })],
    });

    expect(await repo.git('show', 'HEAD:both.txt')).toBe('工作区最终版本');
    expect(await repo.status()).toBe('');
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

  it.each([
    ['星号', '*.txt', 'unselected.txt'],
    ['问号', 'chosen?.txt', 'chosen1.txt'],
    ['方括号', 'chosen[1].txt', 'chosen1.txt'],
    ['pathspec magic', ':(glob)chosen?.md', 'chosen1.md'],
  ])('把%s文件名作为字面量且不匹配其他文件', async (
    _caseName,
    selectedPath,
    unselectedPath,
  ) => {
    const repo = await createRepository();
    await repo.write('anchor.bin', '初始\n');
    await repo.git('add', 'anchor.bin');
    await repo.git('commit', '-m', '初始提交');
    await repo.write(selectedPath, '选择字面文件名\n');
    await repo.write(unselectedPath, '保持未跟踪\n');

    const service = new CommitService(new GitRunner());
    const result = await service.commit({
      repositoryRoot: repo.root,
      message: '提交字面 pathspec 文件名',
      expectedVersion: 6,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange(selectedPath, {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })],
    });

    expect(result.committedPaths).toEqual([selectedPath]);
    expect((await repo.git(
      '-c',
      'core.quotePath=false',
      'ls-tree',
      '--name-only',
      '-z',
      'HEAD',
    )).split('\u0000').filter(Boolean).sort()).toEqual(
      [selectedPath, 'anchor.bin'].sort(),
    );
    expect(await repo.status()).toBe(`?? ${unselectedPath}`);
  });

  it('通配符提交被钩子拒绝后不从索引移除匹配的未选跟踪文件', async () => {
    const repo = await createRepository();
    await repo.write('unselected.txt', '保持跟踪\n');
    await repo.git('add', 'unselected.txt');
    await repo.git('commit', '-m', '初始提交');
    await repo.write('*.txt', '选择字面星号\n');
    await repo.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 23\n');
    await chmod(`${repo.root}/.git/hooks/pre-commit`, 0o700);

    const service = new CommitService(new GitRunner());
    await expect(service.commit({
      repositoryRoot: repo.root,
      message: '钩子将拒绝通配符文件',
      expectedVersion: 7,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('*.txt', {
        kind: 'untracked',
        unstaged: false,
        untracked: true,
      })],
    })).rejects.toThrow();

    expect(await repo.git('ls-files')).toBe('unselected.txt');
    expect(await repo.status()).toBe('?? *.txt');
  });

  it('主提交错误与索引清理错误同时保留在顶层错误中', async () => {
    const service = new CommitService(new FailingCleanupGitRunner());
    const failure = await service.commit({
      repositoryRoot: '/不会执行真实命令',
      message: '验证错误合并',
      expectedVersion: 8,
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

  it('实际提交范围与选择不一致时停止并报告两组路径', async () => {
    const service = new CommitService(new InconsistentScopeGitRunner());
    const expectedPath =
      'https://bob:password@example.com/b?access_token=expected456';

    await expect(service.commit({
      repositoryRoot: '/不会执行真实命令',
      message: '核对提交范围',
      expectedVersion: 9,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange(expectedPath)],
    })).rejects.toThrow(
      '提交路径核对失败：'
      + '预期 ["https://***:***@example.com/b?access_token=***"]，'
      + '实际 ["https://***:***@example.com/a?token=***"]',
    );
  });

  it('消息文件权限为 0600 且提交失败后删除临时目录', async () => {
    const runner = new InspectingMessageGitRunner();
    const service = new CommitService(runner);

    await expect(service.commit({
      repositoryRoot: '/不会执行真实命令',
      message: '检查消息文件',
      expectedVersion: 10,
      verifyVersion: () => Promise.resolve(true),
      files: [fileChange('selected.txt')],
    })).rejects.toThrow('模拟提交失败');

    expect(runner.messageFileMode).toBe(0o600);
    expect(runner.messageFile).toBeDefined();
    await expect(access(dirname(runner.messageFile ?? ''))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
