import * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import { redactSensitiveText } from '../git/git-runner.js';
import type { RepositoryService } from '../services/repository-service.js';
import type { ChangeFileNode } from './change-tree-provider.js';

export interface GitoolViewActionsDependencies {
  readonly service: RepositoryService;
  readonly gitApi: BuiltinGitApi;
}

interface RemotePickItem extends vscode.QuickPickItem {
  readonly remoteName: string;
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(
    error instanceof Error ? error.message : String(error),
  );
}

export class GitoolViewActions {
  constructor(private readonly dependencies: GitoolViewActionsDependencies) {}

  async editRemote(): Promise<void> {
    const { repositoryId, version } = this.currentScope();
    const repository = this.dependencies.service.getRepository(repositoryId);
    if (repository === undefined) {
      throw new Error('当前仓库不存在或已关闭');
    }
    if (repository.state.remotes.length === 0) {
      await this.addRemote(repositoryId, version);
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

    await this.dependencies.service.setRemoteUrl({
      repositoryId,
      version,
      remote: selectedRemote.name,
      url: normalizedUrl,
    });
    await this.dependencies.service.refresh();
  }

  async refreshChanges(): Promise<void> {
    await this.dependencies.service.refresh();
  }

  async openChange(node: ChangeFileNode): Promise<void> {
    const { repositoryId } = this.currentScope();
    if (node.repositoryId !== repositoryId) {
      throw new Error('文件不属于当前仓库状态');
    }
    const service = this.dependencies.service;
    const repository = service.getRepository(repositoryId);
    const change = service.getFileChange(repositoryId, node.change.id);
    if (repository === undefined || change === undefined) {
      throw new Error('文件不属于当前仓库状态');
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
  }

  async trashUntracked(node?: ChangeFileNode): Promise<void> {
    const { repositoryId, version, model } = this.currentScope();
    const selectedIds = new Set(model.selectedIds);
    if (node !== undefined && (
      node.repositoryId !== repositoryId
      || !node.change.untracked
      || !selectedIds.has(node.change.id)
    )) {
      throw new Error('只能舍弃当前已选择的未跟踪文件');
    }
    const fileIds = model.changes
      .filter((change) => change.untracked && selectedIds.has(change.id))
      .map((change) => change.id);
    if (fileIds.length === 0) {
      throw new Error('至少选择一个未跟踪文件');
    }

    const service = this.dependencies.service;
    const repository = service.getRepository(repositoryId);
    if (repository === undefined) {
      throw new Error('当前仓库不存在或已关闭');
    }
    for (const fileId of fileIds) {
      const change = service.getFileChange(repositoryId, fileId);
      if (change?.untracked !== true) {
        throw new Error('只能舍弃当前已选择的未跟踪文件');
      }
      const stat = await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(repository.rootUri, change.path),
      );
      if ((stat.type & vscode.FileType.Directory) !== 0) {
        throw new Error('不能通过此操作舍弃目录');
      }
    }

    await service.trash({ repositoryId, version, fileIds });
    await service.refresh();
  }

  async pull(): Promise<void> {
    const { repositoryId, version } = this.currentScope();
    await this.dependencies.service.pull({ repositoryId, version });
  }

  async pushAll(): Promise<void> {
    const { repositoryId, version } = this.currentScope();
    const service = this.dependencies.service;
    const result = await service.pushAll({ repositoryId, version });
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
    const latest = this.currentScope(repositoryId);
    await service.pushAll({
      repositoryId,
      version: latest.version,
      selectedRemote: selected.remote,
    });
  }

  async refreshHistory(): Promise<void> {
    const { repositoryId, version } = this.currentScope();
    await this.dependencies.service.refreshHistory({ repositoryId, version });
  }

  reportFailure(action: string, error: unknown): void {
    const message = errorMessage(error);
    const model = this.dependencies.service.getViewModel();
    if (model.operation.kind === 'running') {
      return;
    }
    if (action === '推送' && model.operation.kind === 'push-failed') {
      return;
    }
    if (!this.dependencies.service.reportFailure(action, message)) {
      void vscode.window.showErrorMessage(`Gitool：${message}`);
    }
  }

  private currentScope(expectedRepositoryId?: string): {
    readonly repositoryId: string;
    readonly version: number;
    readonly model: RepositoryViewModel;
  } {
    const model = this.dependencies.service.getViewModel();
    const repositoryId = model.currentRepositoryId;
    if (repositoryId === undefined) {
      throw new Error('当前没有可操作的 Git 仓库');
    }
    if (expectedRepositoryId !== undefined
      && repositoryId !== expectedRepositoryId) {
      throw new Error('操作期间当前仓库已变化');
    }
    return { repositoryId, version: model.version, model };
  }

  private diffTitle(change: FileChange): string {
    return change.originalPath === undefined
      ? `${change.path}（工作区 ↔ HEAD）`
      : `${change.originalPath} → ${change.path}（工作区 ↔ HEAD）`;
  }

  private async addRemote(
    repositoryId: string,
    version: number,
  ): Promise<void> {
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
    await this.dependencies.service.addRemote({
      repositoryId,
      version,
      remote: 'origin',
      url: normalizedUrl,
    });
    await this.dependencies.service.refresh();
  }
}

export function registerViewCommands(
  actions: GitoolViewActions,
): readonly vscode.Disposable[] {
  const register = (
    id: string,
    action: string,
    run: (...args: readonly never[]) => Promise<void>,
  ): vscode.Disposable => vscode.commands.registerCommand(
    id,
    (...args: readonly never[]) => run(...args).catch((error: unknown) => {
      actions.reportFailure(action, error);
    }),
  );
  return [
    register('gitool.editRemote', '修改远程 URL', () => actions.editRemote()),
    register('gitool.refreshChanges', '刷新', () => actions.refreshChanges()),
    register(
      'gitool.trashUntracked',
      '舍弃未跟踪文件',
      (node: ChangeFileNode) => actions.trashUntracked(node),
    ),
    register(
      'gitool.openChange',
      '打开变更',
      (node: ChangeFileNode) => actions.openChange(node),
    ),
    register('gitool.pull', '从远程拉取', () => actions.pull()),
    register('gitool.pushAll', '推送', () => actions.pushAll()),
    register(
      'gitool.refreshHistory',
      '刷新提交历史',
      () => actions.refreshHistory(),
    ),
  ];
}
