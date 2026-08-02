import * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import { redactSensitiveText } from '../git/git-runner.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import type { RepositoryService } from '../services/repository-service.js';
import type { ChangeFileNode } from './change-tree-provider.js';
import type { HistoryFileNode } from './history-tree-provider.js';

export interface GitoolViewActionsDependencies {
  readonly repositoryService: RepositoryService;
  readonly gitApi: BuiltinGitApi;
}

interface CurrentScope {
  readonly repositoryId: string;
  readonly version: number;
  readonly model: RepositoryViewModel;
}

interface RemotePickItem extends vscode.QuickPickItem {
  readonly remoteName: string;
}

function isChangeFileNodeArray(
  value: ChangeFileNode | readonly ChangeFileNode[],
): value is readonly ChangeFileNode[] {
  return Array.isArray(value);
}

export class ReportedViewActionError extends Error {
  override readonly name = 'ReportedViewActionError';
}

export function isReportedViewActionError(
  error: unknown,
): error is ReportedViewActionError {
  return error instanceof ReportedViewActionError;
}

export class GitoolViewActions {
  constructor(private readonly dependencies: GitoolViewActionsDependencies) {}

  async refreshChanges(): Promise<void> {
    await this.runAction('刷新当前变更', async () => {
      await this.dependencies.repositoryService.refresh();
    });
  }

  async openChange(node: ChangeFileNode): Promise<void> {
    await this.runAction('打开变更', async (scope) => {
      const change = this.requireCurrentChange(scope, node);
      const repository = this.dependencies.repositoryService.getRepository(
        scope.repositoryId,
      );
      if (repository === undefined) {
        throw new Error('当前仓库不存在或已关闭');
      }

      const fileUri = vscode.Uri.joinPath(repository.rootUri, change.path);
      if (change.untracked) {
        await vscode.window.showTextDocument(fileUri, { preview: true });
        return;
      }
      if (change.kind === 'deleted') {
        await vscode.window.showTextDocument(
          this.dependencies.gitApi.toGitUri(fileUri, 'HEAD'),
          { preview: true },
        );
        return;
      }

      const originalUri = change.originalPath === undefined
        ? fileUri
        : vscode.Uri.joinPath(repository.rootUri, change.originalPath);
      await vscode.commands.executeCommand(
        'vscode.diff',
        this.dependencies.gitApi.toGitUri(originalUri, 'HEAD'),
        fileUri,
        this.diffTitle(change),
      );
    });
  }

  async trashUntracked(
    node?: ChangeFileNode | readonly ChangeFileNode[],
  ): Promise<void> {
    await this.runAction('舍弃未跟踪文件', async (scope) => {
      const selectedIds = new Set(scope.model.selectedIds);
      const nodes = node === undefined
        ? undefined
        : isChangeFileNodeArray(node) ? node : [node];
      const changes = nodes === undefined
        ? scope.model.changes.filter(
            (change) => change.untracked && selectedIds.has(change.id),
          )
        : nodes.map((item) => this.requireCurrentChange(scope, item)).filter(
            (change) => change.untracked && selectedIds.has(change.id),
          );
      if (changes.length === 0) {
        throw new Error('没有已选择的未跟踪文件');
      }
      const repository = this.dependencies.repositoryService.getRepository(
        scope.repositoryId,
      );
      if (repository === undefined) {
        throw new Error('当前仓库不存在或已关闭');
      }
      for (const change of changes) {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(repository.rootUri, change.path),
        );
        if ((stat.type & vscode.FileType.Directory) !== 0) {
          throw new Error('不能通过此操作舍弃目录');
        }
      }
      await this.dependencies.repositoryService.trash({
        repositoryId: scope.repositoryId,
        version: scope.version,
        fileIds: changes.map((change) => change.id),
      });
      await this.dependencies.repositoryService.refresh();
    });
  }

  async editRemote(): Promise<void> {
    await this.runAction('修改远程 URL', async (scope) => {
      const service = this.dependencies.repositoryService;
      const repository = service.getRepository(scope.repositoryId);
      if (repository === undefined) {
        throw new Error('当前仓库不存在或已关闭');
      }
      if (repository.state.remotes.length === 0) {
        await this.addRemote(scope);
        return;
      }

      const remote = await vscode.window.showQuickPick<RemotePickItem>(
        repository.state.remotes.map((item) => ({
          label: item.name,
          description: redactSensitiveText(
            item.fetchUrl ?? item.pushUrl ?? '未配置 URL',
          ),
          remoteName: item.name,
        })),
        {
          placeHolder: '选择要修改 URL 的现有远程',
          title: 'Gitool：修改远程 URL',
        },
      );
      if (remote === undefined) {
        return;
      }

      const selectedRemote = repository.state.remotes.find(
        (item) => item.name === remote.remoteName,
      );
      if (selectedRemote === undefined) {
        throw new Error('所选远程已不存在');
      }
      const currentUrl = selectedRemote.fetchUrl ?? '';
      const redactedCurrentUrl = redactSensitiveText(currentUrl);
      const containsCredential = currentUrl !== redactedCurrentUrl;
      const url = await vscode.window.showInputBox({
        title: `Gitool：修改远程 ${selectedRemote.name}`,
        prompt: containsCredential
          ? '当前 URL 含凭据，已禁止自动回填；请输入完整的新 URL'
          : '请输入新的 fetch URL',
        value: containsCredential ? '' : currentUrl,
        ...(containsCredential ? { placeHolder: redactedCurrentUrl } : {}),
        ignoreFocusOut: true,
        validateInput: (value) => value.trim().length === 0
          ? '远程 URL 不能为空'
          : undefined,
      });
      if (url === undefined) {
        return;
      }
      const normalizedUrl = url.trim();
      const confirmed = await vscode.window.showWarningMessage(
        `确认修改远程 ${selectedRemote.name} 的 URL？`,
        {
          modal: true,
          detail: `新 URL：${redactSensitiveText(normalizedUrl)}`,
        },
        '确认修改',
      );
      if (confirmed !== '确认修改') {
        return;
      }

      await service.setRemoteUrl({
        repositoryId: scope.repositoryId,
        version: scope.version,
        remote: selectedRemote.name,
        url: normalizedUrl,
      });
      await service.refresh();
    });
  }

  async pull(): Promise<void> {
    await this.runAction('从远程拉取', async (scope) => {
      await this.dependencies.repositoryService.pull({
        repositoryId: scope.repositoryId,
        version: scope.version,
      });
    });
  }

  async pushAll(): Promise<void> {
    await this.runAction('推送全部本地提交', async (scope) => {
      const service = this.dependencies.repositoryService;
      const result = await service.pushAll({
        repositoryId: scope.repositoryId,
        version: scope.version,
      });
      if (result.kind !== 'needs-remote') {
        return;
      }
      const selected = await vscode.window.showQuickPick(
        result.remotes.map((remote) => ({ label: remote, remote })),
        {
          placeHolder: '选择用于推送全部本地提交并建立上游的远程',
          title: 'Gitool：推送全部本地提交',
        },
      );
      if (selected === undefined) {
        return;
      }
      const latest = this.currentScope();
      if (latest.repositoryId !== scope.repositoryId) {
        throw new Error('推送期间当前仓库已变化');
      }
      await service.pushAll({
        repositoryId: latest.repositoryId,
        version: latest.version,
        selectedRemote: selected.remote,
      });
    });
  }

  async refreshHistory(): Promise<void> {
    await this.runAction('刷新提交历史', async (scope) => {
      await this.dependencies.repositoryService.refreshHistory({
        repositoryId: scope.repositoryId,
        version: scope.version,
      });
    });
  }

  async openHistoryDiff(node: HistoryFileNode): Promise<void> {
    await this.runAction('打开历史改动', async (scope) => {
      if (node.repositoryId !== scope.repositoryId) {
        throw new Error('节点来源仓库与当前仓库不一致');
      }
      if (node.version !== scope.version) {
        throw new Error('仓库状态已变化，请刷新后重试');
      }
      if (!scope.model.history.commits.some(
        (commit) => commit.hash === node.hash,
      )) {
        throw new Error('所选历史提交已不在当前列表中');
      }
      const service = this.dependencies.repositoryService;
      const repository = service.getRepository(scope.repositoryId);
      if (repository === undefined) {
        throw new Error('当前仓库不存在或已关闭');
      }
      const details = await service.loadCommitDetails({
        repositoryId: scope.repositoryId,
        version: scope.version,
        hash: node.hash,
      });
      if (details.hash !== node.hash) {
        throw new Error('提交详情与所选历史提交不一致');
      }
      const file = details.files.find((item) =>
        item.path === node.file.path
        && item.status === node.file.status
        && item.originalPath === node.file.originalPath);
      if (file === undefined) {
        throw new Error('文件不属于所选历史提交');
      }
      const originalPath = file.originalPath ?? file.path;
      const leftFile = vscode.Uri.joinPath(repository.rootUri, originalPath);
      const rightFile = vscode.Uri.joinPath(repository.rootUri, file.path);
      const emptyUri = vscode.Uri.from({
        scheme: 'gitool-empty',
        path: `/${details.hash}/${file.path}`,
      });
      const leftUri = file.status.startsWith('A')
        ? emptyUri
        : this.dependencies.gitApi.toGitUri(
            leftFile,
            details.parentHash ?? details.hash,
          );
      const rightUri = file.status.startsWith('D')
        ? emptyUri
        : this.dependencies.gitApi.toGitUri(rightFile, details.hash);
      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
        rightUri,
        `${file.originalPath === undefined ? file.path : `${file.originalPath} → ${file.path}`}（历史提交 ${details.hash.slice(0, 7)}）`,
      );
    });
  }

  private async addRemote(scope: CurrentScope): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: 'Gitool：添加远程 origin',
      prompt: '请输入完整的远程仓库 URL',
      value: '',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim().length === 0
        ? '远程 URL 不能为空'
        : undefined,
    });
    if (url === undefined) {
      return;
    }
    const normalizedUrl = url.trim();
    const confirmed = await vscode.window.showWarningMessage(
      '确认添加远程 origin？',
      {
        modal: true,
        detail: `远程 URL：${redactSensitiveText(normalizedUrl)}`,
      },
      '确认添加',
    );
    if (confirmed !== '确认添加') {
      return;
    }

    await this.dependencies.repositoryService.addRemote({
      repositoryId: scope.repositoryId,
      version: scope.version,
      remote: 'origin',
      url: normalizedUrl,
    });
    await this.dependencies.repositoryService.refresh();
  }

  private requireCurrentChange(
    scope: CurrentScope,
    node: ChangeFileNode,
  ): FileChange {
    if (node.repositoryId !== scope.repositoryId) {
      throw new Error('节点来源仓库与当前仓库不一致');
    }
    const current = scope.model.changes.find(
      (change) => change.id === node.change.id,
    );
    if (current === undefined || current !== node.change) {
      throw new Error('文件不属于当前仓库状态');
    }
    return current;
  }

  private diffTitle(change: FileChange): string {
    return change.originalPath === undefined
      ? `${change.path}（工作区 ↔ HEAD）`
      : `${change.originalPath} → ${change.path}（工作区 ↔ HEAD）`;
  }

  private currentScope(): CurrentScope {
    const model = this.dependencies.repositoryService.getViewModel();
    if (model.currentRepositoryId === undefined) {
      throw new Error('当前没有打开的 Git 仓库');
    }
    return {
      repositoryId: model.currentRepositoryId,
      version: model.version,
      model,
    };
  }

  private async runAction(
    action: string,
    operation: (scope: CurrentScope) => Promise<void>,
  ): Promise<void> {
    let initialScope: CurrentScope | undefined;
    try {
      initialScope = this.currentScope();
      await operation(initialScope);
    } catch (error) {
      const message = redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      );
      const service = this.dependencies.repositoryService;
      const currentModel = service.getViewModel();
      const sameRepository = initialScope !== undefined
        && currentModel.currentRepositoryId === initialScope.repositoryId;
      if (sameRepository && currentModel.operation.kind === 'running') {
        throw new ReportedViewActionError(message);
      }
      if (
        !sameRepository
        || !service.reportFailure(action, message)
      ) {
        await vscode.window.showErrorMessage(`Gitool：${message}`);
      }
      throw new ReportedViewActionError(message);
    }
  }
}

export function registerViewCommands(
  actions: GitoolViewActions,
): readonly vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  try {
    disposables.push(vscode.commands.registerCommand(
      'gitool.editRemote',
      async () => {
        await actions.editRemote();
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.refreshChanges',
      async () => {
        await actions.refreshChanges();
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.trashUntracked',
      async (node?: ChangeFileNode) => {
        await actions.trashUntracked(node);
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.openChange',
      async (node: ChangeFileNode) => {
        await actions.openChange(node);
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.pull',
      async () => {
        await actions.pull();
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.pushAll',
      async () => {
        await actions.pushAll();
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.refreshHistory',
      async () => {
        await actions.refreshHistory();
      },
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.openHistoryDiff',
      async (node: HistoryFileNode) => {
        await actions.openHistoryDiff(node);
      },
    ));
    return disposables;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const disposable of disposables.reverse()) {
      try {
        disposable.dispose();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        '注册 Gitool View 命令失败，且资源清理失败',
      );
    }
    throw error;
  }
}
