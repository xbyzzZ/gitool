import { basename, resolve } from 'node:path';
import type * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import { SelectionStore } from '../domain/selection-store.js';
import type {
  OperationState,
  RepositoryViewModel,
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
  changes: readonly FileChange[];
  selectedIds: ReadonlySet<string>;
  commitMessage: string;
  operation: OperationState;
}

function repositoryId(repository: BuiltinRepository): string {
  return resolve(repository.rootUri.fsPath);
}

export class RepositoryRegistry implements vscode.Disposable {
  private readonly repositories = new Map<string, RepositoryContext>();
  private readonly lastVersions = new Map<string, number>();
  private readonly lifecycleListeners: readonly vscode.Disposable[];
  private currentRepositoryId: string | undefined;
  private disposed = false;

  constructor(
    gitApi: BuiltinGitApi,
    private readonly selectionStore = new SelectionStore(),
  ) {
    for (const repository of gitApi.repositories) {
      this.addRepository(repository);
    }
    this.lifecycleListeners = [
      gitApi.onDidOpenRepository((repository) => {
        this.addRepository(repository);
      }),
      gitApi.onDidCloseRepository((repository) => {
        this.removeRepository(repository);
      }),
    ];
  }

  getViewModel(trusted: boolean): RepositoryViewModel {
    const state = this.currentRepositoryId === undefined
      ? undefined
      : this.repositories.get(this.currentRepositoryId);
    const head = state?.repository.state.HEAD;
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
      changes: state?.changes ?? [],
      selectedIds: state === undefined ? [] : [...state.selectedIds],
      commitMessage: state?.commitMessage ?? '',
      operation: state?.operation ?? { kind: 'idle' },
    };
  }

  selectRepository(id: string, trusted: boolean): RepositoryViewModel {
    if (!this.repositories.has(id)) {
      throw new Error('仓库不存在或已关闭');
    }
    this.currentRepositoryId = id;
    return this.getViewModel(trusted);
  }

  async refresh(trusted: boolean): Promise<RepositoryViewModel> {
    const state = this.getCurrent();
    await state.repository.status();
    this.synchronizeState(state, false);
    return this.getViewModel(trusted);
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
    return this.getViewModel(trusted);
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
    return this.getViewModel(trusted);
  }

  setCommitMessage(
    message: string,
    trusted: boolean,
  ): RepositoryViewModel {
    const state = this.getCurrent();
    state.commitMessage = message;
    return this.getViewModel(trusted);
  }

  get(id: string): RepositoryContext | undefined {
    return this.repositories.get(id);
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
      this.lastVersions.set(id, existing.version);
      this.repositories.delete(id);
    }

    const lastVersion = this.lastVersions.get(id);
    const state: RepositoryContext = {
      id,
      rootPath: id,
      repository,
      changeListener: { dispose: () => undefined },
      version: lastVersion === undefined ? 0 : lastVersion + 1,
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
    if (state === undefined) {
      return;
    }
    state.changeListener.dispose();
    this.lastVersions.set(id, state.version);
    this.repositories.delete(id);
    if (this.currentRepositoryId === id) {
      this.currentRepositoryId = this.repositories.keys().next().value;
    }
  }

  private synchronizeState(
    state: RepositoryContext,
    incrementVersion: boolean,
  ): void {
    state.changes = mapRepositoryChanges(
      state.rootPath,
      state.repository.state,
    );
    state.selectedIds = this.selectionStore.reconcile(state.id, state.changes);
    if (incrementVersion) {
      state.version += 1;
    }
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
