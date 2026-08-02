import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinGitApi } from '../../src/git/builtin-git-api.js';
import type { RepositoryService } from '../../src/services/repository-service.js';
import type { ChangeFileNode } from '../../src/views/change-tree-provider.js';

const vscodeMocks = vi.hoisted(() => ({
  activeCommands: new Map<string, (...args: readonly unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  registerCommand: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showTextDocument: vi.fn(),
  showWarningMessage: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeMocks.executeCommand,
    registerCommand: vscodeMocks.registerCommand,
  },
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

import {
  GitoolViewActions,
  registerViewCommands,
} from '../../src/views/view-actions.js';

function uri(path: string): vscode.Uri {
  return { fsPath: path, path, toString: () => `file://${path}` } as vscode.Uri;
}

function model(
  overrides: Partial<RepositoryViewModel> = {},
): RepositoryViewModel {
  return {
    version: 7,
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
      id: 'src/job.py',
      path: 'src/job.py',
      kind: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['src/job.py'],
    }, {
      id: '.serena/project.yml',
      path: '.serena/project.yml',
      kind: 'untracked',
      staged: false,
      unstaged: false,
      untracked: true,
      conflicted: false,
      commitPaths: ['.serena/project.yml'],
    }],
    changeCount: 2,
    selectedIds: ['src/job.py', '.serena/project.yml'],
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
    ...overrides,
  };
}

function fileNode(fileId = 'src/job.py'): ChangeFileNode {
  const current = model().changes.find((change) => change.id === fileId);
  if (current === undefined) {
    throw new Error('测试文件不存在');
  }
  return {
    kind: 'file',
    repositoryId: '/workspace/repo',
    section: current.untracked ? 'untracked' : 'tracked',
    change: current,
  };
}

function createHarness(initial = model()) {
  const getViewModel = vi.fn().mockReturnValue(initial);
  const getFileChange = vi.fn((repositoryId: string, fileId: string) => (
    repositoryId === initial.currentRepositoryId
      ? initial.changes.find((change) => change.id === fileId)
      : undefined
  ));
  const repository = {
    rootUri: uri('/workspace/repo'),
    state: { remotes: [] },
  };
  const refresh = vi.fn().mockResolvedValue(initial);
  const trash = vi.fn().mockResolvedValue({
    kind: 'completed', succeeded: [], failed: [],
  });
  const setRemoteUrl = vi.fn();
  const addRemote = vi.fn();
  const pull = vi.fn();
  const pushAll = vi.fn().mockResolvedValue({
    kind: 'pushed', remote: 'origin', branch: 'main',
  });
  const refreshHistory = vi.fn();
  const reportFailure = vi.fn().mockReturnValue(true);
  const service = {
    getViewModel,
    getRepository: vi.fn().mockReturnValue(repository),
    getFileChange,
    refresh,
    trash,
    setRemoteUrl,
    addRemote,
    pull,
    pushAll,
    refreshHistory,
    reportFailure,
  } as unknown as RepositoryService;
  const gitApi = {
    toGitUri: vi.fn((value: vscode.Uri, ref: string) => ({
      fsPath: value.fsPath,
      path: value.path,
      scheme: 'git',
      query: ref,
      toString: () => `git:${value.path}?${ref}`,
    } as vscode.Uri)),
  } as unknown as BuiltinGitApi;
  return {
    actions: new GitoolViewActions({ service, gitApi }),
    service,
    gitApi,
    refresh,
    trash,
    setRemoteUrl,
    addRemote,
    pull,
    pushAll,
    refreshHistory,
    reportFailure,
  };
}

describe('原生视图操作', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMocks.activeCommands.clear();
    vscodeMocks.registerCommand.mockImplementation(
      (id: string, handler: (...args: readonly unknown[]) => unknown) => {
        vscodeMocks.activeCommands.set(id, handler);
        return { dispose: () => vscodeMocks.activeCommands.delete(id) };
      },
    );
    vscodeMocks.stat.mockResolvedValue({ type: 1 });
  });

  it('打开原生文件节点对应的当前差异', async () => {
    const { actions } = createHarness();

    await actions.openChange(fileNode());

    expect(vscodeMocks.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'git', query: 'HEAD' }),
      expect.objectContaining({ path: '/workspace/repo/src/job.py' }),
      'src/job.py（工作区 ↔ HEAD）',
    );
  });

  it('垃圾桶只处理当前已选择的未跟踪文件', async () => {
    const { actions, trash, refresh } = createHarness();

    await actions.trashUntracked(fileNode('.serena/project.yml'));

    expect(trash).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
      fileIds: ['.serena/project.yml'],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('拒绝通过垃圾桶舍弃目录', async () => {
    const { actions, trash } = createHarness();
    vscodeMocks.stat.mockResolvedValue({ type: 2 });

    await expect(actions.trashUntracked(fileNode('.serena/project.yml')))
      .rejects.toThrow('不能通过此操作舍弃目录');
    expect(trash).not.toHaveBeenCalled();
  });

  it('无远程时通过设置按钮添加 origin', async () => {
    const { actions, addRemote, refresh } = createHarness();
    vscodeMocks.showInputBox.mockResolvedValue('https://example.test/repo.git');
    vscodeMocks.showWarningMessage.mockResolvedValue('确认添加');

    await actions.editRemote();

    expect(addRemote).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
      remote: 'origin',
      url: 'https://example.test/repo.git',
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('推送缺少上游时遵循用户选择的远程', async () => {
    const { actions, pushAll } = createHarness();
    pushAll
      .mockResolvedValueOnce({ kind: 'needs-remote', remotes: ['origin'] })
      .mockResolvedValueOnce({
        kind: 'pushed', remote: 'origin', branch: 'main',
      });
    vscodeMocks.showQuickPick.mockResolvedValue({
      label: 'origin', remote: 'origin',
    });

    await actions.pushAll();

    expect(pushAll).toHaveBeenNthCalledWith(1, {
      repositoryId: '/workspace/repo', version: 7,
    });
    expect(pushAll).toHaveBeenNthCalledWith(2, {
      repositoryId: '/workspace/repo', version: 7, selectedRemote: 'origin',
    });
  });

  it('注册并释放七个原生视图命令', () => {
    const { actions } = createHarness();

    const registrations = registerViewCommands(actions);

    expect([...vscodeMocks.activeCommands.keys()]).toEqual([
      'gitool.editRemote',
      'gitool.refreshChanges',
      'gitool.trashUntracked',
      'gitool.openChange',
      'gitool.pull',
      'gitool.pushAll',
      'gitool.refreshHistory',
    ]);
    registrations.forEach((item) => {
      item.dispose();
    });
    expect([...vscodeMocks.activeCommands.keys()]).toEqual([]);
  });
});
