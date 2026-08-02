import { describe, expect, it } from 'vitest';

import {
  operationFeedback,
} from '../../src/webview/commit-view-state.js';

describe('提交信息展示状态', () => {
  it('提交成功后保留提交哈希并要求显现反馈', () => {
    expect(operationFeedback({
      kind: 'commit-succeeded',
      commitHash: 'abc1234',
    })).toEqual({
      message: '提交已完成：abc1234',
      error: '',
      retry: false,
      revealKey: 'commit-succeeded:abc1234',
    });
  });

  it('提交已创建但推送失败时保留错误和重试入口', () => {
    expect(operationFeedback({
      kind: 'push-failed',
      commitHash: 'def5678',
      message: '远程拒绝推送',
    })).toEqual({
      message: '提交已创建：def5678',
      error: '远程拒绝推送',
      retry: true,
      revealKey: 'push-failed:def5678:远程拒绝推送',
    });
  });
});
