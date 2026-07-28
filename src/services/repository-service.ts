import { basename, relative, resolve, sep } from 'node:path';
import type * as vscode from 'vscode';
import {
  mergeChanges,
  type ChangeKind,
  type ChangeLayer,
  type FileChange,
  type RawChange,
} from '../domain/change-model.js';
import { SelectionStore } from '../domain/selection-store.js';
import type {
  OperationState,
  RepositoryViewModel,
} from '../domain/view-model.js';
import type {
  BuiltinChange,
  BuiltinGitApi,
  BuiltinRepository,
} from '../git/builtin-git-api.js';
import type {
  CommitRequest,
  CommitResult,
  CommitService,
} from './commit-service.js';
import { RepositoryOperationLock } from './operation-lock.js';
import type {
  PushResult,
  PushService,
} from './push-service.js';
import type { RemoteInfo, RemoteService } from './remote-service.js';
import type { TrashResult, TrashService } from './trash-service.js';

interface CommitServicePort {
  commit(request: CommitRequest): Promise<CommitResult>;
}

interface PushServicePort {
  push(
    repository: BuiltinRepository,
    request: {
      readonly selectedRemote?: string;
      readonly localBranch: string;
    },
  ): Promise<PushResult>;
}

interface TrashServicePort {
  moveToTrash(
    repositoryRoot: string,
    relativePaths: readonly string[],
  ): Promise<TrashResult>;
}

interface RemoteServicePort {
  setUrl(
    repositoryRoot: string,
    name: string,
    url: string,
  ): Promise<RemoteInfo>;
}

export interface RepositoryServiceDependencies {
  readonly gitApi: BuiltinGitApi;
  readonly selectionStore?: SelectionStore;
  readonly commitService: CommitServicePort | CommitService;
  readonly pushService: PushServicePort | PushService;
  readonly trashService: TrashServicePort | TrashService;
  readonly remoteService: RemoteServicePort | RemoteService;
  readonly operationLock?: RepositoryOperationLock;
  readonly isWorkspaceTrusted: () => boolean;
}

export interface RepositoryCommitRequest {
  readonly repositoryId: string;
  readonly version: number;
  readonly message: string;
  readonly selectedIds: readonly string[];
}

export interface RepositoryVersionRequest {
  readonly repositoryId: string;
  readonly version: number;
}

export interface SelectPushRemoteRequest extends RepositoryVersionRequest {
  readonly remote: string;
}

export interface TrashRequest extends RepositoryVersionRequest {
  readonly fileIds: readonly string[];
}

export interface SetRemoteUrlRequest extends RepositoryVersionRequest {
  readonly remote: string;
  readonly url: string;
}

interface PendingPush {
  readonly commitHash: string;
  readonly localBranch: string;
  readonly selectedRemote?: string;
}

interface RepositoryState {
  readonly id: string;
  readonly rootPath: string;
  readonly repository: BuiltinRepository;
  changeListener: vscode.Disposable;
  version: number;
  changes: readonly FileChange[];
  selectedIds: ReadonlySet<string>;
  commitMessage: string;
  operation: OperationState;
  pendingPush?: PendingPush;
}

interface WriteContext {
  readonly state: RepositoryState;
  readonly files: readonly FileChange[];
}

const STATUS_KIND = new Map<number, ChangeKind>([
  [0, 'modified'],
  [1, 'added'],
  [2, 'deleted'],
  [3, 'renamed'],
  [4, 'added'],
  [5, 'modified'],
  [6, 'deleted'],
  [7, 'untracked'],
  [9, 'added'],
  [10, 'renamed'],
  [11, 'type-changed'],
  [12, 'conflicted'],
  [13, 'conflicted'],
  [14, 'conflicted'],
  [15, 'conflicted'],
  [16, 'conflicted'],
  [17, 'conflicted'],
  [18, 'conflicted'],
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repositoryId(repository: BuiltinRepository): string {
  return resolve(repository.rootUri.fsPath);
}

function relativeGitPath(repositoryRoot: string, uri: vscode.Uri): string {
  const path = relative(repositoryRoot, resolve(uri.fsPath));
  if (
    path.length === 0
    || path === '..'
    || path.startsWith(`..${sep}`)
  ) {
    throw new RangeError('Git 变更路径不在仓库内');
  }
  return path;
}

function toRawChange(
  repositoryRoot: string,
  change: BuiltinChange,
  layer: ChangeLayer,
  forceConflict = false,
): RawChange | undefined {
  if (change.status === 8) {
    return undefined;
  }
  const kind = forceConflict ? 'conflicted' : STATUS_KIND.get(change.status);
  if (kind === undefined) {
    throw new RangeError(`未知的 Git 状态：${String(change.status)}`);
  }
  const originalPath = kind !== 'renamed' || change.originalUri === undefined
    ? undefined
    : relativeGitPath(repositoryRoot, change.originalUri);
  return {
    path: relativeGitPath(repositoryRoot, change.uri),
    ...(originalPath === undefined ? {} : { originalPath }),
    kind,
    layer,
  };
}

function mapChanges(
  repositoryRoot: string,
  changes: readonly BuiltinChange[],
  layer: ChangeLayer,
  forceConflict = false,
): RawChange[] {
  return changes.flatMap((change) => {
    const mapped = toRawChange(
      repositoryRoot,
      change,
      layer,
      forceConflict,
    );
    return mapped === undefined ? [] : [mapped];
  });
}

function selectedFiles(
  state: RepositoryState,
  selectedIds: readonly string[],
): readonly FileChange[] {
  const byId = new Map(state.changes.map((change) => [change.id, change]));
  return [...new Set(selectedIds)].map((id) => {
    const change = byId.get(id);
    if (change === undefined) {
      throw new Error(`文件 ${id} 不属于当前仓库状态`);
    }
    return change;
  });
}

export class RepositoryService implements vscode.Disposable {
  private readonly selectionStore: SelectionStore;
  private readonly operationLock: RepositoryOperationLock;
  private readonly repositories = new Map<string, RepositoryState>();
  private readonly lifecycleListeners: readonly vscode.Disposable[];
  private currentRepositoryId: string | undefined;
  private disposed = false;

  constructor(private readonly dependencies: RepositoryServiceDependencies) {
    this.selectionStore = dependencies.selectionStore ?? new SelectionStore();
    this.operationLock = dependencies.operationLock
      ?? new RepositoryOperationLock();

    for (const repository of dependencies.gitApi.repositories) {
      this.addRepository(repository);
    }
    this.lifecycleListeners = [
      dependencies.gitApi.onDidOpenRepository((repository) => {
        this.addRepository(repository);
      }),
      dependencies.gitApi.onDidCloseRepository((repository) => {
        this.removeRepository(repository);
      }),
    ];
  }

  getViewModel(): RepositoryViewModel {
    const state = this.currentRepositoryId === undefined
      ? undefined
      : this.repositories.get(this.currentRepositoryId);
    const head = state?.repository.state.HEAD;
    const upstream = head?.upstream;
    return {
      version: state?.version ?? 0,
      trusted: this.dependencies.isWorkspaceTrusted(),
      ...(state === undefined ? {} : { currentRepositoryId: state.id }),
      repositories: [...this.repositories.values()].map((item) => ({
        id: item.id,
        label: basename(item.rootPath) || item.rootPath,
        rootPath: item.rootPath,
      })),
      ...(head?.name === undefined ? {} : { branch: head.name }),
      ...(upstream === undefined
        ? {}
        : { upstream: `${upstream.remote}/${upstream.name}` }),
      detached: state !== undefined && head?.name === undefined,
      changes: state?.changes ?? [],
      selectedIds: state === undefined ? [] : [...state.selectedIds],
      commitMessage: state?.commitMessage ?? '',
      operation: state?.operation ?? { kind: 'idle' },
    };
  }

  selectRepository(id: string): RepositoryViewModel {
    if (!this.repositories.has(id)) {
      throw new Error('仓库不存在或已关闭');
    }
    this.currentRepositoryId = id;
    return this.getViewModel();
  }

  async refresh(): Promise<RepositoryViewModel> {
    const state = this.getCurrentState();
    await state.repository.status();
    this.synchronizeState(state, false);
    return this.getViewModel();
  }

  setFileSelected(fileId: string, selected: boolean): RepositoryViewModel {
    const state = this.getCurrentState();
    if (!state.changes.some((change) => change.id === fileId)) {
      throw new Error(`文件 ${fileId} 不属于当前仓库状态`);
    }
    this.selectionStore.setSelected(state.id, fileId, selected);
    state.selectedIds = this.selectionStore.reconcile(state.id, state.changes);
    return this.getViewModel();
  }

  setGroup(
    group: 'tracked' | 'untracked',
    selected: boolean,
  ): RepositoryViewModel {
    const state = this.getCurrentState();
    const ids = state.changes
      .filter((change) => group === 'untracked'
        ? change.untracked
        : !change.untracked)
      .map((change) => change.id);
    this.selectionStore.setGroup(state.id, ids, selected);
    state.selectedIds = this.selectionStore.reconcile(state.id, state.changes);
    return this.getViewModel();
  }

  setCommitMessage(message: string): RepositoryViewModel {
    const state = this.getCurrentState();
    state.commitMessage = message;
    return this.getViewModel();
  }

  async commit(request: RepositoryCommitRequest): Promise<CommitResult> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
      request.selectedIds,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => await this.commitUnlocked(context, request),
    );
  }

  async commitAndPush(
    request: RepositoryCommitRequest,
  ): Promise<PushResult> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
      request.selectedIds,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => {
        const commitResult = await this.commitUnlocked(context, request);
        const localBranch = context.state.repository.state.HEAD?.name ?? '';
        context.state.pendingPush = {
          commitHash: commitResult.commitHash,
          localBranch,
        };
        return await this.pushPending(context.state);
      },
    );
  }

  async selectPushRemote(
    request: SelectPushRemoteRequest,
  ): Promise<PushResult> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => {
        const pending = this.requirePendingPush(context.state);
        context.state.pendingPush = {
          ...pending,
          selectedRemote: request.remote,
        };
        return await this.pushPending(context.state);
      },
    );
  }

  async retryPush(request: RepositoryVersionRequest): Promise<PushResult> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => {
        this.requirePendingPush(context.state);
        return await this.pushPending(context.state);
      },
    );
  }

  async trash(request: TrashRequest): Promise<TrashResult> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
      request.fileIds,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => await this.runOperation(
        context.state,
        'trash',
        async () => await this.dependencies.trashService.moveToTrash(
          context.state.rootPath,
          context.files.map((file) => file.path),
        ),
      ),
    );
  }

  async setRemoteUrl(request: SetRemoteUrlRequest): Promise<RemoteInfo> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => await this.runOperation(
        context.state,
        'remote',
        async () => await this.dependencies.remoteService.setUrl(
          context.state.rootPath,
          request.remote,
          request.url,
        ),
      ),
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const listener of this.lifecycleListeners) {
      listener.dispose();
    }
    for (const state of this.repositories.values()) {
      state.changeListener.dispose();
    }
    this.repositories.clear();
    this.currentRepositoryId = undefined;
  }

  private addRepository(repository: BuiltinRepository): void {
    if (this.disposed) {
      return;
    }
    const id = repositoryId(repository);
    const existing = this.repositories.get(id);
    if (existing !== undefined) {
      if (existing.repository === repository) {
        return;
      }
      existing.changeListener.dispose();
      this.repositories.delete(id);
    }

    const state: RepositoryState = {
      id,
      rootPath: id,
      repository,
      changeListener: { dispose: () => undefined },
      version: 0,
      changes: [],
      selectedIds: new Set<string>(),
      commitMessage: '',
      operation: { kind: 'idle' },
    };
    state.changeListener = repository.state.onDidChange(() => {
      this.synchronizeState(state, true);
    });
    this.repositories.set(id, state);
    this.synchronizeState(state, false);
    this.currentRepositoryId ??= id;
  }

  private removeRepository(repository: BuiltinRepository): void {
    const id = repositoryId(repository);
    const state = this.repositories.get(id);
    if (state?.repository !== repository) {
      return;
    }
    state.changeListener.dispose();
    this.repositories.delete(id);
    if (this.currentRepositoryId === id) {
      this.currentRepositoryId = this.repositories.keys().next().value;
    }
  }

  private synchronizeState(
    state: RepositoryState,
    incrementVersion: boolean,
  ): void {
    const repositoryState = state.repository.state;
    const indexChanges = mapChanges(
      state.rootPath,
      repositoryState.indexChanges,
      'index',
    );
    const workingChanges = [
      ...mapChanges(
        state.rootPath,
        repositoryState.workingTreeChanges,
        'working',
      ),
      ...mapChanges(
        state.rootPath,
        repositoryState.mergeChanges,
        'working',
        true,
      ),
    ];
    const untrackedChanges = mapChanges(
      state.rootPath,
      repositoryState.untrackedChanges,
      'untracked',
    );
    state.changes = mergeChanges(
      indexChanges,
      workingChanges,
      untrackedChanges,
    );
    state.selectedIds = this.selectionStore.reconcile(state.id, state.changes);
    if (incrementVersion) {
      state.version += 1;
    }
  }

  private getCurrentState(): RepositoryState {
    if (this.currentRepositoryId === undefined) {
      throw new Error('当前没有打开的 Git 仓库');
    }
    const state = this.repositories.get(this.currentRepositoryId);
    if (state === undefined) {
      throw new Error('当前仓库不存在或已关闭');
    }
    return state;
  }

  private prepareWrite(
    id: string,
    version: number,
    fileIds: readonly string[] = [],
  ): WriteContext {
    if (!this.dependencies.isWorkspaceTrusted()) {
      throw new Error('未信任的工作区不能执行写操作');
    }
    const state = this.repositories.get(id);
    if (state === undefined) {
      throw new Error('仓库不存在或已关闭');
    }
    if (state.version !== version) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }
    if (state.changes.some((change) => change.conflicted)) {
      throw new Error('存在冲突文件，不能执行写操作');
    }
    return {
      state,
      files: selectedFiles(state, fileIds),
    };
  }

  private async commitUnlocked(
    context: WriteContext,
    request: RepositoryCommitRequest,
  ): Promise<CommitResult> {
    context.state.operation = { kind: 'running', action: 'commit' };
    try {
      const result = await this.dependencies.commitService.commit({
        repositoryRoot: context.state.rootPath,
        message: request.message,
        expectedVersion: request.version,
        verifyVersion: (expectedVersion) => Promise.resolve(
          context.state.version === expectedVersion,
        ),
        files: context.files,
      });
      context.state.operation = {
        kind: 'commit-succeeded',
        commitHash: result.commitHash,
      };
      return result;
    } catch (error) {
      context.state.operation = {
        kind: 'failed',
        action: 'commit',
        message: errorMessage(error),
      };
      throw error;
    }
  }

  private requirePendingPush(state: RepositoryState): PendingPush {
    if (state.pendingPush === undefined) {
      throw new Error('没有可重试的推送');
    }
    return state.pendingPush;
  }

  private async pushPending(state: RepositoryState): Promise<PushResult> {
    const pending = this.requirePendingPush(state);
    state.operation = { kind: 'running', action: 'push' };
    try {
      const result = await this.dependencies.pushService.push(
        state.repository,
        {
          ...(pending.selectedRemote === undefined
            ? {}
            : { selectedRemote: pending.selectedRemote }),
          localBranch: pending.localBranch,
        },
      );
      state.operation = {
        kind: 'commit-succeeded',
        commitHash: pending.commitHash,
      };
      if (result.kind === 'pushed') {
        delete state.pendingPush;
      }
      return result;
    } catch (error) {
      state.operation = {
        kind: 'push-failed',
        commitHash: pending.commitHash,
        message: errorMessage(error),
      };
      throw error;
    }
  }

  private async runOperation<T>(
    state: RepositoryState,
    action: 'trash' | 'remote',
    operation: () => Promise<T>,
  ): Promise<T> {
    state.operation = { kind: 'running', action };
    try {
      const result = await operation();
      state.operation = { kind: 'idle' };
      return result;
    } catch (error) {
      state.operation = {
        kind: 'failed',
        action,
        message: errorMessage(error),
      };
      throw error;
    }
  }
}
