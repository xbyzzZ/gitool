import { describe, expect, it } from 'vitest';
import {
  defaultLayoutState,
  normalizeLayoutState,
  resetLayout,
  resizeLayout,
  togglePane,
} from '../../src/webview/layout-state.js';

describe('工作台布局状态', () => {
  it('拒绝非法持久化值并恢复默认布局', () => {
    expect(normalizeLayoutState({
      heights: { commit: Number.NaN, changes: -1, history: 'bad' },
      collapsed: { commit: 'yes', changes: false, history: false },
    }, 720)).toEqual({
      heights: { commit: 150, changes: 240, history: 330 },
      collapsed: { commit: false, changes: false, history: false },
    });
  });

  it('把三个展开区域限制在各自最小高度', () => {
    expect(normalizeLayoutState({
      heights: { commit: 20, changes: 20, history: 20 },
      collapsed: { commit: false, changes: false, history: false },
    }, 312)).toEqual({
      heights: { commit: 150, changes: 96, history: 66 },
      collapsed: { commit: false, changes: false, history: false },
    });
  });

  it('把视口剩余高度计入历史区以便分隔线可以继续向下拖动', () => {
    expect(normalizeLayoutState(defaultLayoutState, 1_000).heights).toEqual({
      commit: 150,
      changes: 240,
      history: 610,
    });
  });

  it('拖动第一条分隔线时不裁掉提交区按钮', () => {
    const result = resizeLayout(
      defaultLayoutState,
      'commit-changes',
      -10_000,
      720,
    );

    expect(result.heights.commit).toBe(150);
  });

  it('折叠和展开区域时保留用户设置的展开高度', () => {
    const collapsed = togglePane(defaultLayoutState, 'history');

    expect(collapsed.collapsed.history).toBe(true);
    expect(collapsed.heights.history).toBe(defaultLayoutState.heights.history);
    expect(togglePane(collapsed, 'history')).toEqual(defaultLayoutState);
  });

  it('拖动第一条分隔线时在提交区和变更区之间分配高度', () => {
    expect(resizeLayout(
      defaultLayoutState,
      'commit-changes',
      40,
      720,
    ).heights).toEqual({
      commit: defaultLayoutState.heights.commit + 40,
      changes: defaultLayoutState.heights.changes - 40,
      history: 330,
    });
  });

  it('拖动第二条分隔线时允许历史区缩到单行记录高度', () => {
    const result = resizeLayout(
      defaultLayoutState,
      'changes-history',
      10_000,
      720,
    );

    expect(result.heights.history).toBe(66);
    expect(result.heights.changes).toBe(
      defaultLayoutState.heights.changes
      + 330
      - 66,
    );
  });

  it('折叠相邻区域时拒绝拖动对应分隔线', () => {
    const collapsed = togglePane(defaultLayoutState, 'changes');

    expect(resizeLayout(
      collapsed,
      'commit-changes',
      40,
      720,
    )).toEqual(collapsed);
    expect(resizeLayout(
      collapsed,
      'changes-history',
      40,
      720,
    )).toEqual(collapsed);
  });

  it('重置时根据当前视口恢复默认比例和展开状态', () => {
    const changed = togglePane(resizeLayout(
      defaultLayoutState,
      'commit-changes',
      30,
      720,
    ), 'history');

    expect(resetLayout(changed, 720)).toEqual({
      heights: { commit: 150, changes: 240, history: 330 },
      collapsed: { commit: false, changes: false, history: false },
    });
  });
});
