import { describe, expect, it } from 'vitest';
import { operationFeedback } from '../../src/webview/commit-view-state.js';

describe('提交信息展示状态', () => {
  it('完整提交成功不显示成功文字', () => {
    expect(operationFeedback({
      kind: 'commit-succeeded',
      commitHash: '4672c1a',
    })).toEqual({ message: '', error: '', retry: false });
  });

  it('提交成功但推送失败时保留错误和重试入口', () => {
    expect(operationFeedback({
      kind: 'push-failed',
      commitHash: '4672c1a',
      message: '远程拒绝推送',
    })).toEqual({
      message: '提交已创建：4672c1a',
      error: '远程拒绝推送',
      retry: true,
    });
  });
});
