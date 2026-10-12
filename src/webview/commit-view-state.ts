import type {
  OperationState,
  RepositoryViewModel,
} from '../domain/view-model.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';
import type { AiModelSelection } from '../services/ai-model-selection-store.js';

export interface AiControlPresentation {
  readonly density: CommitMessageDensity;
  readonly densityText: string;
  readonly generating: boolean;
  readonly generateLabel: string;
}

export interface DensityPresentation {
  readonly label: string;
  readonly description: string;
}

export interface AiSettingsPresentation {
  readonly name: string;
  readonly label: string;
}

export interface OperationFeedback {
  readonly message: string;
  readonly error: string;
  readonly retry: boolean;
  readonly revealKey?: string;
}

export interface CommitControlInput {
  readonly locallyBusy: boolean;
  readonly aiGenerating: boolean;
  readonly message: string;
}

export interface CommitControlState {
  readonly canWrite: boolean;
  readonly canCommit: boolean;
  readonly canCommitAndPush: boolean;
  readonly canGenerateCommitMessage: boolean;
  readonly canOpenAiSettings: boolean;
}

export function densityPresentation(
  density: CommitMessageDensity,
): DensityPresentation {
  return {
    compact: { label: '精简', description: '仅生成一行标题' },
    standard: { label: '标准', description: '标题 + 2–4 条关键变化' },
    detailed: { label: '详细', description: '标题 + 行为及兼容说明' },
  }[density];
}

export function densityLabel(density: CommitMessageDensity): string {
  return densityPresentation(density).label;
}

export function aiControlPresentation(
  density: CommitMessageDensity,
  generating: boolean,
): AiControlPresentation {
  const { label, description } = densityPresentation(density);
  return {
    density,
    densityText: label,
    generating,
    generateLabel: generating
      ? '取消 AI 生成'
      : `生成提交信息：${label}（${description}）`,
  };
}

export function aiSettingsPresentation(
  selection: AiModelSelection | undefined,
  selecting: boolean,
): AiSettingsPresentation {
  const name = selecting ? '正在选择' : (selection?.name ?? '自动选择');
  return { name, label: `AI 设置（当前模型：${name}）` };
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
        message: '',
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
    canGenerateCommitMessage: canWrite
      && !input.aiGenerating
      && model.selectedIds.length > 0,
    canOpenAiSettings: canWrite && !input.aiGenerating,
  };
}
