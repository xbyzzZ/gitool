import { describe, expect, it } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import {
  aiControlPresentation,
  aiModelControlPresentation,
  commitControlState,
  densityPresentation,
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
  it.each([
    ['compact', '精简', '仅生成一行标题'],
    ['standard', '标准', '标题 + 2–4 条关键变化'],
    ['detailed', '详细', '标题 + 行为及兼容说明'],
  ] as const)('输出 %s 密度的生成内容状态', (density, label, description) => {
    expect(densityPresentation(density)).toEqual({ label, description });
    expect(aiControlPresentation(density, false)).toEqual({
      density,
      densityText: label,
      generating: false,
      generateLabel: `生成提交信息：${label}（${description}）`,
      densityLabel: `选择生成内容（当前：${label}）`,
    });
  });

  it('AI 生成中保留密度并输出加载状态', () => {
    expect(aiControlPresentation('detailed', true)).toEqual({
      density: 'detailed',
      densityText: '详细',
      generating: true,
      generateLabel: '取消 AI 生成',
      densityLabel: '选择生成内容（当前：详细）',
    });
  });

  it('展示自动、显式模型和选择中的可见名称及完整文案', () => {
    expect(aiModelControlPresentation(undefined, false)).toEqual({
      name: '自动选择',
      label: '选择 AI 模型（自动选择）',
    });
    expect(aiModelControlPresentation({
      id: 'model-1',
      name: 'GPT-5.1-Codex-Max',
    }, false)).toEqual({
      name: 'GPT-5.1-Codex-Max',
      label: '选择 AI 模型（GPT-5.1-Codex-Max）',
    });
    expect(aiModelControlPresentation({
      id: 'model-1',
      name: 'GPT-5.1-Codex-Max',
    }, true)).toEqual({
      name: '正在选择',
      label: '选择 AI 模型（正在选择）',
    });
  });

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
      aiGenerating: false,
      message: '功能：测试推送状态',
    })).toMatchObject({
      canCommit: true,
      canCommitAndPush: false,
    });
  });

  it('配置远程后允许提交并推送', () => {
    expect(commitControlState(model(true), {
      locallyBusy: false,
      aiGenerating: false,
      message: '功能：测试推送状态',
    })).toMatchObject({
      canCommit: true,
      canCommitAndPush: true,
    });
  });

  it('未选择文件时允许预先选择生成档位但不允许生成', () => {
    expect(commitControlState({
      ...model(true),
      selectedIds: [],
    }, {
      locallyBusy: false,
      aiGenerating: false,
      message: '',
    })).toMatchObject({
      canGenerateCommitMessage: false,
      canSelectAiDensity: true,
    });
  });

  it('生成中或工作区不可写时禁止切换档位', () => {
    expect(commitControlState(model(true), {
      locallyBusy: false,
      aiGenerating: true,
      message: '',
    }).canSelectAiDensity).toBe(false);
    expect(commitControlState({
      ...model(true),
      trusted: false,
    }, {
      locallyBusy: false,
      aiGenerating: false,
      message: '',
    }).canSelectAiDensity).toBe(false);
  });
});
