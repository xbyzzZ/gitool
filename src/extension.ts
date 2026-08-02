import * as vscode from 'vscode';
import type { BuiltinGitApi } from './git/builtin-git-api.js';
import { GitRunner, redactSensitiveText } from './git/git-runner.js';
import { CommitService } from './services/commit-service.js';
import {
  CommitMessageAiService,
  type AiLanguageModel,
  type AiSelectedChangeContext,
} from './services/commit-message-ai-service.js';
import { HistoryService } from './services/history-service.js';
import { RepositoryOperationLock } from './services/operation-lock.js';
import { PushService } from './services/push-service.js';
import { RemoteService } from './services/remote-service.js';
import { RepositoryService } from './services/repository-service.js';
import { SyncService } from './services/sync-service.js';
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

function cancellationFor(signal?: AbortSignal): {
  readonly source: vscode.CancellationTokenSource;
  readonly dispose: () => void;
} {
  const source = new vscode.CancellationTokenSource();
  const abort = (): void => {
    source.cancel();
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted === true) {
    source.cancel();
  }
  return {
    source,
    dispose: () => {
      signal?.removeEventListener('abort', abort);
      source.dispose();
    },
  };
}

async function readAiSelectedChanges(
  git: GitRunner,
  repositoryRoot: string,
  selectedPaths: readonly string[],
): Promise<AiSelectedChangeContext> {
  const files: AiSelectedChangeContext['files'][number][] = [];
  const excluded: AiSelectedChangeContext['excluded'][number][] = [];
  let remaining = 256 * 1024;
  for (const path of selectedPaths) {
    if (remaining <= 0) {
      excluded.push({ path, reason: '已达到 AI 上下文总大小限制' });
      continue;
    }
    const [working, staged] = await Promise.all([
      git.run(repositoryRoot, [
        'diff', '--no-ext-diff', '--binary', '--', path,
      ], { allowFailure: true }),
      git.run(repositoryRoot, [
        'diff', '--cached', '--no-ext-diff', '--binary', '--', path,
      ], { allowFailure: true }),
    ]);
    let diff = [staged.stdout, working.stdout].filter(
      (value) => value.length > 0,
    ).join('\n');
    if (diff.length === 0) {
      try {
        const content = await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(vscode.Uri.file(repositoryRoot), path),
        );
        if (content.includes(0)) {
          excluded.push({ path, reason: '二进制文件不发送内容' });
          files.push({ path, status: '变更' });
          continue;
        }
        diff = new TextDecoder().decode(content);
      } catch {
        diff = '';
      }
    }
    if (diff.includes('GIT binary patch') || diff.includes('Binary files ')) {
      excluded.push({ path, reason: '二进制文件不发送差异内容' });
      files.push({ path, status: '变更' });
      continue;
    }
    const allowed = Math.min(64 * 1024, remaining);
    const truncated = diff.length > allowed;
    const effectiveDiff = truncated
      ? `${diff.slice(0, allowed)}\n[单文件差异已截断]`
      : diff;
    remaining -= Math.min(diff.length, allowed);
    files.push({
      path,
      status: '变更',
      ...(effectiveDiff.length === 0 ? {} : { diff: effectiveDiff }),
    });
    if (truncated) {
      excluded.push({ path, reason: '单文件差异超过 64 KiB，已截断' });
    }
  }
  return { files, excluded };
}

function createAiService(git: GitRunner): CommitMessageAiService {
  const selectedModels = new Map<string, vscode.LanguageModelChat>();
  return new CommitMessageAiService({
    selectModels: async (): Promise<readonly AiLanguageModel[]> => {
      let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        models = await vscode.lm.selectChatModels();
      }
      selectedModels.clear();
      return models.map((model) => {
        selectedModels.set(model.id, model);
        return {
          id: model.id,
          maxInputTokens: model.maxInputTokens,
          countTokens: async (text, signal) => {
            const cancellation = cancellationFor(signal);
            try {
              return await model.countTokens(text, cancellation.source.token);
            } finally {
              cancellation.dispose();
            }
          },
        };
      });
    },
    readSelectedDiff: async (request) => await readAiSelectedChanges(
      git,
      request.repositoryRoot,
      request.selectedPaths,
    ),
    sendRequest: async (model, prompt, signal) => {
      const selected = selectedModels.get(model.id);
      if (selected === undefined) {
        throw new Error('所选 VS Code AI 模型已不可用，请重新生成');
      }
      const cancellation = cancellationFor(signal);
      try {
        const response = await selected.sendRequest([
          vscode.LanguageModelChatMessage.User(prompt),
        ], {}, cancellation.source.token);
        let text = '';
        for await (const fragment of response.text) {
          text += fragment;
        }
        return text;
      } finally {
        cancellation.dispose();
      }
    },
  });
}

function createTestAiService(): CommitMessageAiService {
  return new CommitMessageAiService({
    selectModels: () => Promise.resolve([{
      id: 'gitool-test-model',
      maxInputTokens: 16_384,
    }]),
    readSelectedDiff: (request) => Promise.resolve({
      files: request.selectedPaths.map((path) => ({
        path,
        status: '变更',
        diff: `测试差异：${path}`,
      })),
      excluded: [],
    }),
    sendRequest: () => Promise.resolve('测试：由 VS Code AI 适配器生成'),
  });
}

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
    disposables.push(vscode.workspace.registerTextDocumentContentProvider(
      'gitool-empty',
      { provideTextDocumentContent: () => '' },
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
      historyService: new HistoryService(git),
      syncService: new SyncService(),
      aiService: context.extensionMode === vscode.ExtensionMode.Test
        ? createTestAiService()
        : createAiService(git),
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
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.refreshHistory',
        async (): Promise<RepositoryViewModel> => {
          const scope = currentScope();
          await repositoryService.refreshHistory(scope);
          return repositoryService.getViewModel();
        },
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.pushAll',
        async (selectedRemote?: string) => {
          const scope = currentScope();
          return await repositoryService.pushAll({
            repositoryId: scope.repositoryId,
            version: scope.version,
            ...(selectedRemote === undefined ? {} : { selectedRemote }),
          });
        },
      ));
      disposables.push(vscode.commands.registerCommand(
        'gitool.test.generateCommitMessage',
        async (): Promise<RepositoryViewModel> => {
          const scope = currentScope();
          await repositoryService.generateCommitMessage({
            ...scope,
            density: 'standard',
          });
          return repositoryService.getViewModel();
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
