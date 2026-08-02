import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import type { BuiltinGitApi } from '../../src/git/builtin-git-api.js';
import type { RepositoryService } from '../../src/services/repository-service.js';
import type { ChangeFileNode } from '../../src/views/change-tree-provider.js';
import type { HistoryFileNode } from '../../src/views/history-tree-provider.js';

const vscodeMocks = vi.hoisted(() => ({
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
    from: (components: { readonly scheme: string; readonly path: string }) => ({
      scheme: components.scheme,
      path: components.path,
      fsPath: components.path,
      toString: () => `${components.scheme}:${components.path}`,
    }),
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
  return {
    fsPath: path,
    path,
    toString(): string {
      return `file://${path}`;
    },
  } as vscode.Uri;
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
      id: '.serena/project.yml',
      path: '.serena/project.yml',
      kind: 'untracked',
      staged: false,
      unstaged: true,
      untracked: true,
      conflicted: false,
      commitPaths: ['.serena/project.yml'],
    }, {
      id: 'src/tracked.ts',
      path: 'src/tracked.ts',
      kind: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['src/tracked.ts'],
    }],
    changeCount: 2,
    selectedIds: ['.serena/project.yml', 'src/tracked.ts'],
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
    ...overrides,
  };
}

function changeAt(value: RepositoryViewModel, index: number) {
  const change = value.changes[index];
  if (change === undefined) {
    throw new Error(`测试变更索引 ${String(index)} 不存在`);
  }
  return change;
}

function createActions(initialModel = model()) {
  const getViewModel = vi.fn().mockReturnValue(initialModel);
  const getRepository = vi.fn().mockReturnValue({
    rootUri: uri('/workspace/repo'),
    state: {
      HEAD: { name: 'main', commit: 'head-1' },
      remotes: [],
    },
  });
  const getFileChange = vi.fn((repositoryId: string, fileId: string) =>
    repositoryId === initialModel.currentRepositoryId
      ? initialModel.changes.find((change) => change.id === fileId)
      : undefined);
  const reportFailure = vi.fn().mockReturnValue(true);
  const refresh = vi.fn();
  const trash = vi.fn();
  const setRemoteUrl = vi.fn();
  const addRemote = vi.fn();
  const refreshHistory = vi.fn();
  const pull = vi.fn();
  const pushAll = vi.fn();
  const loadCommitDetails = vi.fn();
  const service = {
    getViewModel,
    getRepository,
    getFileChange,
    reportFailure,
    refresh,
    trash,
    setRemoteUrl,
    addRemote,
    refreshHistory,
    pull,
    pushAll,
    loadCommitDetails,
  } as unknown as RepositoryService;
  const toGitUri = vi.fn((value: vscode.Uri) => value);
  const gitApi = {
    toGitUri,
  } as unknown as BuiltinGitApi;
  return {
    actions: new GitoolViewActions({
      repositoryService: service,
      gitApi,
    }),
    service,
    getViewModel,
    getRepository,
    getFileChange,
    reportFailure,
    refresh,
    trash,
    setRemoteUrl,
    addRemote,
    refreshHistory,
    pull,
    pushAll,
    loadCommitDetails,
    gitApi,
    toGitUri,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vscodeMocks.stat.mockResolvedValue({ type: 1 });
});

describe('GitoolViewActions', () => {
  it('垃圾桶命令只提交当前快照中已选择的具体未跟踪文件', async () => {
    const { actions, trash } = createActions();

    await actions.trashUntracked();

    expect(trash).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
      fileIds: ['.serena/project.yml'],
    });
  });

  it('没有选中的未跟踪文件时给出明确错误且不调用服务', async () => {
    const { actions, trash } = createActions(model({
      selectedIds: ['src/tracked.ts'],
    }));

    await expect(actions.trashUntracked())
      .rejects.toThrow('没有已选择的未跟踪文件');
    expect(trash).not.toHaveBeenCalled();
  });

  it('垃圾桶命令拒绝旧仓库节点且不调用服务', async () => {
    const currentModel = model();
    const { actions, trash } = createActions(currentModel);
    const node: ChangeFileNode = {
      kind: 'file',
      repositoryId: '/workspace/other',
      version: 7,
      change: changeAt(currentModel, 0),
    };

    await expect(actions.trashUntracked(node))
      .rejects.toThrow('节点来源仓库与当前仓库不一致');
    expect(trash).not.toHaveBeenCalled();
  });

  it('旧 Webview 传入多个节点时只舍弃消息明确指定的文件', async () => {
    const first = changeAt(model(), 0);
    const second = {
      ...first,
      id: 'notes/todo.md',
      path: 'notes/todo.md',
      commitPaths: ['notes/todo.md'],
    };
    const currentModel = model({
      changes: [first, second],
      selectedIds: [first.id, second.id],
    });
    const { actions, trash } = createActions(currentModel);

    await actions.trashUntracked([{
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 7,
      change: first,
    }]);

    expect(trash).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
      fileIds: ['.serena/project.yml'],
    });
  });

  it('打开变更时拒绝已经被新快照替换的同路径节点', async () => {
    const currentModel = model();
    const staleChange = { ...changeAt(currentModel, 1) };
    const { actions } = createActions(currentModel);
    const node: ChangeFileNode = {
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 7,
      change: staleChange,
    };

    await expect(actions.openChange(node))
      .rejects.toThrow('文件不属于当前仓库状态');
    expect(vscodeMocks.executeCommand).not.toHaveBeenCalled();
    expect(vscodeMocks.showTextDocument).not.toHaveBeenCalled();
  });

  it('打开已跟踪变更时对当前节点执行 HEAD 差异', async () => {
    const currentModel = model();
    const { actions, toGitUri } = createActions(currentModel);
    const node: ChangeFileNode = {
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 7,
      change: changeAt(currentModel, 1),
    };

    await actions.openChange(node);

    expect(toGitUri).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/repo/src/tracked.ts' }),
      'HEAD',
    );
    expect(vscodeMocks.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.any(Object),
      expect.objectContaining({ path: '/workspace/repo/src/tracked.ts' }),
      'src/tracked.ts（工作区 ↔ HEAD）',
    );
  });

  it('远程 URL 含凭据时只展示遮蔽值且不回填敏感原文', async () => {
    const created = createActions();
    created.getRepository.mockReturnValue({
      rootUri: uri('/workspace/repo'),
      state: {
        remotes: [{
          name: 'origin',
          fetchUrl: 'https://user:secret@example.test/repo.git',
        }],
      },
    });
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    vscodeMocks.showInputBox.mockResolvedValue(undefined);

    await created.actions.editRemote();

    expect(vscodeMocks.showQuickPick).toHaveBeenCalledWith(
      [expect.objectContaining({
        description: 'https://***:***@example.test/repo.git',
        remoteName: 'origin',
      })],
      expect.any(Object),
    );
    expect(vscodeMocks.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '',
        placeHolder: 'https://***:***@example.test/repo.git',
      }),
    );
    expect(JSON.stringify(vscodeMocks.showQuickPick.mock.calls))
      .not.toContain('user:secret');
    expect(JSON.stringify(vscodeMocks.showInputBox.mock.calls))
      .not.toContain('user:secret');
    expect(created.setRemoteUrl).not.toHaveBeenCalled();
  });

  it('没有远程时经二次确认添加 origin 且确认信息经过脱敏', async () => {
    const created = createActions();
    const sensitiveUrl = 'https://user:secret@example.test/repo.git';
    vscodeMocks.showInputBox.mockResolvedValue(sensitiveUrl);
    vscodeMocks.showWarningMessage.mockResolvedValue('确认添加');

    await created.actions.editRemote();

    expect(created.addRemote).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
      remote: 'origin',
      url: sensitiveUrl,
    });
    expect(JSON.stringify(vscodeMocks.showWarningMessage.mock.calls))
      .not.toContain('user:secret');
    expect(JSON.stringify(vscodeMocks.showWarningMessage.mock.calls))
      .toContain('https://***:***@example.test/repo.git');
  });

  it('添加远程输入期间切换仓库后拒绝写入', async () => {
    const created = createActions();
    vscodeMocks.showInputBox.mockImplementation(() => {
      created.getViewModel.mockReturnValue(model({
        currentRepositoryId: '/workspace/other',
      }));
      return Promise.resolve('https://example.test/repo.git');
    });

    await expect(created.actions.editRemote())
      .rejects.toThrow('添加远程期间仓库状态已变化，请重试');

    expect(vscodeMocks.showWarningMessage).not.toHaveBeenCalled();
    expect(created.addRemote).not.toHaveBeenCalled();
  });

  it('修改远程输入期间远程身份变化后拒绝写入', async () => {
    const created = createActions();
    const repository = {
      rootUri: uri('/workspace/repo'),
      state: {
        HEAD: { name: 'main', commit: 'head-1' },
        remotes: [{
          name: 'origin',
          fetchUrl: 'https://example.test/old.git',
          pushUrl: 'https://example.test/old.git',
        }],
      },
    };
    created.getRepository.mockReturnValue(repository);
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );
    vscodeMocks.showInputBox.mockImplementation(() => {
      repository.state.remotes = [{
        name: 'origin',
        fetchUrl: 'https://example.test/changed.git',
        pushUrl: 'https://example.test/changed.git',
      }];
      return Promise.resolve('https://example.test/new.git');
    });

    await expect(created.actions.editRemote())
      .rejects.toThrow('修改远程期间仓库状态已变化，请重试');

    expect(vscodeMocks.showWarningMessage).not.toHaveBeenCalled();
    expect(created.setRemoteUrl).not.toHaveBeenCalled();
  });

  it('推送全部在无上游时拒绝采用交互期间出现的新版本', async () => {
    const created = createActions();
    created.pushAll
      .mockResolvedValueOnce({ kind: 'needs-remote', remotes: ['origin'] });
    created.getViewModel
      .mockReturnValueOnce(model())
      .mockReturnValue(model({ version: 8 }));
    vscodeMocks.showQuickPick.mockImplementation(
      (items: readonly unknown[]) => Promise.resolve(items[0]),
    );

    await expect(created.actions.pushAll())
      .rejects.toThrow('推送期间仓库状态已变化，请重试');

    expect(created.pushAll).toHaveBeenNthCalledWith(1, {
      repositoryId: '/workspace/repo',
      version: 7,
    });
    expect(created.pushAll).toHaveBeenCalledOnce();
  });

  it('推送远程选择期间分支和 HEAD 变化后拒绝继续', async () => {
    const created = createActions();
    const repository = {
      rootUri: uri('/workspace/repo'),
      state: {
        HEAD: { name: 'main', commit: 'head-1' },
        remotes: [{ name: 'origin', fetchUrl: 'https://example.test/repo.git' }],
      },
    };
    created.getRepository.mockReturnValue(repository);
    created.pushAll.mockResolvedValueOnce({
      kind: 'needs-remote',
      remotes: ['origin'],
    });
    vscodeMocks.showQuickPick.mockImplementation((
      items: readonly unknown[],
    ) => {
      repository.state.HEAD = { name: 'feature', commit: 'head-2' };
      created.getViewModel.mockReturnValue(model({ branch: 'feature' }));
      return Promise.resolve(items[0]);
    });

    await expect(created.actions.pushAll())
      .rejects.toThrow('推送期间仓库状态已变化，请重试');

    expect(created.pushAll).toHaveBeenCalledOnce();
  });

  it('推送远程选择期间远程身份变化后拒绝继续', async () => {
    const created = createActions();
    const repository = {
      rootUri: uri('/workspace/repo'),
      state: {
        HEAD: { name: 'main', commit: 'head-1' },
        remotes: [{ name: 'origin', fetchUrl: 'https://example.test/old.git' }],
      },
    };
    created.getRepository.mockReturnValue(repository);
    created.pushAll.mockResolvedValueOnce({
      kind: 'needs-remote',
      remotes: ['origin'],
    });
    vscodeMocks.showQuickPick.mockImplementation((
      items: readonly unknown[],
    ) => {
      repository.state.remotes = [{
        name: 'origin',
        fetchUrl: 'https://example.test/changed.git',
      }];
      return Promise.resolve(items[0]);
    });

    await expect(created.actions.pushAll())
      .rejects.toThrow('推送期间仓库状态已变化，请重试');

    expect(created.pushAll).toHaveBeenCalledOnce();
  });

  it('刷新、拉取和历史刷新都绑定动作开始时的当前范围', async () => {
    const created = createActions();

    await created.actions.refreshChanges();
    await created.actions.pull();
    await created.actions.refreshHistory();

    expect(created.refresh).toHaveBeenCalledOnce();
    expect(created.pull).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
    });
    expect(created.refreshHistory).toHaveBeenCalledWith({
      repositoryId: '/workspace/repo',
      version: 7,
    });
  });

  it('历史差异拒绝旧版本节点且不读取提交详情', async () => {
    const created = createActions();
    const node: HistoryFileNode = {
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 6,
      hash: 'a'.repeat(40),
      file: { status: 'M', path: 'src/client.ts' },
    };

    await expect(created.actions.openHistoryDiff(node))
      .rejects.toThrow('仓库状态已变化，请刷新后重试');
    expect(created.loadCommitDetails).not.toHaveBeenCalled();
  });

  it('同版本历史列表刷新后拒绝已经消失的旧提交节点', async () => {
    const oldHash = 'a'.repeat(40);
    const currentHash = 'c'.repeat(40);
    const created = createActions(model({
      history: {
        kind: 'ready',
        commits: [{
          hash: currentHash,
          shortHash: currentHash.slice(0, 7),
          parents: [],
          author: '测试用户',
          authoredAt: '2026-08-02T08:00:00.000Z',
          subject: '当前提交',
          refs: [],
          lane: 0,
          parentLanes: [],
        }],
      },
    }));
    created.loadCommitDetails.mockResolvedValue({
      hash: oldHash,
      files: [{ status: 'M', path: 'src/old.ts' }],
    });
    const node: HistoryFileNode = {
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 7,
      hash: oldHash,
      file: { status: 'M', path: 'src/old.ts' },
    };

    await expect(created.actions.openHistoryDiff(node))
      .rejects.toThrow('所选历史提交已不在当前列表中');
    expect(created.loadCommitDetails).not.toHaveBeenCalled();
    expect(vscodeMocks.executeCommand).not.toHaveBeenCalled();
  });

  it('历史详情返回其他提交时拒绝打开差异', async () => {
    const selectedHash = 'a'.repeat(40);
    const otherHash = 'b'.repeat(40);
    const created = createActions(model({
      history: {
        kind: 'ready',
        commits: [{
          hash: selectedHash,
          shortHash: selectedHash.slice(0, 7),
          parents: [],
          author: '测试用户',
          authoredAt: '2026-08-02T08:00:00.000Z',
          subject: '所选提交',
          refs: [],
          lane: 0,
          parentLanes: [],
        }],
      },
    }));
    created.loadCommitDetails.mockResolvedValue({
      hash: otherHash,
      files: [{ status: 'M', path: 'src/client.ts' }],
    });
    const node: HistoryFileNode = {
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 7,
      hash: selectedHash,
      file: { status: 'M', path: 'src/client.ts' },
    };

    await expect(created.actions.openHistoryDiff(node))
      .rejects.toThrow('提交详情与所选历史提交不一致');
    expect(vscodeMocks.executeCommand).not.toHaveBeenCalled();
  });

  it('历史新增文件使用空文档作为父版本差异端点', async () => {
    const hash = 'a'.repeat(40);
    const created = createActions(model({
      history: {
        kind: 'ready',
        commits: [{
          hash,
          shortHash: hash.slice(0, 7),
          parents: [],
          author: '测试用户',
          authoredAt: '2026-08-02T08:00:00.000Z',
          subject: '新增文件',
          refs: [],
          lane: 0,
          parentLanes: [],
        }],
      },
    }));
    const file = { status: 'A', path: 'src/new.ts' };
    created.loadCommitDetails.mockResolvedValue({
      hash,
      parentHash: 'b'.repeat(40),
      files: [file],
    });
    const node: HistoryFileNode = {
      kind: 'file',
      repositoryId: '/workspace/repo',
      version: 7,
      hash,
      file,
    };

    await created.actions.openHistoryDiff(node);

    expect(vscodeMocks.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.objectContaining({ scheme: 'gitool-empty' }),
      expect.not.objectContaining({ scheme: 'gitool-empty' }),
      expect.stringContaining('历史提交'),
    );
  });

  it('动作失败先写入服务状态，服务拒绝时才显示脱敏错误', async () => {
    const created = createActions();
    created.refresh.mockRejectedValue(
      new Error('认证失败：https://user:secret@example.test/repo.git'),
    );
    created.reportFailure.mockReturnValue(false);

    await expect(created.actions.refreshChanges()).rejects.toThrow(
      '认证失败：https://***:***@example.test/repo.git',
    );

    expect(created.reportFailure).toHaveBeenCalledWith(
      '刷新当前变更',
      '认证失败：https://***:***@example.test/repo.git',
    );
    expect(vscodeMocks.showErrorMessage).toHaveBeenCalledWith(
      'Gitool：认证失败：https://***:***@example.test/repo.git',
    );
  });

  it('其他动作正在执行时失败不会覆盖 running 状态或重复弹错', async () => {
    const created = createActions(model({
      operation: { kind: 'running', action: 'commit' },
    }));
    created.refresh.mockRejectedValue(new Error('仓库正在执行写操作'));

    await expect(created.actions.refreshChanges())
      .rejects.toThrow('仓库正在执行写操作');

    expect(created.reportFailure).not.toHaveBeenCalled();
    expect(vscodeMocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it('动作期间从仓库 A 切到 B 后失败只显示脱敏错误且不写入 B', async () => {
    const repositoryA = model({ currentRepositoryId: '/workspace/repo-a' });
    const repositoryB = model({ currentRepositoryId: '/workspace/repo-b' });
    const created = createActions(repositoryA);
    created.pushAll.mockResolvedValue({
      kind: 'needs-remote',
      remotes: ['origin'],
    });
    vscodeMocks.showQuickPick.mockImplementation(() => {
      created.getViewModel.mockReturnValue(repositoryB);
      return Promise.reject(
        new Error('推送失败：https://user:secret@example.test/repo.git'),
      );
    });

    await expect(created.actions.pushAll()).rejects.toThrow(
      '推送失败：https://***:***@example.test/repo.git',
    );

    expect(created.reportFailure).not.toHaveBeenCalled();
    expect(vscodeMocks.showErrorMessage).toHaveBeenCalledWith(
      'Gitool：推送失败：https://***:***@example.test/repo.git',
    );
  });

  it('注册八个原生视图命令并在释放时全部注销', () => {
    const { actions } = createActions();
    const registeredIds: string[] = [];
    const activeIds: string[] = [];
    vscodeMocks.registerCommand.mockImplementation((id: string) => {
      registeredIds.push(id);
      activeIds.push(id);
      return {
        dispose: () => {
          const index = activeIds.indexOf(id);
          if (index >= 0) {
            activeIds.splice(index, 1);
          }
        },
      };
    });

    const registrations = registerViewCommands(actions);

    expect(registeredIds).toEqual([
      'gitool.editRemote',
      'gitool.refreshChanges',
      'gitool.trashUntracked',
      'gitool.openChange',
      'gitool.pull',
      'gitool.pushAll',
      'gitool.refreshHistory',
      'gitool.openHistoryDiff',
    ]);
    for (const item of [...registrations].reverse()) {
      item.dispose();
    }
    expect(activeIds).toHaveLength(0);
  });
});
