import { SelectionStore } from '../domain/selection-store.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { BuiltinGitApi } from '../git/builtin-git-api.js';
import type { CommitResult } from './commit-service.js';
import type { RepositoryOperationLock } from './operation-lock.js';
import type { PushResult } from './push-service.js';
import { RepositoryRegistry } from './repository-registry.js';
import type { RemoteInfo } from './remote-service.js';
import type { TrashResult } from './trash-service.js';
import {
  RepositoryWriteCoordinator,
  type RepositoryCommitRequest,
  type RepositoryVersionRequest,
  type RepositoryWriteCoordinatorDependencies,
  type SelectPushRemoteRequest,
  type SetRemoteUrlRequest,
  type TrashRequest,
} from './repository-write-coordinator.js';

export type {
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
  readonly isWorkspaceTrusted: () => boolean;
}

export class RepositoryService {
  private readonly registry: RepositoryRegistry;
  private readonly writeCoordinator: RepositoryWriteCoordinator;

  constructor(private readonly dependencies: RepositoryServiceDependencies) {
    this.registry = new RepositoryRegistry(
      dependencies.gitApi,
      dependencies.selectionStore,
    );
    this.writeCoordinator = new RepositoryWriteCoordinator({
      registry: this.registry,
      commitService: dependencies.commitService,
      pushService: dependencies.pushService,
      trashService: dependencies.trashService,
      remoteService: dependencies.remoteService,
      ...(dependencies.operationLock === undefined
        ? {}
        : { operationLock: dependencies.operationLock }),
      isWorkspaceTrusted: dependencies.isWorkspaceTrusted,
    });
  }

  getViewModel(): RepositoryViewModel {
    return this.registry.getViewModel(
      this.dependencies.isWorkspaceTrusted(),
    );
  }

  selectRepository(id: string): RepositoryViewModel {
    return this.registry.selectRepository(
      id,
      this.dependencies.isWorkspaceTrusted(),
    );
  }

  async refresh(): Promise<RepositoryViewModel> {
    return await this.registry.refresh(
      this.dependencies.isWorkspaceTrusted(),
    );
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

  dispose(): void {
    this.writeCoordinator.dispose();
    this.registry.dispose();
  }
}
