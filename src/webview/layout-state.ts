export type PaneName = 'commit' | 'changes' | 'history';
export type ResizeHandle = 'commit-changes' | 'changes-history';

export interface WorkbenchLayoutState {
  readonly heights: Record<PaneName, number>;
  readonly collapsed: Record<PaneName, boolean>;
}

const paneNames: readonly PaneName[] = ['commit', 'changes', 'history'];
const minimumHeights: Readonly<Record<PaneName, number>> = {
  commit: 150,
  changes: 96,
  history: 66,
};
const collapsedHeight = 34;

export const defaultLayoutState: WorkbenchLayoutState = {
  heights: {
    commit: 150,
    changes: 240,
    history: 240,
  },
  collapsed: {
    commit: false,
    changes: false,
    history: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLayoutState(input: unknown): WorkbenchLayoutState | undefined {
  if (!isRecord(input) || !isRecord(input.heights)
    || !isRecord(input.collapsed)) {
    return undefined;
  }
  const heights = {} as Record<PaneName, number>;
  const collapsed = {} as Record<PaneName, boolean>;
  for (const pane of paneNames) {
    const height = input.heights[pane];
    const isCollapsed = input.collapsed[pane];
    if (typeof height !== 'number' || !Number.isFinite(height)
      || typeof isCollapsed !== 'boolean') {
      return undefined;
    }
    heights[pane] = height;
    collapsed[pane] = isCollapsed;
  }
  return { heights, collapsed };
}

function fitToViewport(
  heights: Record<PaneName, number>,
  collapsed: Readonly<Record<PaneName, boolean>>,
  viewportHeight: number,
): void {
  const displayedHeight = (pane: PaneName): number => collapsed[pane]
    ? collapsedHeight
    : heights[pane];
  const displayedTotal = (): number => paneNames.reduce(
    (total, pane) => total + displayedHeight(pane),
    0,
  );
  let overflow = displayedTotal() - viewportHeight;
  for (const pane of ['history', 'changes', 'commit'] as const) {
    if (overflow <= 0) {
      break;
    }
    if (collapsed[pane]) {
      continue;
    }
    const available = heights[pane] - minimumHeights[pane];
    const reduction = Math.min(available, overflow);
    heights[pane] -= reduction;
    overflow -= reduction;
  }
  const remaining = viewportHeight - displayedTotal();
  if (remaining <= 0) {
    return;
  }
  const fillPane = [...paneNames].reverse().find((pane) => !collapsed[pane]);
  if (fillPane !== undefined) {
    heights[fillPane] += remaining;
  }
}

export function normalizeLayoutState(
  input: unknown,
  viewportHeight: number,
): WorkbenchLayoutState {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return defaultLayoutState;
  }
  const parsed = parseLayoutState(input) ?? defaultLayoutState;
  const heights = { ...parsed.heights };
  for (const pane of paneNames) {
    heights[pane] = Math.max(minimumHeights[pane], heights[pane]);
  }
  fitToViewport(heights, parsed.collapsed, viewportHeight);
  return {
    heights,
    collapsed: { ...parsed.collapsed },
  };
}

export function togglePane(
  state: WorkbenchLayoutState,
  pane: PaneName,
): WorkbenchLayoutState {
  return {
    heights: { ...state.heights },
    collapsed: {
      ...state.collapsed,
      [pane]: !state.collapsed[pane],
    },
  };
}

export function resizeLayout(
  state: WorkbenchLayoutState,
  handle: ResizeHandle,
  delta: number,
  viewportHeight: number,
): WorkbenchLayoutState {
  const pair: readonly [PaneName, PaneName] = handle === 'commit-changes'
    ? ['commit', 'changes']
    : ['changes', 'history'];
  if (state.collapsed[pair[0]] || state.collapsed[pair[1]]) {
    return state;
  }
  const normalized = normalizeLayoutState(state, viewportHeight);
  const total = normalized.heights[pair[0]] + normalized.heights[pair[1]];
  const first = Math.max(
    minimumHeights[pair[0]],
    Math.min(
      total - minimumHeights[pair[1]],
      normalized.heights[pair[0]] + delta,
    ),
  );
  return {
    heights: {
      ...normalized.heights,
      [pair[0]]: first,
      [pair[1]]: total - first,
    },
    collapsed: { ...normalized.collapsed },
  };
}

export function resetLayout(
  _state: WorkbenchLayoutState,
  viewportHeight: number,
): WorkbenchLayoutState {
  return normalizeLayoutState(defaultLayoutState, viewportHeight);
}
