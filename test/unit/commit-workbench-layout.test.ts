import { describe, expect, it } from 'vitest';
import {
  bindDockResizer,
  clampCommitDockHeight,
  compactMinimumCommitDockHeight,
  defaultCommitDockHeight,
  dockHeightFromKey,
  dockHeightFromPointer,
  dockResizerAriaValues,
  minimumCommitDockHeight,
  persistDockHeight,
  readPersistedDockHeight,
} from '../../src/webview/commit-workbench-layout.js';

describe('提交工作台可调边界', () => {
  it('把持久化高度限制在当前视口安全范围内', () => {
    expect(clampCommitDockHeight(Number.NaN, 800)).toBe(
      defaultCommitDockHeight,
    );
    expect(clampCommitDockHeight(20, 800)).toBe(minimumCommitDockHeight);
    expect(clampCommitDockHeight(20, 300)).toBe(
      compactMinimumCommitDockHeight,
    );
    expect(clampCommitDockHeight(900, 600)).toBe(487);
  });

  it('向上拖动扩大提交区并限制最大高度', () => {
    expect(dockHeightFromPointer(240, 500, 450, 800)).toBe(290);
    expect(dockHeightFromPointer(240, 500, 0, 400)).toBe(287);
  });

  it('键盘支持上下微调以及最小最大边界', () => {
    expect(dockHeightFromKey(200, 'ArrowUp', 800)).toBe(210);
    expect(dockHeightFromKey(200, 'ArrowDown', 800)).toBe(190);
    expect(dockHeightFromKey(200, 'Home', 800)).toBe(156);
    expect(dockHeightFromKey(200, 'Home', 300)).toBe(112);
    expect(dockHeightFromKey(200, 'End', 600)).toBe(487);
    expect(dockHeightFromKey(200, 'End', 300)).toBe(211);
    expect(dockHeightFromKey(200, 'Enter', 800)).toBeUndefined();
  });

  it('持久化并安全读取分隔条高度', () => {
    const state = persistDockHeight({ densities: { repo: 'standard' } }, 268);

    expect(state).toEqual({
      densities: { repo: 'standard' },
      dockHeight: 268,
    });
    expect(readPersistedDockHeight(state)).toBe(268);
    expect(readPersistedDockHeight({ dockHeight: Number.NaN })).toBeUndefined();
    expect(readPersistedDockHeight({ dockHeight: '268' })).toBeUndefined();
  });

  it('输出与实际高度契约一致的分隔条 ARIA 数值', () => {
    expect(dockResizerAriaValues(900, 600)).toEqual({
      minimum: 156,
      maximum: 487,
      current: 487,
    });
    expect(dockResizerAriaValues(20, 300)).toEqual({
      minimum: 112,
      maximum: 211,
      current: 112,
    });
  });

  it('绑定完整拖动、取消、捕获丢失、键盘和窗口缩放交互', () => {
    const resizerListeners = new Map<string, (event: unknown) => void>();
    const targetListeners = new Map<string, (event: unknown) => void>();
    const classes = new Set<string>();
    const captures = new Set<number>();
    const resizer = {
      classList: {
        add: (name: string) => { classes.add(name); },
        remove: (name: string) => { classes.delete(name); },
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        resizerListeners.set(type, listener);
      },
      setPointerCapture: (pointerId: number) => { captures.add(pointerId); },
      hasPointerCapture: (pointerId: number) => captures.has(pointerId),
      releasePointerCapture: (pointerId: number) => { captures.delete(pointerId); },
    } as unknown as HTMLElement;
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        targetListeners.set(type, listener);
      },
    } as unknown as Window;
    let height = 240;
    let preferredHeight: number | undefined = 268;
    const applied: { readonly height: number; readonly persist: boolean }[] = [];
    bindDockResizer({
      resizer,
      target,
      getDockHeight: () => height,
      getViewportHeight: () => 600,
      getPreferredHeight: () => preferredHeight,
      applyHeight: (nextHeight, persist) => {
        height = nextHeight;
        applied.push({ height: nextHeight, persist });
      },
    });
    const pointer = (pointerId: number, clientY: number) => ({
      pointerId,
      clientY,
      preventDefault: () => undefined,
    });

    resizerListeners.get('pointerdown')?.(pointer(1, 500));
    expect(captures.has(1)).toBe(true);
    expect(classes.has('is-dragging')).toBe(true);
    targetListeners.get('pointermove')?.(pointer(1, 450));
    expect(applied.at(-1)).toEqual({ height: 290, persist: false });
    targetListeners.get('pointerup')?.(pointer(1, 450));
    expect(applied.at(-1)).toEqual({ height: 290, persist: true });
    expect(captures.has(1)).toBe(false);
    expect(classes.has('is-dragging')).toBe(false);

    height = 240;
    applied.length = 0;
    resizerListeners.get('pointerdown')?.(pointer(2, 500));
    targetListeners.get('pointermove')?.(pointer(2, 430));
    targetListeners.get('pointercancel')?.(pointer(2, 430));
    expect(applied).toEqual([
      { height: 310, persist: false },
      { height: 310, persist: true },
    ]);
    expect(captures.has(2)).toBe(false);

    height = 240;
    applied.length = 0;
    resizerListeners.get('pointerdown')?.(pointer(3, 500));
    targetListeners.get('pointermove')?.(pointer(3, 460));
    resizerListeners.get('lostpointercapture')?.(pointer(3, 460));
    expect(applied.at(-1)).toEqual({ height: 280, persist: true });
    expect(classes.has('is-dragging')).toBe(false);

    height = 240;
    applied.length = 0;
    resizerListeners.get('pointerdown')?.(pointer(4, 500));
    targetListeners.get('pointermove')?.(pointer(4, 470));
    targetListeners.get('resize')?.({});
    expect(applied.at(-1)).toEqual({ height: 270, persist: false });
    targetListeners.get('pointerup')?.(pointer(4, 470));
    expect(applied.at(-1)).toEqual({ height: 270, persist: true });

    let prevented = false;
    height = 200;
    resizerListeners.get('keydown')?.({
      key: 'ArrowUp',
      preventDefault: () => { prevented = true; },
    });
    expect(prevented).toBe(true);
    expect(applied.at(-1)).toEqual({ height: 210, persist: true });

    preferredHeight = 268;
    targetListeners.get('resize')?.({});
    expect(applied.at(-1)).toEqual({ height: 268, persist: false });
  });
});
