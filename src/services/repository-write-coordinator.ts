import type { FileChange } from '../domain/change-model.js';
import type { BuiltinRepository } from '../git/builtin-git-api.js';
import type {
  CommitRequest,
  CommitResult,
  CommitService,
} from './commit-service.js';
import { RepositoryOperationLock } from './operation-lock.js';
import type {
  PushRequest,
  PushResult,
  PushService,
} from './push-service.js';
import type {
  RepositoryContext,
  RepositoryRegistry,
} from './repository-registry.js';
import type { RemoteInfo, RemoteService } from './remote-service.js';
import type { TrashResult, TrashService } from './trash-service.js';

interface CommitServicePort {
  commit(request: CommitRequest): Promise<CommitResult>;
}

interface PushServicePort {
  push(
    repository: BuiltinRepository,
    request: PushRequest,
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

export interface RepositoryWriteCoordinatorDependencies {
  readonly registry: RepositoryRegistry;
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

interface RemoteIdentity {
  readonly name: string;
  readonly present: boolean;
  readonly url: string | undefined;
}

interface PendingPush {
  readonly repository: BuiltinRepository;
  readonly commitHash: string;
  readonly localBranch: string;
  readonly targetBranch: string;
  readonly setUpstream: boolean;
  readonly targetRemote?: RemoteIdentity;
}

interface WriteContext {
  readonly state: RepositoryContext;
  readonly files: readonly FileChange[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectedFiles(
  state: RepositoryContext,
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

export class RepositoryWriteCoordinator {
  private readonly operationLock: RepositoryOperationLock;
  private readonly pendingPushes = new Map<string, PendingPush>();

  constructor(
    private readonly dependencies: RepositoryWriteCoordinatorDependencies,
  ) {
    this.operationLock = dependencies.operationLock
      ?? new RepositoryOperationLock();
  }

  async commit(request: RepositoryCommitRequest): Promise<CommitResult> {
    const context = this.prepareWrite(
      request.repositoryId,
      request.version,
      request.selectedIds,
    );
    return await this.operationLock.runExclusive(
      context.state.id,
      async () => {
        this.pendingPushes.delete(context.state.id);
        return await this.commitUnlocked(context, request);
      },
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
        this.requireAttachedHead(context.state);
        this.pendingPushes.delete(context.state.id);
        const commitResult = await this.commitUnlocked(context, request);
        const head = this.requireAttachedHead(context.state);
        const localBranch = head.name;
        const targetBranch = head.upstream?.name ?? localBranch;
        const targetRemote = head.upstream === undefined
          ? undefined
          : this.remoteIdentity(
            context.state.repository,
            head.upstream.remote,
          );
        this.pendingPushes.set(context.state.id, {
          repository: context.state.repository,
          commitHash: commitResult.commitHash,
          localBranch,
          targetBranch,
          setUpstream: head.upstream === undefined,
          ...(targetRemote === undefined ? {} : { targetRemote }),
        });
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
        this.pendingPushes.set(context.state.id, {
          ...pending,
          targetRemote: this.remoteIdentity(
            context.state.repository,
            request.remote,
          ),
        });
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
      async () => await this.trashUnlocked(context),
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
    this.pendingPushes.clear();
  }

  private prepareWrite(
    id: string,
    version: number,
    fileIds: readonly string[] = [],
  ): WriteContext {
    if (!this.dependencies.isWorkspaceTrusted()) {
      throw new Error('未信任的工作区不能执行写操作');
    }
    const state = this.dependencies.registry.get(id);
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

  private requireAttachedHead(
    state: RepositoryContext,
  ): NonNullable<BuiltinRepository['state']['HEAD']> & {
    readonly name: string;
  } {
    const head = state.repository.state.HEAD;
    if (head?.name === undefined || head.name.length === 0) {
      throw new Error('当前处于游离 HEAD，不能提交并推送');
    }
    return head as NonNullable<BuiltinRepository['state']['HEAD']> & {
      readonly name: string;
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
          this.dependencies.registry.get(context.state.id) === context.state
          && context.state.version === expectedVersion,
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

  private requirePendingPush(state: RepositoryContext): PendingPush {
    const pending = this.pendingPushes.get(state.id);
    if (pending === undefined) {
      throw new Error('没有可重试的推送');
    }
    if (pending.repository !== state.repository) {
      this.pendingPushes.delete(state.id);
      throw new Error('仓库已重新打开，原推送上下文已失效');
    }
    return pending;
  }

  private async pushPending(state: RepositoryContext): Promise<PushResult> {
    const pending = this.requirePendingPush(state);
    state.operation = { kind: 'running', action: 'push' };
    try {
      if (pending.targetBranch.length === 0) {
        this.pendingPushes.delete(state.id);
        throw new Error('推送重试上下文缺少目标分支，请重新提交并推送');
      }
      this.verifyRemoteIdentity(state.repository, pending);
      const result = await this.dependencies.pushService.push(
        state.repository,
        {
          ...(pending.targetRemote === undefined
            ? {}
            : { selectedRemote: pending.targetRemote.name }),
          localBranch: pending.localBranch,
          exactRefspec: {
            sourceRef: pending.commitHash,
            targetBranch: pending.targetBranch,
          },
          ...(pending.setUpstream ? { setUpstream: true } : {}),
        },
      );
      state.operation = {
        kind: 'commit-succeeded',
        commitHash: pending.commitHash,
      };
      if (result.kind === 'pushed') {
        this.pendingPushes.delete(state.id);
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

  private remoteIdentity(
    repository: BuiltinRepository,
    name: string,
  ): RemoteIdentity {
    const remote = repository.state.remotes.find((item) => item.name === name);
    return {
      name,
      present: remote !== undefined,
      url: remote?.pushUrl ?? remote?.fetchUrl,
    };
  }

  private verifyRemoteIdentity(
    repository: BuiltinRepository,
    pending: PendingPush,
  ): void {
    if (pending.targetRemote === undefined) {
      return;
    }
    const current = this.remoteIdentity(
      repository,
      pending.targetRemote.name,
    );
    if (
      current.present !== pending.targetRemote.present
      || current.url !== pending.targetRemote.url
    ) {
      throw new Error('推送目标远程已变化，请重新提交并推送');
    }
  }

  private async runOperation<T>(
    state: RepositoryContext,
    action: 'remote',
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

  private async trashUnlocked(context: WriteContext): Promise<TrashResult> {
    context.state.operation = { kind: 'running', action: 'trash' };
    try {
      const result = await this.dependencies.trashService.moveToTrash(
        context.state.rootPath,
        context.files.map((file) => file.path),
      );
      if (result.failed.length === 0) {
        context.state.operation = { kind: 'idle' };
      } else {
        const scope = result.succeeded.length === 0 ? '失败' : '部分失败';
        context.state.operation = {
          kind: 'failed',
          action: 'trash',
          message: `移入废纸篓${scope}：成功 `
            + `${String(result.succeeded.length)} 个，失败 `
            + `${String(result.failed.length)} 个`,
        };
      }
      return result;
    } catch (error) {
      context.state.operation = {
        kind: 'failed',
        action: 'trash',
        message: errorMessage(error),
      };
      throw error;
    }
  }
}
