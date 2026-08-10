import { describe, expect, it } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';
import {
  canPushAll,
  PushAvailabilityContext,
  type PushAvailabilityService,
} from '../../src/views/push-availability-context.js';

function model(
  overrides: Partial<RepositoryViewModel> = {},
): RepositoryViewModel {
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
    hasRemote: true,
    hasHeadCommit: true,
    changes: [],
    changeCount: 0,
    selectedIds: [],
    commitMessage: '',
    operation: { kind: 'idle' },
    sync: { kind: 'ready', upstream: 'origin/main', ahead: 2, behind: 0 },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
    ...overrides,
  };
}

describe('提交工作台推送可用状态', () => {
  it.each([
    ['没有远程', { hasRemote: false }],
    ['工作区未信任', { trusted: false }],
    ['操作正在运行', { operation: { kind: 'running', action: 'push' } }],
    ['没有领先提交', {
      sync: { kind: 'ready', upstream: 'origin/main', ahead: 0, behind: 0 },
    }],
    ['分支落后远程', {
      sync: { kind: 'ready', upstream: 'origin/main', ahead: 2, behind: 1 },
    }],
  ] satisfies readonly [string, Partial<RepositoryViewModel>][])('%s时禁用推送', (
    _name,
    overrides,
  ) => {
    expect(canPushAll(model(overrides))).toBe(false);
  });

  it('没有当前仓库时禁用推送', () => {
    const {
      currentRepositoryId: omittedCurrentRepository,
      ...withoutRepository
    } = model();
    void omittedCurrentRepository;
    expect(canPushAll(withoutRepository)).toBe(false);
  });

  it('游离 HEAD 时禁用推送', () => {
    const { branch: omittedBranch, ...withoutBranch } = model({ detached: true });
    void omittedBranch;
    expect(canPushAll(withoutBranch)).toBe(false);
  });

  it('存在可快进推送的领先提交时启用推送', () => {
    expect(canPushAll(model())).toBe(true);
  });

  it('存在远程但未设置上游时允许首次推送', () => {
    expect(canPushAll(model({ sync: { kind: 'no-upstream' } }))).toBe(true);
  });

  it('空仓库即使配置远程也禁用首次推送', () => {
    expect(canPushAll(model({
      hasHeadCommit: false,
      sync: { kind: 'no-upstream' },
    }))).toBe(false);
  });

  it('仓库状态变化后更新上下文键', () => {
    let current = model({ hasRemote: false });
    let listener: (() => void) | undefined;
    const service: PushAvailabilityService = {
      getViewModel: () => current,
      onDidChange: (next) => {
        listener = next;
        return { dispose: () => { listener = undefined; } };
      },
    };
    const values: boolean[] = [];
    const context = new PushAvailabilityContext(
      service,
      (enabled) => { values.push(enabled); },
    );

    current = model();
    listener?.();

    expect(values).toEqual([false, true]);
    context.dispose();
  });
});
