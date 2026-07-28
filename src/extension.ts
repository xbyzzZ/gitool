import * as vscode from 'vscode';
import type { BuiltinGitApi } from './git/builtin-git-api.js';
import { GitRunner, redactSensitiveText } from './git/git-runner.js';
import { CommitService } from './services/commit-service.js';
import { RepositoryOperationLock } from './services/operation-lock.js';
import { PushService } from './services/push-service.js';
import { RemoteService } from './services/remote-service.js';
import { RepositoryService } from './services/repository-service.js';
import {
  TrashService,
  type TrashConfirmationRequest,
} from './services/trash-service.js';
import { GitoolViewProvider } from './webview/view-provider.js';
import type { RepositoryViewModel } from './domain/view-model.js';

interface BuiltinGitExtensionExports {
  getAPI(version: 1): unknown;
}

export interface GitoolRuntime extends vscode.Disposable {
  readonly mode: 'ready' | 'git-unavailable' | 'initialization-failed';
}

const gitUnavailableMessage =
  'VS Code 内置 Git 扩展不可用或已禁用。请启用内置 Git 扩展并重新加载窗口。';

let activeRuntime: GitoolRuntime | undefined;

class Runtime implements GitoolRuntime {
  private disposed = false;

  constructor(
    readonly mode: GitoolRuntime['mode'],
    private readonly disposables: readonly vscode.Disposable[],
  ) {}

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    disposeReverse(this.disposables);
  }
}

interface ErrorViewContent {
  readonly title: string;
  readonly heading: string;
  readonly message: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

class ErrorViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly content: ErrorViewContent) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: false };
    view.webview.html = [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${escapeHtml(this.content.title)}</title>`,
      '</head>',
      '<body>',
      `<h2>${escapeHtml(this.content.heading)}</h2>`,
      `<p>${escapeHtml(this.content.message)}</p>`,
      '</body>',
      '</html>',
    ].join('');
  }
}

function isBuiltinGitExtensionExports(
  value: unknown,
): value is BuiltinGitExtensionExports {
  return typeof value === 'object'
    && value !== null
    && 'getAPI' in value
    && typeof value.getAPI === 'function';
}

function isBuiltinGitApi(value: unknown): value is BuiltinGitApi {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as {
    readonly git?: unknown;
    readonly repositories?: unknown;
    readonly onDidOpenRepository?: unknown;
    readonly onDidCloseRepository?: unknown;
    readonly toGitUri?: unknown;
  };
  const git = candidate.git;
  return typeof git === 'object'
    && git !== null
    && typeof (git as { readonly path?: unknown }).path === 'string'
    && Array.isArray(candidate.repositories)
    && typeof candidate.onDidOpenRepository === 'function'
    && typeof candidate.onDidCloseRepository === 'function'
    && typeof candidate.toGitUri === 'function';
}

type GitApiAcquisition =
  | { readonly kind: 'ready'; readonly gitApi: BuiltinGitApi }
  | { readonly kind: 'unavailable'; readonly reason: string };

async function acquireGitApi(
  extension: vscode.Extension<unknown>,
): Promise<GitApiAcquisition> {
  try {
    const exportsValue = await extension.activate();
    if (!isBuiltinGitExtensionExports(exportsValue)) {
      throw new Error('内置 Git 扩展未提供 API 版本 1');
    }
    const apiValue = exportsValue.getAPI(1);
    if (!isBuiltinGitApi(apiValue)) {
      throw new Error('内置 Git 扩展 API 版本 1 的运行时契约无效');
    }
    return { kind: 'ready', gitApi: apiValue };
  } catch (error) {
    return { kind: 'unavailable', reason: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(
    error instanceof Error ? error.message : String(error),
  );
}

function disposeReverse(disposables: readonly vscode.Disposable[]): void {
  const errors: Error[] = [];
  for (const disposable of [...disposables].reverse()) {
    try {
      disposable.dispose();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, '释放 Gitool 资源失败');
  }
}

async function confirmTrash(
  request: TrashConfirmationRequest,
): Promise<boolean> {
  const selected = await vscode.window.showWarningMessage(
    request.message,
    { modal: true },
    request.confirmLabel,
  );
  return selected === request.confirmLabel;
}

async function refreshSafely(service: RepositoryService): Promise<void> {
  if (service.getViewModel().currentRepositoryId === undefined) {
    return;
  }
  try {
    await service.refresh();
  } catch (error) {
    const message = errorMessage(error);
    if (!service.reportFailure('刷新', message)) {
      await vscode.window.showErrorMessage(`Gitool：${message}`);
    }
  }
}

function registerErrorRuntime(
  mode: 'git-unavailable' | 'initialization-failed',
  content: ErrorViewContent,
): GitoolRuntime {
  const provider = new ErrorViewProvider(content);
  const disposables: vscode.Disposable[] = [];
  try {
    disposables.push(vscode.window.registerWebviewViewProvider(
      GitoolViewProvider.viewType,
      provider,
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.refresh',
      async () => {
        await vscode.window.showErrorMessage(`Gitool：${content.message}`);
      },
    ));
    return new Runtime(mode, disposables);
  } catch (error) {
    try {
      disposeReverse(disposables);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `注册 ${content.heading}视图失败，且资源清理失败`,
      );
    }
    throw error;
  }
}

function registerUnavailableRuntime(reason?: string): GitoolRuntime {
  const message = reason === undefined
    ? gitUnavailableMessage
    : `${gitUnavailableMessage} 原因：${reason}`;
  return registerErrorRuntime('git-unavailable', {
    title: 'Gitool 不可用',
    heading: 'Gitool 无法启动',
    message,
  });
}

function registerInitializationFailedRuntime(error: unknown): GitoolRuntime {
  return registerErrorRuntime('initialization-failed', {
    title: 'Gitool 初始化失败',
    heading: 'Gitool 初始化失败',
    message: `Gitool 初始化失败：${errorMessage(error)}`,
  });
}

function registerReadyRuntime(
  context: vscode.ExtensionContext,
  gitApi: BuiltinGitApi,
): GitoolRuntime {
  const disposables: vscode.Disposable[] = [];
  try {
    const git = new GitRunner(gitApi.git.path || 'git');
    const repositoryService = new RepositoryService({
      gitApi,
      commitService: new CommitService(git),
      pushService: new PushService(),
      remoteService: new RemoteService(git),
      trashService: new TrashService({
        confirm: confirmTrash,
        delete: async (uri, options) => {
          await vscode.workspace.fs.delete(vscode.Uri.file(uri.fsPath), options);
        },
      }),
      operationLock: new RepositoryOperationLock(),
      isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    });
    disposables.push(repositoryService);
    const provider = new GitoolViewProvider({
      extensionUri: context.extensionUri,
      gitApi,
      repositoryService,
    });
    disposables.push(provider);

    disposables.push(vscode.window.registerWebviewViewProvider(
      GitoolViewProvider.viewType,
      provider,
    ));
    disposables.push(vscode.commands.registerCommand(
      'gitool.refresh',
      async () => {
        await refreshSafely(repositoryService);
      },
    ));
    disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void refreshSafely(repositoryService);
    }));
    if (context.extensionMode === vscode.ExtensionMode.Test) {
      const currentScope = (): {
        readonly repositoryId: string;
        readonly version: number;
        readonly selectedIds: readonly string[];
      } => {
        const model = repositoryService.getViewModel();
        if (model.currentRepositoryId === undefined) {
          throw new Error('当前没有打开的 Git 仓库');
        }
        return {
          repositoryId: model.currentRepositoryId,
          version: model.version,
          selectedIds: model.selectedIds,
        };
      };

      disposables.push(vscode.commands.registerCommand(
        'gitool.test.getState',
        (): RepositoryViewModel => repositoryService.getViewModel(),
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.selectRepository',
        (repositoryId: string): RepositoryViewModel =>
          repositoryService.selectRepository(repositoryId),
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.refresh',
        async (): Promise<RepositoryViewModel> =>
          await repositoryService.refresh(),
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.setFileSelected',
        (fileId: string, selected: boolean): RepositoryViewModel =>
          repositoryService.setFileSelected(fileId, selected),
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.commit',
        async (message: string) => {
          const scope = currentScope();
          const result = await repositoryService.commit({
            ...scope,
            message,
          });
          await repositoryService.refresh();
          return result;
        },
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.commitAndPush',
        async (message: string) => {
          const scope = currentScope();
          return await repositoryService.commitAndPush({
            ...scope,
            message,
          });
        },
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.selectPushRemote',
        async (remote: string) => {
          const scope = currentScope();
          const result = await repositoryService.selectPushRemote({
            repositoryId: scope.repositoryId,
            version: scope.version,
            remote,
          });
          await repositoryService.refresh();
          return result;
        },
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.retryPush',
        async () => {
          const scope = currentScope();
          const result = await repositoryService.retryPush({
            repositoryId: scope.repositoryId,
            version: scope.version,
          });
          await repositoryService.refresh();
          return result;
        },
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.setRemoteUrl',
        async (remote: string, url: string) => {
          const scope = currentScope();
          const result = await repositoryService.setRemoteUrl({
            repositoryId: scope.repositoryId,
            version: scope.version,
            remote,
            url,
          });
          await repositoryService.refresh();
          return result;
        },
      ));
    }
    return new Runtime('ready', disposables);
  } catch (error) {
    try {
      disposeReverse(disposables);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Gitool 初始化失败：${errorMessage(error)}；资源清理同时失败`,
      );
    }
    throw error;
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<GitoolRuntime> {
  activeRuntime?.dispose();

  const gitExtension = vscode.extensions.getExtension<unknown>('vscode.git');
  let runtime: GitoolRuntime;
  if (gitExtension === undefined) {
    runtime = registerUnavailableRuntime();
  } else {
    const acquisition = await acquireGitApi(gitExtension);
    if (acquisition.kind === 'unavailable') {
      runtime = registerUnavailableRuntime(acquisition.reason);
    } else {
      try {
        runtime = registerReadyRuntime(context, acquisition.gitApi);
      } catch (error) {
        runtime = registerInitializationFailedRuntime(error);
      }
    }
  }

  activeRuntime = runtime;
  context.subscriptions.push(runtime);
  return runtime;
}

export function deactivate(): void {
  activeRuntime?.dispose();
  activeRuntime = undefined;
}
