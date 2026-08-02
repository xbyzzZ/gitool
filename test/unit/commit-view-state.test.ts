import { describe, expect, it } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import {
  commitControlState,
  operationFeedback,
} from '../../src/webview/commit-view-state.js';

function model(hasRemote: boolean): RepositoryViewModel {
  return {
    version: 1,
    trusted: true,
    currentRepositoryId: '/workspace/repo',
    repositories: [{
      id: '/workspace/repo',
      label: 'repo',
      rootPath: '/workspace/repo',
    }],
    branch: 'main',
    detached: false,
    hasRemote,
    hasHeadCommit: true,
    changes: [{
      id: 'src/client.ts',
      path: 'src/client.ts',
      kind: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['src/client.ts'],
    }],
    changeCount: 1,
    selectedIds: ['src/client.ts'],
    commitMessage: '功能：测试推送状态',
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
  };
}

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
      revealKey: 'push-failed:4672c1a:远程拒绝推送',
    });
  });

  it('没有远程时只允许本地提交', () => {
    expect(commitControlState(model(false), {
      locallyBusy: false,
      message: '功能：测试推送状态',
    })).toMatchObject({
      canCommit: true,
      canCommitAndPush: false,
    });
  });

  it('配置远程后允许提交并推送', () => {
    expect(commitControlState(model(true), {
      locallyBusy: false,
      message: '功能：测试推送状态',
    })).toMatchObject({
      canCommit: true,
      canCommitAndPush: true,
    });
  });
});
