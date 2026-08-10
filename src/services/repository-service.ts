import { SelectionStore } from '../domain/selection-store.js';
import type * as vscode from 'vscode';
import type { FileChange } from '../domain/change-model.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { CommitDetails, HistoryView, AheadBehind } from '../domain/history-model.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import type { BuiltinRepository } from '../git/builtin-git-api.js';
import type { CommitResult } from './commit-service.js';
import type {
  AiLanguageModel,
  CommitMessageDensity,
  GenerateCommitMessageResult,
} from './commit-message-ai-service.js';
import { RepositoryOperationLock } from './operation-lock.js';
import type { PushResult } from './push-service.js';
import { RepositoryRegistry } from './repository-registry.js';
import type { RemoteInfo } from './remote-service.js';
import type { TrashResult } from './trash-service.js';
import type { SyncService } from './sync-service.js';
import {
  RepositoryWriteCoordinator,
  type AddRemoteRequest,
  type RepositoryCommitRequest,
  type RepositoryVersionRequest,
  type RepositoryWriteCoordinatorDependencies,
  type SelectPushRemoteRequest,
  type SetRemoteUrlRequest,
  type TrashRequest,
} from './repository-write-coordinator.js';

export type {
  AddRemoteRequest,
  RepositoryCommitRequest,
  RepositoryVersionRequest,
  SelectPushRemoteRequest,
  SetRemoteUrlRequest,
  TrashRequest,
} from './repository-write-coordinator.js';

export interface RepositoryServiceDependencies {
  readonly gitApi: BuiltinGitApi;
  readonly selectionStore?: SelectionStore;
  readonly commitService:
    RepositoryWriteCoordinatorDependencies['commitService'];
  readonly pushService:
    RepositoryWriteCoordinatorDependencies['pushService'];
  readonly trashService:
    RepositoryWriteCoordinatorDependencies['trashService'];
  readonly remoteService:
    RepositoryWriteCoordinatorDependencies['remoteService'];
  readonly operationLock?: RepositoryOperationLock;
  readonly historyService?: {
    list(repositoryRoot: string, limit?: number): Promise<HistoryView>;
    details(repositoryRoot: string, hash: string): Promise<CommitDetails>;
    aheadBehind(repositoryRoot: string): Promise<AheadBehind>;
  };
  readonly syncService?: Pick<SyncService, 'fetch' | 'pull' | 'pushAll'>
    & Partial<Pick<SyncService, 'aheadBehind'>>;
  readonly aiService?: {
    listModels(): Promise<readonly AiLanguageModel[]>;
    generate(request: {
      readonly repositoryRoot: string;
      readonly selectedPaths: readonly string[];
      readonly density: CommitMessageDensity;
      readonly modelId?: string;
    }, signal?: AbortSignal): Promise<GenerateCommitMessageResult>;
  };
  readonly isWorkspaceTrusted: () => boolean;
}

export interface GenerateRepositoryCommitMessageRequest
  extends RepositoryVersionRequest {
  readonly selectedIds: readonly string[];
  readonly density: CommitMessageDensity;
  readonly modelId?: string;
}

export interface LoadCommitDetailsRequest extends RepositoryVersionRequest {
  readonly hash: string;
}

export interface PushAllRepositoryRequest extends RepositoryVersionRequest {
  readonly selectedRemote?: string;
}

export class RepositoryService {
  private readonly registry: RepositoryRegistry;
  private readonly writeCoordinator: RepositoryWriteCoordinator;
  private readonly operationLock: RepositoryOperationLock;
  private readonly lifecycleListeners: vscode.Disposable[] = [];

  constructor(private readonly dependencies: RepositoryServiceDependencies) {
    this.operationLock = dependencies.operationLock
      ?? new RepositoryOperationLock();
    this.registry = new RepositoryRegistry(
      dependencies.gitApi,
      dependencies.selectionStore,
    );
    this.lifecycleListeners.push(
      this.registry.onDidAddRepository((id) => {
        void this.initializeOpenedRepository(id).catch((error: unknown) => {
          if (this.registry.get(id) !== undefined) {
            this.registry.reportFailure(
              '初始化仓库',
              this.errorMessage(error),
            );
          }
        });
      }),
    );
    this.writeCoordinator = new RepositoryWriteCoordinator({
      registry: this.registry,
      commitService: dependencies.commitService,
      pushService: dependencies.pushService,
      trashService: dependencies.trashService,
      remoteService: dependencies.remoteService,
      operationLock: this.operationLock,
      isWorkspaceTrusted: dependencies.isWorkspaceTrusted,
    });
  }

  readonly onDidChange: vscode.Event<void> = (
    listener,
    thisArgs,
    disposables,
  ) => this.registry.onDidChange(
    listener,
    thisArgs,
    disposables,
  );

  getViewModel(): RepositoryViewModel {
    return this.registry.getViewModel(
      this.dependencies.isWorkspaceTrusted(),
    );
  }

  getRepository(id: string): BuiltinRepository | undefined {
    return this.registry.get(id)?.repository;
  }

  getFileChange(id: string, fileId: string): FileChange | undefined {
    return this.registry.get(id)?.changes.find(
      (change) => change.id === fileId,
    );
  }

  reportFailure(action: string, message: string): boolean {
    return this.registry.reportFailure(action, message);
  }

  reportPushFailure(commitHash: string, message: string): boolean {
    return this.registry.reportPushFailure(commitHash, message);
  }

  selectRepository(id: string): RepositoryViewModel {
    const model = this.registry.selectRepository(
      id,
      this.dependencies.isWorkspaceTrusted(),
    );
    if (this.dependencies.historyService !== undefined) {
      void this.refreshHistory({
        repositoryId: id,
        version: model.version,
      }).catch(() => undefined);
    } else {
      void this.refreshSyncStatus({
        repositoryId: id,
        version: model.version,
      }).catch(() => undefined);
    }
    return model;
  }

  async refresh(): Promise<RepositoryViewModel> {
    const model = await this.registry.refresh(
      this.dependencies.isWorkspaceTrusted(),
    );
    if (model.currentRepositoryId !== undefined
      && this.dependencies.historyService !== undefined) {
      await this.refreshHistory({
        repositoryId: model.currentRepositoryId,
        version: model.version,
      });
    } else if (model.currentRepositoryId !== undefined) {
      await this.refreshSyncStatus({
        repositoryId: model.currentRepositoryId,
        version: model.version,
      });
    }
    return this.getViewModel();
  }

  async refreshHistory(request: RepositoryVersionRequest): Promise<void> {
    const historyService = this.dependencies.historyService;
    if (historyService === undefined) {
      throw new Error('提交历史服务尚未配置');
    }
    const state = this.requireVersion(request);
    const previousCommits = state.history.commits;
    state.history = { kind: 'loading', commits: previousCommits };
    this.registry.notifyChange();
    try {
      const [history, aheadBehind] = await Promise.all([
        historyService.list(state.rootPath),
        historyService.aheadBehind(state.rootPath),
      ]);
      if (!this.matches(state, request.version)) {
        return;
      }
      state.history = { kind: 'ready', commits: history.commits };
      state.sync = state.repository.state.HEAD?.name === undefined
        ? { kind: 'detached' }
        : aheadBehind;
      this.registry.notifyChange();
    } catch (error) {
      if (this.matches(state, request.version)) {
        state.history = {
          kind: 'failed',
          commits: previousCommits,
          message: this.errorMessage(error),
        };
        this.registry.notifyChange();
      }
      throw error;
    }
  }

  async loadCommitDetails(
    request: LoadCommitDetailsRequest,
  ): Promise<CommitDetails> {
    const historyService = this.dependencies.historyService;
    if (historyService === undefined) {
      throw new Error('提交历史服务尚未配置');
    }
    const state = this.requireVersion(request);
    const details = await historyService.details(state.rootPath, request.hash);
    if (!this.matches(state, request.version)) {
      throw new Error('仓库状态已变化，请重新打开提交详情');
    }
    return details;
  }

  async fetchHistory(request: RepositoryVersionRequest): Promise<void> {
    await this.runSync(request, 'fetch', async (repository) => {
      await this.requireSyncService().fetch(repository);
    });
  }

  async pull(request: RepositoryVersionRequest): Promise<void> {
    await this.runSync(request, 'pull', async (repository) => {
      await this.requireSyncService().pull(repository);
    });
  }

  async pushAll(request: PushAllRepositoryRequest): Promise<PushResult> {
    let result: PushResult | undefined;
    await this.runSync(request, 'push', async (repository, state) => {
      if (state.sync.kind === 'detached') {
        throw new Error('当前处于游离 HEAD，不能推送');
      }
      result = await this.requireSyncService().pushAll(repository, {
        localBranch: state.snapshot.head.name ?? '',
        ahead: state.sync.kind === 'ready' ? state.sync.ahead : 1,
        behind: state.sync.kind === 'ready' ? state.sync.behind : 0,
        ...(request.selectedRemote === undefined
          ? {}
          : { selectedRemote: request.selectedRemote }),
      });
    });
    if (result === undefined) {
      throw new Error('推送未返回结果');
    }
    return result;
  }

  async listAiModels(): Promise<readonly AiLanguageModel[]> {
    const aiService = this.dependencies.aiService;
    if (aiService === undefined) {
      throw new Error('AI 提交信息服务尚未配置');
    }
    return await aiService.listModels();
  }

  async generateCommitMessage(
    request: GenerateRepositoryCommitMessageRequest,
    signal?: AbortSignal,
  ): Promise<GenerateCommitMessageResult> {
    const aiService = this.dependencies.aiService;
    if (aiService === undefined) {
      throw new Error('AI 提交信息服务尚未配置');
    }
    const state = this.requireVersion(request);
    if (!this.sameIds(state.selectedIds, request.selectedIds)) {
      throw new Error('所选文件已变化，请重新生成提交信息');
    }
    const paths = request.selectedIds.map((id) => {
      const change = state.changes.find((item) => item.id === id);
      if (change === undefined) {
        throw new Error(`文件 ${id} 不属于当前仓库状态`);
      }
      return change.path;
    });
    state.ai = { kind: 'generating', density: request.density };
    this.registry.notifyChange();
    try {
      const result = await aiService.generate({
        repositoryRoot: state.rootPath,
        selectedPaths: paths,
        density: request.density,
        ...(request.modelId === undefined
          ? {}
          : { modelId: request.modelId }),
      }, signal);
      if (!this.matches(state, request.version)
        || !this.sameIds(state.selectedIds, request.selectedIds)) {
        throw new Error('仓库状态已变化，本次生成结果已丢弃');
      }
      state.commitMessage = result.message;
      state.ai = { kind: 'idle' };
      this.registry.notifyChange();
      return result;
    } catch (error) {
      if (signal?.aborted === true && this.matches(state, request.version)) {
        state.ai = { kind: 'idle' };
        this.registry.notifyChange();
        throw error;
      }
      if (this.matches(state, request.version)
        && this.sameIds(state.selectedIds, request.selectedIds)) {
        state.ai = { kind: 'failed', message: this.errorMessage(error) };
        this.registry.notifyChange();
      }
      throw error;
    }
  }

  setFileSelected(fileId: string, selected: boolean): RepositoryViewModel {
    return this.registry.setFileSelected(
      fileId,
      selected,
      this.dependencies.isWorkspaceTrusted(),
    );
  }

  setGroup(
    group: 'tracked' | 'untracked',
    selected: boolean,
  ): RepositoryViewModel {
    return this.registry.setGroup(
      group,
      selected,
      this.dependencies.isWorkspaceTrusted(),
    );
  }

  setCommitMessage(message: string): RepositoryViewModel {
    return this.registry.setCommitMessage(
      message,
      this.dependencies.isWorkspaceTrusted(),
    );
  }

  async commit(request: RepositoryCommitRequest): Promise<CommitResult> {
    return await this.writeCoordinator.commit(request);
  }

  async commitAndPush(
    request: RepositoryCommitRequest,
  ): Promise<PushResult> {
    return await this.writeCoordinator.commitAndPush(request);
  }

  async selectPushRemote(
    request: SelectPushRemoteRequest,
  ): Promise<PushResult> {
    return await this.writeCoordinator.selectPushRemote(request);
  }

  async retryPush(request: RepositoryVersionRequest): Promise<PushResult> {
    return await this.writeCoordinator.retryPush(request);
  }

  async trash(request: TrashRequest): Promise<TrashResult> {
    return await this.writeCoordinator.trash(request);
  }

  async setRemoteUrl(request: SetRemoteUrlRequest): Promise<RemoteInfo> {
    return await this.writeCoordinator.setRemoteUrl(request);
  }

  async addRemote(request: AddRemoteRequest): Promise<RemoteInfo> {
    return await this.writeCoordinator.addRemote(request);
  }

  dispose(): void {
    for (const listener of this.lifecycleListeners.splice(0)) {
      listener.dispose();
    }
    this.writeCoordinator.dispose();
    this.registry.dispose();
  }

  private async initializeOpenedRepository(id: string): Promise<void> {
    const state = await this.registry.refreshRepositorySnapshot(id);
    if (this.dependencies.historyService !== undefined) {
      await this.refreshHistory({
        repositoryId: id,
        version: state.version,
      });
    } else {
      await this.refreshSyncStatus({
        repositoryId: id,
        version: state.version,
      });
    }
  }

  private requireVersion(request: RepositoryVersionRequest) {
    const state = this.registry.get(request.repositoryId);
    if (state === undefined) {
      throw new Error('仓库不存在或已关闭');
    }
    if (state.version !== request.version) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }
    return state;
  }

  private matches(
    state: NonNullable<ReturnType<RepositoryRegistry['get']>>,
    version: number,
  ): boolean {
    return this.registry.get(state.id) === state && state.version === version;
  }

  private sameIds(
    actual: ReadonlySet<string>,
    expected: readonly string[],
  ): boolean {
    return actual.size === new Set(expected).size
      && expected.every((id) => actual.has(id));
  }

  private requireSyncService(): Pick<SyncService, 'fetch' | 'pull' | 'pushAll'> {
    if (this.dependencies.syncService === undefined) {
      throw new Error('远程同步服务尚未配置');
    }
    return this.dependencies.syncService;
  }

  private async runSync(
    request: RepositoryVersionRequest,
    action: 'fetch' | 'pull' | 'push',
    operation: (
      repository: BuiltinRepository,
      state: NonNullable<ReturnType<RepositoryRegistry['get']>>,
    ) => Promise<void>,
  ): Promise<void> {
    if (!this.dependencies.isWorkspaceTrusted()) {
      throw new Error('未信任的工作区不能执行远程同步');
    }
    await this.operationLock.runExclusive(request.repositoryId, async () => {
      const state = await this.registry.refreshAndValidateWriteSnapshot(
        request.repositoryId,
        request.version,
      );
      state.operation = { kind: 'running', action };
      this.registry.notifyChange();
      try {
        await operation(state.repository, state);
        state.operation = { kind: 'idle' };
        await this.registry.refreshRepositorySnapshot(state.id);
        if (this.dependencies.historyService !== undefined) {
          await this.refreshHistory({
            repositoryId: state.id,
            version: state.version,
          });
        } else {
          await this.refreshSyncStatus({
            repositoryId: state.id,
            version: state.version,
          });
        }
      } catch (error) {
        state.operation = {
          kind: 'failed',
          action,
          message: this.errorMessage(error),
        };
        this.registry.notifyChange();
        throw error;
      }
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async refreshSyncStatus(
    request: RepositoryVersionRequest,
  ): Promise<void> {
    const aheadBehind = this.dependencies.syncService?.aheadBehind;
    if (aheadBehind === undefined) {
      return;
    }
    const state = this.requireVersion(request);
    const sync = await aheadBehind.call(
      this.dependencies.syncService,
      state.rootPath,
    );
    if (!this.matches(state, request.version)) {
      return;
    }
    state.sync = state.repository.state.HEAD?.name === undefined
      ? { kind: 'detached' }
      : sync;
    this.registry.notifyChange();
  }
}
