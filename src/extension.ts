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
  getAPI(version: 1): BuiltinGitApi;
}

export interface GitoolRuntime extends vscode.Disposable {
  readonly mode: 'ready' | 'git-unavailable';
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
    for (const disposable of [...this.disposables].reverse()) {
      disposable.dispose();
    }
  }
}

class GitUnavailableViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: false };
    view.webview.html = [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>Gitool 不可用</title>',
      '</head>',
      '<body>',
      '<h2>Gitool 无法启动</h2>',
      `<p>${gitUnavailableMessage}</p>`,
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

function errorMessage(error: unknown): string {
  return redactSensitiveText(
    error instanceof Error ? error.message : String(error),
  );
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

function registerUnavailableRuntime(): GitoolRuntime {
  const provider = new GitUnavailableViewProvider();
  const disposables: vscode.Disposable[] = [
    vscode.window.registerWebviewViewProvider(
      GitoolViewProvider.viewType,
      provider,
    ),
    vscode.commands.registerCommand('gitool.refresh', async () => {
      await vscode.window.showErrorMessage(`Gitool：${gitUnavailableMessage}`);
    }),
  ];
  return new Runtime('git-unavailable', disposables);
}

function registerReadyRuntime(
  context: vscode.ExtensionContext,
  gitApi: BuiltinGitApi,
): GitoolRuntime {
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
  const provider = new GitoolViewProvider({
    extensionUri: context.extensionUri,
    gitApi,
    repositoryService,
  });

  const disposables: vscode.Disposable[] = [
    repositoryService,
    provider,
    vscode.window.registerWebviewViewProvider(
      GitoolViewProvider.viewType,
      provider,
    ),
    vscode.commands.registerCommand('gitool.refresh', async () => {
      await refreshSafely(repositoryService);
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void refreshSafely(repositoryService);
    }),
  ];
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
    disposables.push(
      vscode.commands.registerCommand(
        'gitool.test.getState',
        (): RepositoryViewModel => repositoryService.getViewModel(),
      ),
      vscode.commands.registerCommand(
        'gitool.test.selectRepository',
        (repositoryId: string): RepositoryViewModel =>
          repositoryService.selectRepository(repositoryId),
      ),
      vscode.commands.registerCommand(
        'gitool.test.refresh',
        async (): Promise<RepositoryViewModel> =>
          await repositoryService.refresh(),
      ),
      vscode.commands.registerCommand(
        'gitool.test.setFileSelected',
        (fileId: string, selected: boolean): RepositoryViewModel =>
          repositoryService.setFileSelected(fileId, selected),
      ),
      vscode.commands.registerCommand(
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
      ),
      vscode.commands.registerCommand(
        'gitool.test.commitAndPush',
        async (message: string) => {
          const scope = currentScope();
          return await repositoryService.commitAndPush({
            ...scope,
            message,
          });
        },
      ),
      vscode.commands.registerCommand(
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
      ),
      vscode.commands.registerCommand(
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
      ),
      vscode.commands.registerCommand(
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
      ),
    );
  }
  return new Runtime('ready', disposables);
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
    try {
      const exportsValue = await gitExtension.activate();
      runtime = isBuiltinGitExtensionExports(exportsValue)
        ? registerReadyRuntime(context, exportsValue.getAPI(1))
        : registerUnavailableRuntime();
    } catch {
      runtime = registerUnavailableRuntime();
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
