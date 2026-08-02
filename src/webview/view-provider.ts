import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { redactSensitiveText } from '../git/git-runner.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { RepositoryService } from '../services/repository-service.js';
import type { PushResult } from '../services/push-service.js';
import { GitoolViewActions } from '../views/view-actions.js';
import { parseWebviewMessage, type WebviewMessage } from './messages.js';
import { renderCommitWebviewHtml } from './render.js';

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
  static readonly viewType: string = 'gitool.commitView';

  private readonly disposables: vscode.Disposable[] = [];
  private viewDisposables: vscode.Disposable[] = [];
  private webview: vscode.Webview | undefined;
  private view: vscode.WebviewView | undefined;
  private aiController: AbortController | undefined;
  private readonly viewActions: GitoolViewActions;
  private disposed = false;

  constructor(private readonly dependencies: GitoolViewProviderDependencies) {
    this.viewActions = new GitoolViewActions({
      service: dependencies.repositoryService,
      gitApi: dependencies.gitApi,
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeView();
    this.view = webviewView;
    this.webview = webviewView.webview;
    this.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.dependencies.extensionUri, 'media'),
      ],
    };
    this.viewDisposables = [
      this.webview.onDidReceiveMessage((input: unknown) => {
        void this.handleInput(input);
      }),
      this.dependencies.repositoryService.onDidChange(() => {
        this.updateViewMetadata();
        void this.postState();
      }),
      webviewView.onDidDispose(() => {
        this.disposeView();
      }),
    ];
    this.webview.html = renderCommitWebviewHtml(
      this.webview,
      this.dependencies.extensionUri,
      randomBytes(16).toString('hex'),
    );
    this.updateViewMetadata();
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
    this.aiController?.abort();
    this.aiController = undefined;
    if (this.view !== undefined) {
      this.view.badge = undefined;
      this.view.description = '';
    }
    this.view = undefined;
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
        {
          const model = service.getViewModel();
          if (model.currentRepositoryId === undefined) {
            await this.postState();
          } else {
            await service.refresh();
          }
        }
        return;
      case 'refresh':
        await service.refresh();
        return;
      case 'selectRepository':
        this.aiController?.abort();
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
        {
          const change = service.getFileChange(
            message.repositoryId,
            message.fileId,
          );
          if (change === undefined) {
            throw new Error('文件不属于当前仓库状态');
          }
          await this.viewActions.openChange({
            kind: 'file',
            repositoryId: message.repositoryId,
            section: change.untracked ? 'untracked' : 'tracked',
            change,
          });
        }
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
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.trashUntracked();
        return;
      case 'editRemoteUrl':
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.editRemote();
        return;
      case 'refreshHistory':
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.refreshHistory();
        return;
      case 'fetchHistory':
        this.requireScope(message.repositoryId, message.version);
        await service.fetchHistory({
          repositoryId: message.repositoryId,
          version: message.version,
        });
        return;
      case 'pull':
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.pull();
        return;
      case 'pushAll':
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.pushAll();
        return;
      case 'loadCommitDetails':
      case 'openCommitDiff':
        throw new Error('提交信息视图不支持历史操作');
      case 'generateCommitMessage':
        await this.generateCommitMessage(message);
        return;
      case 'cancelCommitMessageGeneration':
        this.requireRepository(message.repositoryId);
        this.aiController?.abort();
        this.aiController = undefined;
        return;
    }
  }

  private updateViewMetadata(): void {
    const view = this.view;
    if (view === undefined) {
      return;
    }
    const model = this.dependencies.repositoryService.getViewModel();
    const count = model.changeCount;
    view.badge = count === 0
      ? undefined
      : {
          value: count,
          tooltip: `Gitool：${String(count)} 个变更文件`,
        };
  }

  private async generateCommitMessage(
    message: Extract<WebviewMessage, {
      readonly type: 'generateCommitMessage';
    }>,
  ): Promise<void> {
    this.requireScope(message.repositoryId, message.version);
    this.aiController?.abort();
    const controller = new AbortController();
    this.aiController = controller;
    try {
      await this.dependencies.repositoryService.generateCommitMessage({
        repositoryId: message.repositoryId,
        version: message.version,
        selectedIds: message.selectedIds,
        density: message.density,
      }, controller.signal);
    } finally {
      if (this.aiController === controller) {
        this.aiController = undefined;
      }
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
    if (action === '生成提交信息' && message.includes('已取消')) {
      return;
    }
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
