import { describe, expect, it } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import {
  aiControlPresentation,
  aiDensityMenuItems,
  aiModelMenuItems,
  aiSettingsPresentation,
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
      generateLabel: `生成提交信息（${label}：${description}）`,
    });
  });

  it('AI 生成中保留密度并输出取消文案', () => {
    expect(aiControlPresentation('detailed', true)).toEqual({
      density: 'detailed',
      densityText: '详细',
      generating: true,
      generateLabel: '取消生成',
    });
  });

  it('展示自动与显式模型的 AI 设置按钮文案', () => {
    expect(aiSettingsPresentation(undefined)).toEqual({
      name: '自动选择',
      label: 'AI 设置（模型：自动选择）',
    });
    expect(aiSettingsPresentation({
      id: 'model-1',
      name: 'GPT-5.1-Codex-Max',
    })).toEqual({
      name: 'GPT-5.1-Codex-Max',
      label: 'AI 设置（模型：GPT-5.1-Codex-Max）',
    });
  });

  it('模型菜单以自动选择开头并按当前选择勾选', () => {
    const menu = aiModelMenuItems([
      { id: 'model-1', name: '模型一', description: 'copilot · family-1' },
      { id: 'model-2', name: '模型二' },
    ], { id: 'model-2', name: '模型二' });

    expect(menu.modelsUnavailable).toBe(false);
    expect(menu.items).toEqual([
      {
        action: 'model:auto',
        title: '自动选择',
        description: '优先 Copilot，否则使用任意可用模型',
        checked: false,
      },
      {
        action: 'model:model-1',
        title: '模型一',
        description: 'copilot · family-1',
        checked: false,
      },
      {
        action: 'model:model-2',
        title: '模型二',
        checked: true,
      },
    ]);
  });

  it('自动选择在无显式模型时勾选且模型缺失时标记不可用', () => {
    expect(aiModelMenuItems(undefined, undefined)).toEqual({
      modelsUnavailable: true,
      items: [{
        action: 'model:auto',
        title: '自动选择',
        description: '优先 Copilot，否则使用任意可用模型',
        checked: true,
      }],
    });
    expect(aiModelMenuItems([], undefined).modelsUnavailable).toBe(true);
  });

  it('密度菜单输出三档并勾选当前档位', () => {
    expect(aiDensityMenuItems('standard')).toEqual([
      {
        action: 'density:compact',
        title: '精简',
        description: '仅生成一行标题',
        checked: false,
      },
      {
        action: 'density:standard',
        title: '标准',
        description: '标题 + 2–4 条关键变化',
        checked: true,
      },
      {
        action: 'density:detailed',
        title: '详细',
        description: '标题 + 行为及兼容说明',
        checked: false,
      },
    ]);
  });

  it('运行中不在反馈区显示进度文字，由按钮加载态表达', () => {
    expect(operationFeedback({
      kind: 'running',
      action: 'commit',
    })).toEqual({ message: '', error: '', retry: false });
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
    })).toMatchObject({
      canCommit: true,
      canCommitAndPush: false,
    });
  });

  it('配置远程后允许提交并推送', () => {
    expect(commitControlState(model(true), {
      locallyBusy: false,
      aiGenerating: false,
    })).toMatchObject({
      canCommit: true,
      canCommitAndPush: true,
    });
  });

  it('空提交信息不禁用提交按钮，由点击时的抖动提示校验', () => {
    expect(commitControlState({
      ...model(true),
      commitMessage: '',
    }, {
      locallyBusy: false,
      aiGenerating: false,
    }).canCommit).toBe(true);
  });

  it('未选择文件时允许预先打开 AI 设置但不允许生成与提交', () => {
    expect(commitControlState({
      ...model(true),
      selectedIds: [],
    }, {
      locallyBusy: false,
      aiGenerating: false,
    })).toMatchObject({
      canCommit: false,
      canGenerateCommitMessage: false,
      canOpenAiSettings: true,
    });
  });

  it('生成中、操作忙碌或工作区不可写时禁止打开 AI 设置', () => {
    expect(commitControlState(model(true), {
      locallyBusy: false,
      aiGenerating: true,
    }).canOpenAiSettings).toBe(false);
    expect(commitControlState(model(true), {
      locallyBusy: true,
      aiGenerating: false,
    }).canOpenAiSettings).toBe(false);
    expect(commitControlState({
      ...model(true),
      operation: { kind: 'running', action: 'commit' },
    }, {
      locallyBusy: false,
      aiGenerating: false,
    }).canOpenAiSettings).toBe(false);
    expect(commitControlState({
      ...model(true),
      trusted: false,
    }, {
      locallyBusy: false,
      aiGenerating: false,
    }).canOpenAiSettings).toBe(false);
  });
});
