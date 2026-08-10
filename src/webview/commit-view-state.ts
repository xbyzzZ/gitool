import type {
  OperationState,
  RepositoryViewModel,
} from '../domain/view-model.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';
import type { AiModelSelection } from '../services/ai-model-selection-store.js';

export interface AiControlPresentation {
  readonly density: CommitMessageDensity;
  readonly generating: boolean;
  readonly generateLabel: string;
  readonly densityLabel: string;
}

export interface OperationFeedback {
  readonly message: string;
  readonly error: string;
  readonly retry: boolean;
  readonly revealKey?: string;
}

export interface CommitControlInput {
  readonly locallyBusy: boolean;
  readonly message: string;
}

export interface CommitControlState {
  readonly canWrite: boolean;
  readonly canCommit: boolean;
  readonly canCommitAndPush: boolean;
}

const actionLabels: Readonly<Record<
  Extract<OperationState, { readonly kind: 'running' }>['action'],
  string
>> = {
  commit: '正在提交所选文件…',
  push: '正在推送提交…',
  trash: '正在移入废纸篓…',
  remote: '正在修改远程 URL…',
  fetch: '正在刷新远程状态…',
  pull: '正在从远程拉取…',
};

export function densityLabel(density: CommitMessageDensity): string {
  return { compact: '精简', standard: '标准', detailed: '详细' }[density];
}

export function aiControlPresentation(
  density: CommitMessageDensity,
  generating: boolean,
): AiControlPresentation {
  const label = densityLabel(density);
  return {
    density,
    generating,
    generateLabel: generating
      ? '取消 AI 生成'
      : `使用 AI 生成提交信息（${label}）`,
    densityLabel: `选择 AI 信息密度（${label}）`,
  };
}

export function aiModelSelectionLabel(
  selection: AiModelSelection | undefined,
  selecting: boolean,
): string {
  const name = selecting ? '正在选择' : (selection?.name ?? '自动选择');
  return `选择 AI 模型（${name}）`;
}

export function operationFeedback(
  operation: OperationState,
): OperationFeedback {
  switch (operation.kind) {
    case 'idle':
      return { message: '', error: '', retry: false };
    case 'commit-succeeded':
      return { message: '', error: '', retry: false };
    case 'running':
      return {
        message: actionLabels[operation.action],
        error: '',
        retry: false,
      };
    case 'push-failed':
      return {
        message: `提交已创建：${operation.commitHash}`,
        error: operation.message,
        retry: true,
        revealKey: `push-failed:${operation.commitHash}:${operation.message}`,
      };
    case 'failed':
      return {
        message: '',
        error: operation.message,
        retry: false,
        revealKey: `failed:${operation.action}:${operation.message}`,
      };
  }
}

export function commitControlState(
  model: RepositoryViewModel,
  input: CommitControlInput,
): CommitControlState {
  const running = model.operation.kind === 'running';
  const hasConflict = model.changes.some((change) => change.conflicted);
  const canWrite = model.trusted
    && model.currentRepositoryId !== undefined
    && !running
    && !input.locallyBusy
    && !hasConflict;
  const canCommit = canWrite
    && model.selectedIds.length > 0
    && input.message.trim().length > 0;
  return {
    canWrite,
    canCommit,
    canCommitAndPush: canCommit && model.hasRemote && !model.detached,
  };
}
