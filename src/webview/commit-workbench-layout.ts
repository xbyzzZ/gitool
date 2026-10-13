export const minimumCommitDockHeight = 150;
export const defaultCommitDockHeight = 240;

const dockViewportRatio = 0.4;
const keyboardStep = 16;
const popoverViewportMargin = 8;
const popoverAnchorGap = 6;

export function readPersistedDockHeight(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !('dockHeight' in value)) {
    return undefined;
  }
  const height = value.dockHeight;
  return typeof height === 'number' && Number.isFinite(height)
    ? height
    : undefined;
}

export function persistDockHeight<T extends object>(
  state: T,
  height: number,
): T & { readonly dockHeight: number } {
  return { ...state, dockHeight: height };
}

export function maximumCommitDockHeight(viewportHeight: number): number {
  const safeViewport = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  return Math.max(
    minimumCommitDockHeight,
    Math.floor(safeViewport * dockViewportRatio),
  );
}

export function clampCommitDockHeight(
  requestedHeight: number,
  viewportHeight: number,
): number {
  const maximum = maximumCommitDockHeight(viewportHeight);
  const requested = Number.isFinite(requestedHeight)
    ? Math.round(requestedHeight)
    : defaultCommitDockHeight;
  return Math.min(maximum, Math.max(minimumCommitDockHeight, requested));
}

export function dockResizerAriaValues(
  currentHeight: number,
  viewportHeight: number,
): { readonly minimum: number; readonly maximum: number; readonly current: number } {
  return {
    minimum: minimumCommitDockHeight,
    maximum: maximumCommitDockHeight(viewportHeight),
    current: clampCommitDockHeight(currentHeight, viewportHeight),
  };
}

export function dockHeightFromPointer(
  startHeight: number,
  startClientY: number,
  currentClientY: number,
  viewportHeight: number,
): number {
  return clampCommitDockHeight(
    startHeight + startClientY - currentClientY,
    viewportHeight,
  );
}

export function dockHeightFromKey(
  currentHeight: number,
  key: string,
  viewportHeight: number,
): number | undefined {
  switch (key) {
    case 'ArrowUp':
      return clampCommitDockHeight(currentHeight + keyboardStep, viewportHeight);
    case 'ArrowDown':
      return clampCommitDockHeight(currentHeight - keyboardStep, viewportHeight);
    case 'Home':
      return minimumCommitDockHeight;
    case 'End':
      return maximumCommitDockHeight(viewportHeight);
    default:
      return undefined;
  }
}

export function popoverHorizontalOffset(
  anchorLeft: number,
  popoverWidth: number,
  viewportWidth: number,
): number {
  const safeViewport = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const safeWidth = Number.isFinite(popoverWidth)
    ? Math.max(0, popoverWidth)
    : 0;
  const maximum = Math.max(
    popoverViewportMargin,
    safeViewport - safeWidth - popoverViewportMargin,
  );
  const left = Number.isFinite(anchorLeft) ? anchorLeft : popoverViewportMargin;
  return Math.round(Math.min(Math.max(left, popoverViewportMargin), maximum));
}

export function popoverBottomOffset(
  anchorTop: number,
  viewportHeight: number,
): number {
  return Math.round(viewportHeight - anchorTop) + popoverAnchorGap;
}

export interface DockResizerBindingOptions {
  readonly resizer: HTMLElement;
  readonly target: Window;
  readonly getDockHeight: () => number;
  readonly getViewportHeight: () => number;
  readonly getPreferredHeight: () => number | undefined;
  readonly applyHeight: (height: number, persist: boolean) => void;
}

export function bindDockResizer(options: DockResizerBindingOptions): void {
  let session: {
    readonly pointerId: number;
    readonly clientY: number;
    readonly height: number;
  } | undefined;

  options.resizer.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault();
    session = {
      pointerId: event.pointerId,
      clientY: event.clientY,
      height: options.getDockHeight(),
    };
    options.resizer.classList.add('dragging');
    options.resizer.setPointerCapture(event.pointerId);
  });
  options.target.addEventListener('pointermove', (event: PointerEvent) => {
    if (event.pointerId !== session?.pointerId) {
      return;
    }
    options.applyHeight(dockHeightFromPointer(
      session.height,
      session.clientY,
      event.clientY,
      options.getViewportHeight(),
    ), false);
  });

  const releaseCapture = (pointerId: number): void => {
    if (options.resizer.hasPointerCapture(pointerId)) {
      options.resizer.releasePointerCapture(pointerId);
    }
  };
  options.target.addEventListener('pointerup', (event: PointerEvent) => {
    if (event.pointerId !== session?.pointerId) {
      return;
    }
    session = undefined;
    options.resizer.classList.remove('dragging');
    options.applyHeight(options.getDockHeight(), true);
    releaseCapture(event.pointerId);
  });
  options.target.addEventListener('pointercancel', (event: PointerEvent) => {
    if (event.pointerId !== session?.pointerId) {
      return;
    }
    session = undefined;
    options.resizer.classList.remove('dragging');
    options.applyHeight(options.getDockHeight(), true);
    releaseCapture(event.pointerId);
  });
  options.resizer.addEventListener(
    'lostpointercapture',
    (event: PointerEvent) => {
      if (event.pointerId !== session?.pointerId) {
        return;
      }
      session = undefined;
      options.resizer.classList.remove('dragging');
      options.applyHeight(options.getDockHeight(), true);
    },
  );
  options.resizer.addEventListener('keydown', (event: KeyboardEvent) => {
    const nextHeight = dockHeightFromKey(
      options.getDockHeight(),
      event.key,
      options.getViewportHeight(),
    );
    if (nextHeight !== undefined) {
      event.preventDefault();
      options.applyHeight(nextHeight, true);
    }
  });
  options.target.addEventListener('resize', () => {
    options.applyHeight(
      session === undefined
        ? (options.getPreferredHeight() ?? options.getDockHeight())
        : options.getDockHeight(),
      false,
    );
  });
}
