import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { redactSensitiveText } from '../git/git-runner.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { RepositoryService } from '../services/repository-service.js';
import type {
  AiModelSelection,
  AiModelSelectionStore,
} from '../services/ai-model-selection-store.js';
import type { PushResult } from '../services/push-service.js';
import { GitoolViewActions } from '../views/view-actions.js';
import type { AiModelInfo } from './commit-view-state.js';
import { parseWebviewMessage, type WebviewMessage } from './messages.js';
import { renderCommitWebviewHtml } from './render.js';
import {
  loadCurrentFileIconTheme,
  type LoadedFileIconTheme,
} from './file-icon-theme-loader.js';

export interface GitoolViewProviderDependencies {
  readonly extensionUri: vscode.Uri;
  readonly gitApi: BuiltinGitApi;
  readonly repositoryService: RepositoryService;
  readonly aiModelSelectionStore: AiModelSelectionStore;
  readonly loadFileIconTheme?: typeof loadCurrentFileIconTheme;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
  readonly aiModelSelection?: AiModelSelection;
  readonly aiModels?: readonly AiModelInfo[];
  readonly acknowledgedRequestId?: string;
  readonly fileIconClasses: readonly (string | null)[];
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
    case 'pull':
      return '从远程拉取';
    case 'pushAll':
      return '推送全部本地提交';
    case 'generateCommitMessage':
      return '生成提交信息';
    case 'setAiModel':
      return '设置 AI 模型';
    case 'loadCommitDetails':
      return '读取提交文件';
    case 'openCommitDiff':
      return '打开历史文件差异';
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
  private themeLoadSequence = 0;
  private clientReady = false;
  private aiModels: readonly AiModelInfo[] | undefined;
  private aiModelsRequested = false;
  private fileIconTheme: Pick<LoadedFileIconTheme, 'classForPath'> = {
    classForPath: () => undefined,
  };

  constructor(private readonly dependencies: GitoolViewProviderDependencies) {
    this.viewActions = new GitoolViewActions({
      service: dependencies.repositoryService,
      gitApi: dependencies.gitApi,
    });
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('workbench.iconTheme')) {
          void this.reloadFileIconTheme();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        void this.reloadFileIconTheme();
      }),
    );
  }

  // 必须立刻写入 HTML，不能 await 图标主题；否则首屏空白，要点第二次才出变更。
  // eslint-disable-next-line @typescript-eslint/require-await
  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
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
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          void this.refreshVisibleRepository().catch((error: unknown) => {
            this.reportError('刷新', error);
          });
        }
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
    void this.reloadFileIconTheme();
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
    this.themeLoadSequence += 1;
    this.clientReady = false;
    this.aiController?.abort();
    this.aiController = undefined;
    // 不能在这里写旧视图的 badge/description：onDidDispose 触发时视图已销毁，
    // setter 会抛 'Webview is disposed' 并中断清理；新视图的元数据由
    // resolveWebviewView 里的 updateViewMetadata 重新写入。
    this.view = undefined;
    this.webview = undefined;
    for (const disposable of this.viewDisposables.splice(0)) {
      disposable.dispose();
    }
  }

  private async reloadFileIconTheme(): Promise<void> {
    const webview = this.webview;
    if (webview === undefined) {
      return;
    }
    const sequence = ++this.themeLoadSequence;
    let theme: LoadedFileIconTheme;
    try {
      theme = await (this.dependencies.loadFileIconTheme
        ?? loadCurrentFileIconTheme)(webview);
    } catch (error) {
      if (sequence !== this.themeLoadSequence || this.webview !== webview) {
        return;
      }
      this.dependencies.repositoryService.reportFailure(
        '读取文件图标主题',
        errorMessage(error),
      );
      theme = {
        css: '',
        classForPath: () => undefined,
        localResourceRoots: [],
      };
    }
    if (sequence !== this.themeLoadSequence || this.webview !== webview) {
      return;
    }
    this.fileIconTheme = theme;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.dependencies.extensionUri, 'media'),
        ...theme.localResourceRoots,
      ],
    };
    if (this.clientReady) {
      void this.postState();
      return;
    }
    webview.html = renderCommitWebviewHtml(
      webview,
      this.dependencies.extensionUri,
      randomBytes(16).toString('hex'),
      theme.css,
    );
  }

  private async handleInput(input: unknown): Promise<void> {
    this.clientReady = true;
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

  private async handleMessage(
    message: WebviewMessage,
  ): Promise<void> {
    const service = this.dependencies.repositoryService;
    switch (message.type) {
      case 'ready':
        this.clientReady = true;
        await this.refreshVisibleRepository();
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
      case 'pull':
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.pull();
        return;
      case 'pushAll':
        this.requireScope(message.repositoryId, message.version);
        await this.viewActions.pushAll();
        return;
      case 'generateCommitMessage':
        await this.generateCommitMessage(message);
        return;
      case 'setAiModel':
        await this.setAiModel(message.repositoryId, message.modelId);
        return;
      case 'loadCommitDetails':
        await this.sendCommitDetails(message);
        return;
      case 'openCommitDiff':
        await this.openCommitDiff(message);
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
    view.description = model.changeCount === 0
      ? ''
      : `${String(model.changeCount)} 个变更`;
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
      const selection = this.dependencies.aiModelSelectionStore.get(
        message.repositoryId,
      );
      await this.dependencies.repositoryService.generateCommitMessage({
        repositoryId: message.repositoryId,
        version: message.version,
        selectedIds: message.selectedIds,
        density: message.density,
        ...(selection === undefined ? {} : { modelId: selection.id }),
      }, controller.signal);
    } finally {
      if (this.aiController === controller) {
        this.aiController = undefined;
      }
    }
  }

  private async setAiModel(
    repositoryId: string,
    modelId: string,
  ): Promise<void> {
    this.requireRepository(repositoryId);
    if (modelId === 'auto') {
      await this.dependencies.aiModelSelectionStore.set(
        repositoryId,
        undefined,
      );
      return;
    }
    const models = await this.ensureAiModels();
    const selected = models?.find((model) => model.id === modelId);
    if (selected === undefined) {
      throw new Error('所选 AI 模型不可用');
    }
    await this.dependencies.aiModelSelectionStore.set(repositoryId, {
      id: selected.id,
      name: selected.name,
    });
  }

  private async ensureAiModels(): Promise<readonly AiModelInfo[] | undefined> {
    if (!this.aiModelsRequested) {
      this.aiModelsRequested = true;
      try {
        const models = await this.dependencies.repositoryService.listAiModels();
        this.aiModels = models.map((model): AiModelInfo => {
          const description = [model.vendor, model.family, model.version]
            .filter((value) => value.length > 0)
            .join(' · ');
          return {
            id: model.id,
            name: model.name,
            ...(description.length === 0 ? {} : { description }),
          };
        });
      } catch {
        this.aiModels = undefined;
      }
    }
    return this.aiModels;
  }

  private async sendCommitDetails(
    message: Extract<WebviewMessage, { readonly type: 'loadCommitDetails' }>,
  ): Promise<void> {
    this.requireScope(message.repositoryId, message.version);
    const details = await this.dependencies.repositoryService.loadCommitDetails({
      repositoryId: message.repositoryId,
      version: message.version,
      hash: message.hash,
    });
    await this.webview?.postMessage({
      type: 'commitDetails',
      repositoryId: message.repositoryId,
      version: message.version,
      details,
      fileIconClasses: details.files.map((file) =>
        this.fileIconTheme.classForPath(file.path) ?? null),
    });
  }

  private async openCommitDiff(
    message: Extract<WebviewMessage, { readonly type: 'openCommitDiff' }>,
  ): Promise<void> {
    this.requireScope(message.repositoryId, message.version);
    const service = this.dependencies.repositoryService;
    const repository = service.getRepository(message.repositoryId);
    if (repository === undefined) {
      throw new Error('当前仓库不存在或已关闭');
    }
    const details = await service.loadCommitDetails({
      repositoryId: message.repositoryId,
      version: message.version,
      hash: message.hash,
    });
    const file = details.files.find((item) => item.path === message.path);
    if (file === undefined) {
      throw new Error('文件不属于所选历史提交');
    }
    const originalPath = file.originalPath ?? file.path;
    const emptyUri = vscode.Uri.from({
      scheme: 'gitool-empty',
      path: `/${details.hash}/${file.path}`,
    });
    const leftUri = file.status.startsWith('A')
      ? emptyUri
      : this.dependencies.gitApi.toGitUri(
        vscode.Uri.joinPath(repository.rootUri, originalPath),
        details.parentHash ?? details.hash,
      );
    const rightUri = file.status.startsWith('D')
      ? emptyUri
      : this.dependencies.gitApi.toGitUri(
        vscode.Uri.joinPath(repository.rootUri, file.path),
        details.hash,
      );
    const pathLabel = file.originalPath === undefined
      ? file.path
      : `${file.originalPath} → ${file.path}`;
    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      rightUri,
      `${pathLabel}（历史提交 ${details.hash.slice(0, 7)}）`,
    );
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

  private async refreshVisibleRepository(): Promise<void> {
    const service = this.dependencies.repositoryService;
    await service.ensureWorkspaceRepositories();
    if (service.getViewModel().currentRepositoryId === undefined) {
      await this.postState();
      return;
    }
    await service.refresh();
  }

  private async postState(
    acknowledgedRequestId?: string,
  ): Promise<void> {
    const webview = this.webview;
    if (webview === undefined || !this.clientReady) {
      return;
    }
    const model = this.dependencies.repositoryService.getViewModel();
    const repositoryId = model.currentRepositoryId;
    const selection = repositoryId === undefined
      ? undefined
      : this.dependencies.aiModelSelectionStore.get(repositoryId);
    const aiModels = repositoryId === undefined
      ? undefined
      : await this.ensureAiModels();
    const message: StateMessage = {
      type: 'state',
      model,
      fileIconClasses: model.changes.map((change) =>
        this.fileIconTheme.classForPath(change.path) ?? null),
      ...(selection === undefined ? {} : { aiModelSelection: selection }),
      ...(aiModels === undefined ? {} : { aiModels }),
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
