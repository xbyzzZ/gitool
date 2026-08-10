export const minimumCommitDockHeight = 156;
export const compactMinimumCommitDockHeight = 112;
export const defaultCommitDockHeight = 240;

const compactViewportMaximum = 360;

export function minimumCommitDockHeightForViewport(
  viewportHeight: number,
): number {
  return viewportHeight <= compactViewportMaximum
    ? compactMinimumCommitDockHeight
    : minimumCommitDockHeight;
}

function reservedHeight(viewportHeight: number): number {
  return viewportHeight <= compactViewportMaximum ? 89 : 113;
}

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

export function clampCommitDockHeight(
  requestedHeight: number,
  viewportHeight: number,
): number {
  const safeViewport = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  const minimum = minimumCommitDockHeightForViewport(safeViewport);
  const maximum = Math.max(minimum, Math.floor(
    safeViewport - reservedHeight(safeViewport),
  ));
  const requested = Number.isFinite(requestedHeight)
    ? Math.round(requestedHeight)
    : defaultCommitDockHeight;
  return Math.min(maximum, Math.max(minimum, requested));
}

export function dockResizerAriaValues(
  currentHeight: number,
  viewportHeight: number,
): { readonly minimum: number; readonly maximum: number; readonly current: number } {
  return {
    minimum: minimumCommitDockHeightForViewport(viewportHeight),
    maximum: clampCommitDockHeight(Number.MAX_SAFE_INTEGER, viewportHeight),
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
      return clampCommitDockHeight(currentHeight + 10, viewportHeight);
    case 'ArrowDown':
      return clampCommitDockHeight(currentHeight - 10, viewportHeight);
    case 'Home':
      return minimumCommitDockHeightForViewport(viewportHeight);
    case 'End':
      return clampCommitDockHeight(Number.MAX_SAFE_INTEGER, viewportHeight);
    default:
      return undefined;
  }
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
    options.resizer.classList.add('is-dragging');
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
    options.resizer.classList.remove('is-dragging');
    options.applyHeight(options.getDockHeight(), true);
    releaseCapture(event.pointerId);
  });
  options.target.addEventListener('pointercancel', (event: PointerEvent) => {
    if (event.pointerId !== session?.pointerId) {
      return;
    }
    const originalHeight = session.height;
    session = undefined;
    options.resizer.classList.remove('is-dragging');
    options.applyHeight(originalHeight, false);
    releaseCapture(event.pointerId);
  });
  options.resizer.addEventListener(
    'lostpointercapture',
    (event: PointerEvent) => {
      if (event.pointerId !== session?.pointerId) {
        return;
      }
      const originalHeight = session.height;
      session = undefined;
      options.resizer.classList.remove('is-dragging');
      options.applyHeight(originalHeight, false);
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
      options.getPreferredHeight() ?? options.getDockHeight(),
      false,
    );
  });
}
