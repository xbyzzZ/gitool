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

export interface DensityPresentation {
  readonly label: string;
  readonly description: string;
}

export interface AiModelControlPresentation {
  readonly name: string;
  readonly label: string;
}

export interface DensityMenuPlacementInput {
  readonly triggerLeft: number;
  readonly triggerTop: number;
  readonly triggerBottom: number;
  readonly menuWidth: number;
  readonly menuHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface DensityMenuPlacement {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
  readonly direction: 'above' | 'below';
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

export function densityMenuTargetIndex(
  currentIndex: number,
  key: string,
  optionCount: number,
): number | undefined {
  if (optionCount < 1 || currentIndex < 0 || currentIndex >= optionCount) {
    return undefined;
  }
  switch (key) {
    case 'ArrowDown':
      return (currentIndex + 1) % optionCount;
    case 'ArrowUp':
      return (currentIndex - 1 + optionCount) % optionCount;
    case 'Home':
      return 0;
    case 'End':
      return optionCount - 1;
    default:
      return undefined;
  }
}

export function densityMenuPlacement({
  triggerLeft,
  triggerTop,
  triggerBottom,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
}: DensityMenuPlacementInput): DensityMenuPlacement {
  const viewportPadding = 4;
  const triggerGap = 2;
  const availableAbove = Math.max(
    0,
    triggerTop - triggerGap - viewportPadding,
  );
  const availableBelow = Math.max(
    0,
    viewportHeight - triggerBottom - triggerGap - viewportPadding,
  );
  const direction = availableAbove >= menuHeight
    ? 'above'
    : availableBelow >= menuHeight
      ? 'below'
      : availableAbove >= availableBelow ? 'above' : 'below';
  const maxHeight = direction === 'above' ? availableAbove : availableBelow;
  const displayedHeight = Math.min(menuHeight, maxHeight);
  const displayedWidth = Math.min(
    menuWidth,
    Math.max(0, viewportWidth - viewportPadding * 2),
  );
  const maxLeft = Math.max(
    viewportPadding,
    viewportWidth - viewportPadding - displayedWidth,
  );
  const left = Math.min(Math.max(triggerLeft, viewportPadding), maxLeft);
  const preferredTop = direction === 'above'
    ? triggerTop - triggerGap - displayedHeight
    : triggerBottom + triggerGap;
  const maxTop = Math.max(
    viewportPadding,
    viewportHeight - viewportPadding - displayedHeight,
  );

  return {
    left,
    top: Math.min(Math.max(preferredTop, viewportPadding), maxTop),
    maxHeight,
    direction,
  };
}

export function aiControlPresentation(
  density: CommitMessageDensity,
  generating: boolean,
): AiControlPresentation {
  const { label, description } = densityPresentation(density);
  return {
    density,
    generating,
    generateLabel: generating
      ? '取消 AI 生成'
      : `生成提交信息：${label}（${description}）`,
    densityLabel: `选择生成内容（当前：${label}）`,
  };
}

export function aiModelControlPresentation(
  selection: AiModelSelection | undefined,
  selecting: boolean,
): AiModelControlPresentation {
  const name = selecting ? '正在选择' : (selection?.name ?? '自动选择');
  return { name, label: `选择 AI 模型（${name}）` };
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
