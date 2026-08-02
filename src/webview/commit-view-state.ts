import type { OperationState } from '../domain/view-model.js';

export interface OperationFeedback {
  readonly message: string;
  readonly error: string;
  readonly retry: boolean;
  readonly revealKey?: string;
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

export function operationFeedback(
  operation: OperationState,
): OperationFeedback {
  switch (operation.kind) {
    case 'idle':
      return { message: '', error: '', retry: false };
    case 'running':
      return {
        message: actionLabels[operation.action],
        error: '',
        retry: false,
      };
    case 'commit-succeeded':
      return {
        message: `提交已完成：${operation.commitHash}`,
        error: '',
        retry: false,
        revealKey: `commit-succeeded:${operation.commitHash}`,
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
