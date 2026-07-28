import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

interface FileState {
  readonly id: string;
  readonly path: string;
  readonly untracked: boolean;
}

interface RepositoryState {
  readonly version: number;
  readonly currentRepositoryId?: string;
  readonly repositories: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly changes: readonly FileState[];
  readonly selectedIds: readonly string[];
  readonly operation: {
    readonly kind: string;
    readonly commitHash?: string;
  };
}

interface RawGitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly workingTreeChanges: readonly {
      readonly uri: vscode.Uri;
      readonly status: number;
    }[];
  };
}

interface RawGitApi {
  readonly repositories: readonly RawGitRepository[];
}

interface RawGitExports {
  getAPI(version: 1): RawGitApi;
}

async function waitForState(
  predicate: (state: RepositoryState) => boolean,
): Promise<RepositoryState> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await vscode.commands.executeCommand<RepositoryState>(
      'gitool.test.getState',
    );
    if (predicate(state)) {
      return state;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('等待 Gitool 双仓库状态超时');
}

async function git(
  repositoryRoot: string,
  args: readonly string[],
): Promise<string> {
  const result = await execFileAsync('git', args, { cwd: repositoryRoot });
  return result.stdout.trim();
}

suite('Gitool 扩展', () => {
  test('可以激活并注册刷新命令', async () => {
    const extension = vscode.extensions.getExtension(
      'xbyzzz.gitool-file-commit',
    );
    assert.ok(extension, '扩展应存在');

    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('gitool.refresh'),
      '激活后应注册刷新命令',
    );
  });

  test('真实双仓库默认选择安全且刷新后保持', async () => {
    const extension = vscode.extensions.getExtension(
      'xbyzzz.gitool-file-commit',
    );
    assert.ok(extension, '扩展应存在');
    await extension.activate();

    const initial = await waitForState(
      (state) => state.repositories.length === 2
        && state.changes.some((change) => change.path === 'tracked.txt')
        && state.changes.some((change) => change.path === 'untracked.txt'),
    );
    assert.deepEqual(
      [...initial.repositories.map((repository) => repository.label)].sort(),
      ['repo-a', 'repo-b'],
      '仓库选择器状态应包含两个仓库',
    );
    assert.ok(initial.currentRepositoryId, '应且仅应有一个当前仓库');

    const gitExtension = vscode.extensions.getExtension<RawGitExports>(
      'vscode.git',
    );
    assert.ok(gitExtension, '内置 Git 扩展应存在');
    const gitApi = (await gitExtension.activate()).getAPI(1);
    const rawRepository = gitApi.repositories.find(
      (repository) => repository.rootUri.fsPath === initial.currentRepositoryId,
    );
    assert.ok(rawRepository, '内置 Git API 应包含当前仓库');
    const rawUntracked = rawRepository.state.workingTreeChanges.find(
      (change) => change.uri.fsPath.endsWith('/untracked.txt'),
    );
    assert.ok(rawUntracked, '内置 Git API 应在工作区变更列表返回未跟踪文件');
    assert.equal(
      rawUntracked.status,
      7,
      '内置 Git API 的未跟踪状态字面值应为 7',
    );

    const tracked = initial.changes.find(
      (change) => change.path === 'tracked.txt',
    );
    const untracked = initial.changes.find(
      (change) => change.path === 'untracked.txt',
    );
    assert.ok(tracked, '应发现已跟踪变更');
    assert.ok(untracked, '应发现未跟踪变更');
    assert.ok(initial.selectedIds.includes(tracked.id), '已跟踪文件应默认选中');
    assert.ok(
      !initial.selectedIds.includes(untracked.id),
      `未跟踪文件应默认不选中：${JSON.stringify({
        untracked,
        selectedIds: initial.selectedIds,
      })}`,
    );

    const refreshed = await vscode.commands.executeCommand<RepositoryState>(
      'gitool.test.refresh',
    );
    assert.ok(refreshed, '刷新应返回仓库状态');
    assert.ok(
      !refreshed.selectedIds.includes(untracked.id),
      '刷新后未跟踪文件仍应保持未选中',
    );
  });

  test('真实仓库完成精确提交、上游推送、远程修改和失败重试', async () => {
    let state = await waitForState(
      (candidate) => candidate.repositories.length === 2
        && candidate.changes.some((change) => change.path === 'tracked.txt'),
    );
    const repositoryA = state.repositories.find(
      (repository) => repository.label === 'repo-a',
    );
    assert.ok(repositoryA, '应存在 repo-a');
    if (state.currentRepositoryId !== repositoryA.id) {
      state = await vscode.commands.executeCommand<RepositoryState>(
        'gitool.test.selectRepository',
        repositoryA.id,
      );
    }

    const preserved = state.changes.find(
      (change) => change.path === 'preserved.txt',
    );
    const tracked = state.changes.find(
      (change) => change.path === 'tracked.txt',
    );
    assert.ok(preserved, '应发现待保留的暂存文件');
    assert.ok(tracked, '应发现待提交的已跟踪文件');
    await vscode.commands.executeCommand(
      'gitool.test.setFileSelected',
      preserved.id,
      false,
    );
    await vscode.commands.executeCommand(
      'gitool.test.commit',
      '测试：只提交已跟踪文件',
    );
    assert.equal(
      await git(repositoryA.id, ['diff', '--cached', '--name-only']),
      'preserved.txt',
      '未选择的暂存文件应继续留在暂存区',
    );

    state = await vscode.commands.executeCommand<RepositoryState>(
      'gitool.test.refresh',
    );
    const untracked = state.changes.find(
      (change) => change.path === 'untracked.txt',
    );
    assert.ok(untracked, '第一次提交后未跟踪文件应仍存在');
    await vscode.commands.executeCommand(
      'gitool.test.setFileSelected',
      untracked.id,
      true,
    );
    await vscode.commands.executeCommand(
      'gitool.test.commit',
      '测试：提交未跟踪文件',
    );
    assert.equal(
      await git(repositoryA.id, ['show', '--format=', '--name-only', 'HEAD']),
      'untracked.txt',
      '第二次提交应只包含所选未跟踪文件',
    );

    await writeFile(
      join(repositoryA.id, 'tracked.txt'),
      '用于首次推送\n',
      'utf8',
    );
    await vscode.commands.executeCommand('gitool.test.refresh');
    const needsRemote = await vscode.commands.executeCommand<{
      readonly kind: string;
      readonly remotes: readonly string[];
    }>('gitool.test.commitAndPush', '测试：建立上游');
    assert.deepEqual(needsRemote, {
      kind: 'needs-remote',
      remotes: ['origin'],
    });
    await vscode.commands.executeCommand(
      'gitool.test.selectPushRemote',
      'origin',
    );
    assert.equal(
      await git(repositoryA.id, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      ]),
      'origin/main',
      '首次推送应建立同名上游',
    );

    const fixtureRoot = dirname(repositoryA.id);
    const secondRemote = join(fixtureRoot, 'remote-second.git');
    await vscode.commands.executeCommand(
      'gitool.test.setRemoteUrl',
      'origin',
      secondRemote,
    );
    assert.equal(
      await git(repositoryA.id, ['remote', 'get-url', 'origin']),
      secondRemote,
      '远程 URL 应修改为第二个裸远程',
    );

    const retryRemote = join(fixtureRoot, 'retry-remote.git');
    await vscode.commands.executeCommand(
      'gitool.test.setRemoteUrl',
      'origin',
      retryRemote,
    );
    await writeFile(
      join(repositoryA.id, 'tracked.txt'),
      '用于失败后重试\n',
      'utf8',
    );
    await vscode.commands.executeCommand('gitool.test.refresh');
    await assert.rejects(
      async () => await vscode.commands.executeCommand(
        'gitool.test.commitAndPush',
        '测试：推送失败后重试',
      ),
      /Git 命令失败|repository|仓库/u,
    );
    state = await vscode.commands.executeCommand<RepositoryState>(
      'gitool.test.getState',
    );
    assert.equal(state.operation.kind, 'push-failed');
    assert.ok(state.operation.commitHash, '失败状态应包含已创建提交哈希');
    const failedCommit = state.operation.commitHash;
    const commitCountBeforeRetry = await git(repositoryA.id, [
      'rev-list',
      '--count',
      'HEAD',
    ]);

    await mkdir(retryRemote, { recursive: true });
    await git(retryRemote, ['init', '--bare']);
    await vscode.commands.executeCommand('gitool.test.retryPush');
    assert.equal(
      await git(repositoryA.id, ['rev-list', '--count', 'HEAD']),
      commitCountBeforeRetry,
      '重试推送不得创建重复提交',
    );
    assert.equal(
      await git(retryRemote, ['rev-parse', 'refs/heads/main']),
      failedCommit,
      '重试应把失败状态记录的精确提交推送到远程',
    );
  });
});
