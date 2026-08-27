import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMocks = vi.hoisted(() => ({
  createTreeView: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    createTreeView: vscodeMocks.createTreeView,
  },
  TreeItem: class TreeItem {
    constructor(readonly label: string) {}
  },
}));

import {
  ActivityBadge,
  activityBadgeFor,
  activityBadgeViewId,
  type ActivityBadgeService,
} from '../../src/views/activity-badge.js';

interface ServiceDouble {
  readonly onDidChange: vscode.Event<void>;
  changeCount: number;
  readonly fireChange: () => void;
}

function createService(changeCount: number): ServiceDouble {
  const listeners = new Set<() => unknown>();
  const service: ServiceDouble = {
    changeCount,
    onDidChange: (listener: () => unknown) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fireChange: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
  return service;
}

function asBadgeService(service: ServiceDouble): ActivityBadgeService {
  return {
    onDidChange: service.onDidChange,
    getViewModel: () => ({ changeCount: service.changeCount }),
  };
}

describe('活动栏徽标', () => {
  beforeEach(() => {
    vscodeMocks.createTreeView.mockReset();
  });

  it('无变更时不显示徽标', () => {
    expect(activityBadgeFor(0)).toBeUndefined();
  });

  it('有变更时显示数量和说明', () => {
    expect(activityBadgeFor(4)).toEqual({
      value: 4,
      tooltip: 'Gitool：4 个变更文件',
    });
  });

  it('激活时立刻把变更数写到隐藏树视图，不必先点开 Gitool', () => {
    const tree = { badge: undefined as vscode.ViewBadge | undefined, dispose: vi.fn() };
    vscodeMocks.createTreeView.mockReturnValue(tree);
    const service = createService(3);
    const badge = new ActivityBadge(asBadgeService(service));

    expect(vscodeMocks.createTreeView.mock.calls[0]?.[0]).toBe(
      activityBadgeViewId,
    );
    expect(tree.badge).toEqual({
      value: 3,
      tooltip: 'Gitool：3 个变更文件',
    });
    badge.dispose();
    expect(tree.dispose).toHaveBeenCalledOnce();
  });

  it('仓库变更后同步徽标，清空后移除', () => {
    const tree = { badge: undefined as vscode.ViewBadge | undefined, dispose: vi.fn() };
    vscodeMocks.createTreeView.mockReturnValue(tree);
    const service = createService(2);
    const badge = new ActivityBadge(asBadgeService(service));

    service.changeCount = 0;
    service.fireChange();

    expect(tree.badge).toBeUndefined();
    badge.dispose();
  });
});
