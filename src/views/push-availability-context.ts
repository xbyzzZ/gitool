import type * as vscode from 'vscode';
import type { RepositoryViewModel } from '../domain/view-model.js';

export interface PushAvailabilityService {
  readonly onDidChange: vscode.Event<void>;
  getViewModel(): RepositoryViewModel;
}

export type SetPushEnabled = (enabled: boolean) => void;

export function canPushAll(model: RepositoryViewModel): boolean {
  if (!model.trusted
    || model.currentRepositoryId === undefined
    || model.branch === undefined
    || model.detached
    || !model.hasRemote
    || !model.hasHeadCommit
    || model.operation.kind === 'running') {
    return false;
  }
  if (model.sync.kind === 'no-upstream') {
    return true;
  }
  return model.sync.kind === 'ready'
    && model.sync.ahead > 0
    && model.sync.behind === 0;
}

export class PushAvailabilityContext implements vscode.Disposable {
  private readonly listener: vscode.Disposable;

  constructor(
    private readonly service: PushAvailabilityService,
    private readonly setEnabled: SetPushEnabled,
  ) {
    this.listener = service.onDidChange(() => {
      this.update();
    });
    this.update();
  }

  dispose(): void {
    this.listener.dispose();
  }

  private update(): void {
    this.setEnabled(canPushAll(this.service.getViewModel()));
  }
}
