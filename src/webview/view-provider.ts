import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import { redactSensitiveText } from '../git/git-runner.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { RepositoryService } from '../services/repository-service.js';
import type { PushResult } from '../services/push-service.js';
import { parseWebviewMessage, type WebviewMessage } from './messages.js';
import { renderWebviewHtml } from './render.js';

export interface GitoolViewProviderDependencies {
  readonly extensionUri: vscode.Uri;
  readonly gitApi: BuiltinGitApi;
  readonly repositoryService: RepositoryService;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
  readonly acknowledgedRequestId?: string;
}

interface RemotePickItem extends vscode.QuickPickItem {
  readonly remoteName: string;
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(
    error instanceof Error ? error.message : String(error),
  );
}

function messageAction(message: WebviewMessage): string {
  switch (message.type) {
    case 'ready':
    case 'refresh':
      return '刷新';
    case 'selectRepository':
      return '切换仓库';
    case 'toggleFile':
    case 'setGroup':
      return '选择文件';
    case 'setCommitMessage':
      return '更新提交信息';
    case 'openDiff':
      return '打开变更';
    case 'commit':
      return '提交';
    case 'commitAndPush':
    case 'selectPushRemote':
    case 'retryPush':
      return '推送';
    case 'trash':
      return '舍弃未跟踪文件';
    case 'editRemoteUrl':
      return '修改远程 URL';
    case 'refreshHistory':
      return '刷新提交历史';
    case 'fetchHistory':
      return '刷新远程状态';
    case 'pull':
      return '从远程拉取';
    case 'pushAll':
      return '推送全部本地提交';
    case 'loadCommitDetails':
      return '读取提交详情';
    case 'openCommitDiff':
      return '打开历史改动';
    case 'generateCommitMessage':
      return '生成提交信息';
    case 'cancelCommitMessageGeneration':
      return '取消生成提交信息';
  }
}

function selectedRequest(
  model: RepositoryViewModel,
  message: Extract<WebviewMessage, {
    readonly type: 'commit' | 'commitAndPush';
  }>,
): {
  readonly repositoryId: string;
  readonly version: number;
  readonly message: string;
  readonly selectedIds: readonly string[];
} {
  if (message.message.trim().length === 0) {
    throw new Error('提交消息不能为空');
  }
  return {
    repositoryId: message.repositoryId,
    version: message.version,
    message: message.message,
    selectedIds: model.selectedIds,
  };
}

export class GitoolViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'gitool.commitView';

  private readonly disposables: vscode.Disposable[] = [];
  private viewDisposables: vscode.Disposable[] = [];
  private webview: vscode.Webview | undefined;
  private disposed = false;

  constructor(private readonly dependencies: GitoolViewProviderDependencies) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeView();
    this.webview = webviewView.webview;
    this.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.dependencies.extensionUri, 'media'),
      ],
    };
    this.webview.html = renderWebviewHtml(
      this.webview,
      this.dependencies.extensionUri,
      randomBytes(16).toString('hex'),
    );

    this.viewDisposables = [
      this.webview.onDidReceiveMessage((input: unknown) => {
        void this.handleInput(input);
      }),
      this.dependencies.repositoryService.onDidChange(() => {
        void this.postState();
      }),
      webviewView.onDidDispose(() => {
        this.disposeView();
      }),
    ];
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeView();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private disposeView(): void {
    this.webview = undefined;
    for (const disposable of this.viewDisposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async handleInput(input: unknown): Promise<void> {
    let message: WebviewMessage;
    try {
      message = parseWebviewMessage(input);
    } catch (error) {
      this.reportError('处理 Webview 消息', error);
      return;
    }

    try {
      await this.handleMessage(message);
    } catch (error) {
      this.reportError(messageAction(message), error);
    }
    await this.postState(
      'requestId' in message ? message.requestId : undefined,
    );
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    const service = this.dependencies.repositoryService;
    switch (message.type) {
      case 'ready':
        await this.postState();
        return;
      case 'refresh':
        await service.refresh();
        return;
      case 'selectRepository':
        service.selectRepository(message.repositoryId);
        return;
      case 'toggleFile':
        this.requireRepository(message.repositoryId);
        service.setFileSelected(message.fileId, message.selected);
        return;
      case 'setGroup':
        this.requireRepository(message.repositoryId);
        service.setGroup(message.group, message.selected);
        return;
      case 'setCommitMessage':
        this.requireRepository(message.repositoryId);
        service.setCommitMessage(message.message);
        return;
      case 'openDiff':
        this.requireRepository(message.repositoryId);
        await this.openDiff(message.repositoryId, message.fileId);
        return;
      case 'commit': {
        const model = this.requireScope(
          message.repositoryId,
          message.version,
        );
        await service.commit(selectedRequest(model, message));
        await service.refresh();
        return;
      }
      case 'commitAndPush':
        await this.commitAndPush(message);
        return;
      case 'selectPushRemote':
        this.requireScope(message.repositoryId, message.version);
        await service.selectPushRemote({
          repositoryId: message.repositoryId,
          version: message.version,
          remote: message.remote,
        });
        await service.refresh();
        return;
      case 'retryPush':
        await this.retryPush(message.repositoryId, message.version);
        return;
      case 'trash':
        await this.trash(
          message.repositoryId,
          message.version,
          message.fileIds,
        );
        return;
      case 'editRemoteUrl':
        await this.editRemoteUrl(message.repositoryId, message.version);
        return;
    }
  }

  private requireRepository(repositoryId: string): RepositoryViewModel {
    const model = this.dependencies.repositoryService.getViewModel();
    if (model.currentRepositoryId !== repositoryId) {
      throw new Error('界面来源仓库与当前仓库不一致，请等待刷新');
    }
    return model;
  }

  private requireScope(
    repositoryId: string,
    version: number,
  ): RepositoryViewModel {
    const model = this.requireRepository(repositoryId);
    if (model.version !== version) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }
    return model;
  }

  private async commitAndPush(
    message: Extract<WebviewMessage, {
      readonly type: 'commitAndPush';
    }>,
  ): Promise<void> {
    const service = this.dependencies.repositoryService;
    const initialModel = this.requireScope(
      message.repositoryId,
      message.version,
    );
    const request = selectedRequest(initialModel, message);
    const result = await service.commitAndPush(request);
    if (result.kind === 'needs-remote') {
      await this.continuePushWithRemote(request.repositoryId, result);
    } else {
      await service.refresh();
    }
  }

  private async continuePushWithRemote(
    repositoryId: string,
    result: Extract<PushResult, { readonly kind: 'needs-remote' }>,
  ): Promise<void> {
    const selected = await vscode.window.showQuickPick(
      result.remotes.map((remote) => ({ label: remote, remote })),
      {
        placeHolder: '选择用于推送并建立上游的远程',
        title: 'Gitool：选择推送远程',
      },
    );
    if (selected === undefined) {
      this.reportPendingPush(
        '提交已创建，但尚未选择推送远程。可点击“重试推送”继续。',
      );
      return;
    }

    const service = this.dependencies.repositoryService;
    const latest = service.getViewModel();
    if (latest.currentRepositoryId !== repositoryId) {
      throw new Error('推送期间当前仓库已变化');
    }
    await service.selectPushRemote({
      repositoryId,
      version: latest.version,
      remote: selected.remote,
    });
    await service.refresh();
  }

  private async retryPush(
    repositoryId: string,
    version: number,
  ): Promise<void> {
    const service = this.dependencies.repositoryService;
    this.requireScope(repositoryId, version);
    const result = await service.retryPush({ repositoryId, version });
    if (result.kind === 'needs-remote') {
      await this.continuePushWithRemote(repositoryId, result);
    } else {
      await service.refresh();
    }
  }

  private reportPendingPush(message: string): void {
    const service = this.dependencies.repositoryService;
    const operation = service.getViewModel().operation;
    const commitHash = operation.kind === 'commit-succeeded'
      || operation.kind === 'push-failed'
      ? operation.commitHash
      : undefined;
    if (
      commitHash === undefined
      || !service.reportPushFailure(commitHash, message)
    ) {
      throw new Error('推送上下文缺少已创建提交的哈希');
    }
  }

  private async openDiff(
    repositoryId: string,
    fileId: string,
  ): Promise<void> {
    const service = this.dependencies.repositoryService;
    const repository = service.getRepository(repositoryId);
    const change = service.getFileChange(repositoryId, fileId);
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

  private diffTitle(change: FileChange): string {
    return change.originalPath === undefined
      ? `${change.path}（工作区 ↔ HEAD）`
      : `${change.originalPath} → ${change.path}（工作区 ↔ HEAD）`;
  }

  private async trash(
    repositoryId: string,
    version: number,
    fileIds: readonly string[],
  ): Promise<void> {
    const service = this.dependencies.repositoryService;
    const model = this.requireScope(repositoryId, version);
    const selected = new Set(model.selectedIds);
    const changes = fileIds.map((fileId) => {
      const change = service.getFileChange(repositoryId, fileId);
      if (
        change === undefined
        || !change.untracked
        || !selected.has(fileId)
      ) {
        throw new Error('只能舍弃当前已选择的未跟踪文件');
      }
      return change;
    });
    const repository = service.getRepository(repositoryId);
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

    await service.trash({
      repositoryId,
      version,
      fileIds,
    });
    await service.refresh();
  }

  private async editRemoteUrl(
    repositoryId: string,
    version: number,
  ): Promise<void> {
    const service = this.dependencies.repositoryService;
    this.requireScope(repositoryId, version);
    const repository = service.getRepository(repositoryId);
    if (repository === undefined) {
      throw new Error('当前仓库不存在或已关闭');
    }
    if (repository.state.remotes.length === 0) {
      throw new Error('当前仓库没有可修改的远程');
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
      repositoryId,
      version,
      remote: selectedRemote.name,
      url: normalizedUrl,
    });
    await service.refresh();
  }

  private async postState(
    acknowledgedRequestId?: string,
  ): Promise<void> {
    const webview = this.webview;
    if (webview === undefined) {
      return;
    }
    const message: StateMessage = {
      type: 'state',
      model: this.dependencies.repositoryService.getViewModel(),
      ...(acknowledgedRequestId === undefined
        ? {}
        : { acknowledgedRequestId }),
    };
    await webview.postMessage(message);
  }

  private reportError(action: string, error: unknown): void {
    const message = errorMessage(error);
    if (
      this.dependencies.repositoryService.getViewModel().operation.kind
        === 'running'
    ) {
      return;
    }
    if (
      action === '推送'
      && this.dependencies.repositoryService.getViewModel().operation.kind
        === 'push-failed'
    ) {
      return;
    }
    if (!this.dependencies.repositoryService.reportFailure(action, message)) {
      void vscode.window.showErrorMessage(`Gitool：${message}`);
    }
  }
}
