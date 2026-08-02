import { basename, resolve } from 'node:path';
import type * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import { SelectionStore } from '../domain/selection-store.js';
import type {
  AiState,
  HistoryState,
  OperationState,
  RepositoryViewModel,
  SyncState,
} from '../domain/view-model.js';
import type {
  BuiltinGitApi,
  BuiltinRepository,
} from '../git/builtin-git-api.js';
import { mapRepositoryChanges } from './git-status-mapper.js';

export interface RepositoryContext {
  readonly id: string;
  readonly rootPath: string;
  readonly repository: BuiltinRepository;
  changeListener: vscode.Disposable;
  version: number;
  snapshot: RepositorySnapshot;
  changes: readonly FileChange[];
  selectedIds: ReadonlySet<string>;
  commitMessage: string;
  operation: OperationState;
  sync: SyncState;
  history: HistoryState;
  ai: AiState;
}

interface RepositoryHeadSnapshot {
  readonly present: boolean;
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: {
    readonly remote: string;
    readonly name: string;
  };
}

interface RepositoryRemoteSnapshot {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

interface RepositorySnapshot {
  readonly changes: readonly FileChange[];
  readonly head: RepositoryHeadSnapshot;
  readonly remotes: readonly RepositoryRemoteSnapshot[];
}

function repositoryId(repository: BuiltinRepository): string {
  return resolve(repository.rootUri.fsPath);
}

function captureSnapshot(
  rootPath: string,
  repository: BuiltinRepository,
): RepositorySnapshot {
  const head = repository.state.HEAD;
  return {
    changes: mapRepositoryChanges(rootPath, repository.state),
    head: {
      present: head !== undefined,
      ...(head?.name === undefined ? {} : { name: head.name }),
      ...(head?.commit === undefined ? {} : { commit: head.commit }),
      ...(head?.upstream === undefined
        ? {}
        : {
            upstream: {
              remote: head.upstream.remote,
              name: head.upstream.name,
            },
          }),
    },
    remotes: repository.state.remotes
      .map((remote) => ({
        name: remote.name,
        ...(remote.fetchUrl === undefined
          ? {}
          : { fetchUrl: remote.fetchUrl }),
        ...(remote.pushUrl === undefined
          ? {}
          : { pushUrl: remote.pushUrl }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function snapshotKey(snapshot: RepositorySnapshot): string {
  return JSON.stringify(snapshot);
}

export class RepositoryRegistry implements vscode.Disposable {
  private readonly repositories = new Map<string, RepositoryContext>();
  private readonly lastVersions = new Map<string, number>();
  private readonly changeListeners = new Set<() => unknown>();
  private readonly repositoryAddedListeners = new Set<(id: string) => unknown>();
  private readonly lifecycleListeners: vscode.Disposable[] = [];
  private currentRepositoryId: string | undefined;
  private disposed = false;

  readonly onDidChange: vscode.Event<void> = (
    listener,
    thisArgs,
    disposables,
  ) => {
    const effectiveListener = thisArgs === undefined
      ? (): unknown => listener()
      : (): unknown => listener.call(thisArgs);
    this.changeListeners.add(effectiveListener);
    const disposable: vscode.Disposable = {
      dispose: () => {
        this.changeListeners.delete(effectiveListener);
      },
    };
    disposables?.push(disposable);
    return disposable;
  };

  readonly onDidAddRepository: vscode.Event<string> = (
    listener,
    thisArgs,
    disposables,
  ) => {
    const effectiveListener = thisArgs === undefined
      ? (id: string): unknown => listener(id)
      : (id: string): unknown => listener.call(thisArgs, id);
    this.repositoryAddedListeners.add(effectiveListener);
    const disposable: vscode.Disposable = {
      dispose: () => {
        this.repositoryAddedListeners.delete(effectiveListener);
      },
    };
    disposables?.push(disposable);
    return disposable;
  };

  constructor(
    gitApi: BuiltinGitApi,
    private readonly selectionStore = new SelectionStore(),
  ) {
    try {
      for (const repository of gitApi.repositories) {
        this.addRepository(repository);
      }
      this.lifecycleListeners.push(
        gitApi.onDidOpenRepository((repository) => {
          this.addRepository(repository);
        }),
        gitApi.onDidCloseRepository((repository) => {
          this.removeRepository(repository);
        }),
      );
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  getViewModel(trusted: boolean): RepositoryViewModel {
    const state = this.currentRepositoryId === undefined
      ? undefined
      : this.repositories.get(this.currentRepositoryId);
    const head = state?.snapshot.head;
    const upstream = head?.upstream;
    return {
      version: state?.version ?? 0,
      trusted,
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
      hasRemote: (state?.repository.state.remotes.length ?? 0) > 0,
      hasHeadCommit: head?.commit !== undefined,
      changes: state?.changes ?? [],
      changeCount: state?.changes.length ?? 0,
      selectedIds: state === undefined ? [] : [...state.selectedIds],
      commitMessage: state?.commitMessage ?? '',
      operation: state?.operation ?? { kind: 'idle' },
      sync: state?.sync ?? { kind: 'no-upstream' },
      history: state?.history ?? { kind: 'idle', commits: [] },
      ai: state?.ai ?? { kind: 'idle' },
    };
  }

  selectRepository(id: string, trusted: boolean): RepositoryViewModel {
    if (!this.repositories.has(id)) {
      throw new Error('仓库不存在或已关闭');
    }
    this.currentRepositoryId = id;
    const model = this.getViewModel(trusted);
    this.notifyChange();
    return model;
  }

  async refresh(trusted: boolean): Promise<RepositoryViewModel> {
    const state = this.getCurrent();
    await this.refreshSnapshot(state);
    const model = this.getViewModel(trusted);
    this.notifyChange();
    return model;
  }

  async refreshRepositorySnapshot(id: string): Promise<RepositoryContext> {
    const state = this.repositories.get(id);
    if (state === undefined) {
      throw new Error('仓库不存在或已关闭');
    }
    await this.refreshSnapshot(state);
    this.notifyChange();
    return state;
  }

  async refreshAndValidateWriteSnapshot(
    id: string,
    expectedVersion: number,
  ): Promise<RepositoryContext> {
    const state = this.repositories.get(id);
    if (state === undefined) {
      throw new Error('仓库不存在或已关闭');
    }
    if (state.version !== expectedVersion) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }

    const previousSnapshotKey = snapshotKey(state.snapshot);
    await state.repository.status();
    if (
      this.repositories.get(id) !== state
      || state.version !== expectedVersion
    ) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }

    const refreshedSnapshot = captureSnapshot(
      state.rootPath,
      state.repository,
    );
    if (snapshotKey(refreshedSnapshot) !== previousSnapshotKey) {
      this.applySnapshot(state, refreshedSnapshot, true);
      this.notifyChange();
      throw new Error('仓库状态已变化，请刷新后重试');
    }
    return state;
  }

  setFileSelected(
    fileId: string,
    selected: boolean,
    trusted: boolean,
  ): RepositoryViewModel {
    const state = this.getCurrent();
    if (!state.changes.some((change) => change.id === fileId)) {
      throw new Error(`文件 ${fileId} 不属于当前仓库状态`);
    }
    this.selectionStore.setSelected(state.id, fileId, selected);
    state.selectedIds = this.selectionStore.reconcile(state.id, state.changes);
    if (state.ai.kind === 'generating') {
      state.ai = { kind: 'idle' };
    }
    const model = this.getViewModel(trusted);
    this.notifyChange();
    return model;
  }

  setGroup(
    group: 'tracked' | 'untracked',
    selected: boolean,
    trusted: boolean,
  ): RepositoryViewModel {
    const state = this.getCurrent();
    const ids = state.changes
      .filter((change) => group === 'untracked'
        ? change.untracked
        : !change.untracked)
      .map((change) => change.id);
    this.selectionStore.setGroup(state.id, ids, selected);
    state.selectedIds = this.selectionStore.reconcile(state.id, state.changes);
    if (state.ai.kind === 'generating') {
      state.ai = { kind: 'idle' };
    }
    const model = this.getViewModel(trusted);
    this.notifyChange();
    return model;
  }

  setCommitMessage(
    message: string,
    trusted: boolean,
  ): RepositoryViewModel {
    const state = this.getCurrent();
    state.commitMessage = message;
    const model = this.getViewModel(trusted);
    this.notifyChange();
    return model;
  }

  get(id: string): RepositoryContext | undefined {
    return this.repositories.get(id);
  }

  reportFailure(action: string, message: string): boolean {
    if (this.currentRepositoryId === undefined) {
      return false;
    }
    const state = this.repositories.get(this.currentRepositoryId);
    if (state === undefined) {
      return false;
    }
    state.operation = { kind: 'failed', action, message };
    this.notifyChange();
    return true;
  }

  reportPushFailure(commitHash: string, message: string): boolean {
    if (this.currentRepositoryId === undefined) {
      return false;
    }
    const state = this.repositories.get(this.currentRepositoryId);
    if (state === undefined) {
      return false;
    }
    state.operation = { kind: 'push-failed', commitHash, message };
    this.notifyChange();
    return true;
  }

  notifyChange(): void {
    for (const listener of [...this.changeListeners]) {
      listener();
    }
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
    this.changeListeners.clear();
    this.repositoryAddedListeners.clear();
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
      this.lastVersions.set(id, existing.version);
      this.repositories.delete(id);
    }

    const lastVersion = this.lastVersions.get(id);
    const snapshot = captureSnapshot(id, repository);
    const state: RepositoryContext = {
      id,
      rootPath: id,
      repository,
      changeListener: { dispose: () => undefined },
      version: lastVersion === undefined ? 0 : lastVersion + 1,
      snapshot,
      changes: [],
      selectedIds: new Set<string>(),
      commitMessage: '',
      operation: { kind: 'idle' },
      sync: this.syncFromSnapshot(snapshot),
      history: { kind: 'idle', commits: [] },
      ai: { kind: 'idle' },
    };
    state.changeListener = repository.state.onDidChange(() => {
      this.synchronizeStateIfChanged(state, true);
      this.notifyChange();
    });
    this.repositories.set(id, state);
    this.applySnapshot(state, state.snapshot, false);
    this.currentRepositoryId ??= id;
    this.notifyChange();
    for (const listener of this.repositoryAddedListeners) {
      listener(id);
    }
  }

  private removeRepository(repository: BuiltinRepository): void {
    const id = repositoryId(repository);
    const state = this.repositories.get(id);
    if (state === undefined) {
      return;
    }
    state.changeListener.dispose();
    this.lastVersions.set(id, state.version);
    this.repositories.delete(id);
    if (this.currentRepositoryId === id) {
      this.currentRepositoryId = this.repositories.keys().next().value;
    }
    this.notifyChange();
  }

  private synchronizeStateIfChanged(
    state: RepositoryContext,
    incrementVersion: boolean,
  ): boolean {
    const snapshot = captureSnapshot(
      state.rootPath,
      state.repository,
    );
    if (snapshotKey(snapshot) === snapshotKey(state.snapshot)) {
      return false;
    }
    this.applySnapshot(state, snapshot, incrementVersion);
    return true;
  }

  private async refreshSnapshot(state: RepositoryContext): Promise<void> {
    await state.repository.status();
    if (this.repositories.get(state.id) !== state) {
      throw new Error('仓库不存在或已关闭');
    }
    this.synchronizeStateIfChanged(state, true);
  }

  private applySnapshot(
    state: RepositoryContext,
    snapshot: RepositorySnapshot,
    incrementVersion: boolean,
  ): void {
    state.snapshot = snapshot;
    state.changes = snapshot.changes;
    state.selectedIds = this.selectionStore.reconcile(
      state.id,
      snapshot.changes,
    );
    if (incrementVersion) {
      state.version += 1;
      if (state.history.kind === 'loading') {
        state.history = { kind: 'idle', commits: state.history.commits };
      }
      if (state.ai.kind === 'generating') {
        state.ai = { kind: 'idle' };
      }
    }
    if (snapshot.head.name === undefined) {
      state.sync = { kind: 'detached' };
    } else if (snapshot.head.upstream === undefined) {
      state.sync = { kind: 'no-upstream' };
    } else if (state.sync.kind !== 'ready'
      || state.sync.upstream !== `${snapshot.head.upstream.remote}/${snapshot.head.upstream.name}`) {
      state.sync = {
        kind: 'ready',
        upstream: `${snapshot.head.upstream.remote}/${snapshot.head.upstream.name}`,
        ahead: 0,
        behind: 0,
      };
    }
  }

  private syncFromSnapshot(snapshot: RepositorySnapshot): SyncState {
    if (snapshot.head.name === undefined) {
      return snapshot.head.present
        ? { kind: 'detached' }
        : { kind: 'no-upstream' };
    }
    if (snapshot.head.upstream === undefined) {
      return { kind: 'no-upstream' };
    }
    return {
      kind: 'ready',
      upstream: `${snapshot.head.upstream.remote}/${snapshot.head.upstream.name}`,
      ahead: 0,
      behind: 0,
    };
  }

  private getCurrent(): RepositoryContext {
    if (this.currentRepositoryId === undefined) {
      throw new Error('当前没有打开的 Git 仓库');
    }
    const state = this.repositories.get(this.currentRepositoryId);
    if (state === undefined) {
      throw new Error('当前仓库不存在或已关闭');
    }
    return state;
  }
}
