import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import { redactSensitiveText } from '../git/git-runner.js';
import type { RepositoryService } from '../services/repository-service.js';
import {
  loadCurrentFileIconTheme,
  type LoadedFileIconTheme,
} from './file-icon-theme-loader.js';
import { parseWebviewMessage, type WebviewMessage } from './messages.js';
import { renderHistoryWebviewHtml } from './render.js';

export interface HistoryViewProviderDependencies {
  readonly extensionUri: vscode.Uri;
  readonly gitApi: BuiltinGitApi;
  readonly repositoryService: RepositoryService;
  readonly loadFileIconTheme?: typeof loadCurrentFileIconTheme;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
}

export class HistoryViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'gitool.historyView';
  private readonly disposables: vscode.Disposable[] = [];
  private viewDisposables: vscode.Disposable[] = [];
  private webview: vscode.Webview | undefined;
  private themeLoadSequence = 0;
  private fileIconTheme: Pick<LoadedFileIconTheme, 'classForPath'> = {
    classForPath: () => undefined,
  };

  constructor(private readonly dependencies: HistoryViewProviderDependencies) {
    this.disposables.push(
      dependencies.repositoryService.onDidChange(() => {
        void this.postState();
      }),
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

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    for (const disposable of this.viewDisposables.splice(0)) {
      disposable.dispose();
    }
    this.webview = view.webview;
    this.viewDisposables.push(
      view.webview.onDidReceiveMessage((input: unknown) => {
        void this.handleMessage(input);
      }),
      view.onDidDispose(() => {
        this.themeLoadSequence += 1;
        this.webview = undefined;
        for (const disposable of this.viewDisposables.splice(0)) {
          disposable.dispose();
        }
      }),
    );
    await this.reloadFileIconTheme();
  }

  private async reloadFileIconTheme(): Promise<void> {
    const webview = this.webview;
    if (webview === undefined) {
      return;
    }
    const sequence = ++this.themeLoadSequence;
    let fileIconTheme: LoadedFileIconTheme;
    try {
      fileIconTheme = await (this.dependencies.loadFileIconTheme
        ?? loadCurrentFileIconTheme)(webview);
    } catch (error) {
      if (sequence !== this.themeLoadSequence || this.webview !== webview) {
        return;
      }
      const detail = redactSensitiveText(error instanceof Error ? error.message : String(error));
      this.dependencies.repositoryService.reportFailure('读取文件图标主题', detail);
      fileIconTheme = {
        css: '',
        classForPath: () => undefined,
        localResourceRoots: [],
      };
    }
    if (sequence !== this.themeLoadSequence || this.webview !== webview) {
      return;
    }
    this.fileIconTheme = fileIconTheme;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.dependencies.extensionUri,
        ...fileIconTheme.localResourceRoots,
      ],
    };
    webview.html = renderHistoryWebviewHtml(
      webview,
      this.dependencies.extensionUri,
      randomBytes(18).toString('base64url'),
      fileIconTheme.css,
    );
  }

  dispose(): void {
    this.themeLoadSequence += 1;
    for (const disposable of this.viewDisposables.splice(0).reverse()) {
      disposable.dispose();
    }
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
    this.webview = undefined;
  }

  private async handleMessage(input: unknown): Promise<void> {
    let message: WebviewMessage;
    try {
      message = parseWebviewMessage(input);
      if (message.type === 'ready') {
        await this.postState();
        return;
      }
      if (message.type === 'loadCommitDetails') {
        this.requireScope(message.repositoryId, message.version);
        const details = await this.dependencies.repositoryService.loadCommitDetails(message);
        await this.webview?.postMessage({
          type: 'commitDetails',
          repositoryId: message.repositoryId,
          version: message.version,
          details,
          fileIconClasses: details.files.map((file) =>
            this.fileIconTheme.classForPath(file.path) ?? null),
        });
        return;
      }
      if (message.type === 'openCommitDiff') {
        await this.openCommitDiff(message);
      }
    } catch (error) {
      const detail = redactSensitiveText(error instanceof Error ? error.message : String(error));
      this.dependencies.repositoryService.reportFailure('提交历史', detail);
      await vscode.window.showErrorMessage(`Gitool：${detail}`);
    }
  }

  private requireScope(repositoryId: string, version: number): void {
    const model = this.dependencies.repositoryService.getViewModel();
    if (model.currentRepositoryId !== repositoryId || model.version !== version) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }
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
    const details = await service.loadCommitDetails(message);
    const file = details.files.find((item) => item.path === message.path);
    if (file === undefined) {
      throw new Error('文件不属于所选历史提交');
    }
    const originalPath = file.originalPath ?? file.path;
    const emptyUri = vscode.Uri.from({ scheme: 'gitool-empty', path: `/${details.hash}/${file.path}` });
    const leftUri = file.status.startsWith('A')
      ? emptyUri
      : this.dependencies.gitApi.toGitUri(
        vscode.Uri.joinPath(repository.rootUri, originalPath),
        details.parentHash ?? details.hash,
      );
    const rightUri = file.status.startsWith('D')
      ? emptyUri
      : this.dependencies.gitApi.toGitUri(vscode.Uri.joinPath(repository.rootUri, file.path), details.hash);
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

  private async postState(): Promise<void> {
    const message: StateMessage = {
      type: 'state',
      model: this.dependencies.repositoryService.getViewModel(),
    };
    await this.webview?.postMessage(message);
  }
}
