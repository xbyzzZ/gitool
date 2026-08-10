import type {
  CommitFile,
  CommitGraphEdge,
  CommitGraphNode,
} from '../domain/history-model.js';

export interface CommitRowRenderOptions {
  readonly expanded?: boolean;
  readonly files?: readonly CommitFile[];
  readonly graphWidth: number;
  readonly lanePitch: number;
  readonly now?: Date;
}

export interface HistoryRendererCallbacks {
  readonly toggleCommit: (hash: string, expanded: boolean) => void;
  readonly openCommitDiff: (hash: string, path: string) => void;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function relativeTime(authoredAt: string, now = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - Date.parse(authoredAt));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${String(minutes)} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${String(days)} 天前`;
  }
  return new Date(authoredAt).toLocaleDateString('zh-CN');
}

function laneX(lane: number, pitch: number): number {
  return 8 + lane * pitch;
}

function edgePath(
  edge: CommitGraphEdge,
  pitch: number,
  height: number,
): string {
  const from = laneX(edge.fromLane, pitch);
  const to = laneX(edge.toLane, pitch);
  return `M ${String(from)} 0 C ${String(from)} ${String(height * 0.35)} ${String(to)} ${String(height * 0.65)} ${String(to)} ${String(height)}`;
}

export function renderGraphMarkup(
  commit: CommitGraphNode,
  graphWidth: number,
  lanePitch: number,
): string {
  const height = 42;
  const center = height / 2;
  const nodeX = laneX(commit.lane, lanePitch);
  const passing = commit.passingEdges.map((edge) =>
    `<path class="graph-line lane-color-${String(edge.fromLane % 6)}" d="${edgePath(edge, lanePitch, height)}"></path>`
  ).join('');
  const incoming = commit.hasIncoming
    ? `<path class="graph-line lane-color-${String(commit.lane % 6)}" d="M ${String(nodeX)} 0 L ${String(nodeX)} ${String(center)}"></path>`
    : '';
  const parents = commit.parentLanes.map((parentLane, index) => {
    const parentX = laneX(parentLane, lanePitch);
    return `<path class="graph-line lane-color-${String((commit.lane + index) % 6)}" d="M ${String(nodeX)} ${String(center)} C ${String(nodeX)} ${String(center + 7)} ${String(parentX)} ${String(height - 7)} ${String(parentX)} ${String(height)}"></path>`;
  }).join('');
  const current = commit.refs.some((ref) => ref.kind === 'head');
  const merge = commit.parents.length > 1;
  return `<svg class="commit-graph" width="${String(graphWidth)}" height="${String(height)}" viewBox="0 0 ${String(graphWidth)} ${String(height)}" aria-hidden="true">`
    + passing
    + incoming
    + parents
    + `<circle class="graph-node lane-color-${String(commit.lane % 6)}${current ? ' current' : ''}${merge ? ' merge' : ''}" cx="${String(nodeX)}" cy="${String(center)}" r="${merge ? '4' : '3.25'}"></circle>`
    + '</svg>';
}

function refMarkup(commit: CommitGraphNode): string {
  return commit.refs.map((ref) => {
    const label = ref.kind === 'head' ? `HEAD  ${ref.name}` : ref.name;
    const icon = ref.kind === 'remote' ? 'cloud' : 'git-branch';
    return `<span class="commit-ref ${ref.kind}" title="${escapeHtml(label)}"><span class="codicon codicon-${icon}" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
  }).join('');
}

function splitFilePath(path: string): {
  readonly name: string;
  readonly directory: string;
} {
  const segments = path.split('/');
  return {
    name: segments.pop() ?? path,
    directory: segments.join('/'),
  };
}

function fileMarkup(file: CommitFile): string {
  const path = splitFilePath(file.path);
  return `<button class="history-file" type="button" data-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">`
    + '<span class="history-file-guide" aria-hidden="true"></span>'
    + '<span class="codicon codicon-file history-file-icon" aria-hidden="true"></span>'
    + `<span class="history-file-name">${escapeHtml(path.name)}</span>`
    + (path.directory.length === 0
      ? ''
      : `<span class="history-file-directory">${escapeHtml(path.directory)}</span>`)
    + `<span class="history-file-status status-${escapeHtml(file.status.at(0) ?? 'M')}">${escapeHtml(file.status)}</span>`
    + '</button>';
}

export function renderCommitRowMarkup(
  commit: CommitGraphNode,
  options: CommitRowRenderOptions,
): string {
  const expanded = options.expanded === true;
  const meta = `${commit.author} · ${relativeTime(
    commit.authoredAt,
    options.now,
  )} · ${commit.shortHash}`;
  const title = `${commit.subject}\n${commit.author} · ${commit.authoredAt}\n${commit.hash}`;
  const files = expanded
    ? `<div class="history-files">${(options.files ?? []).map(fileMarkup).join('')}</div>`
    : '';
  return `<article class="history-entry${expanded ? ' expanded' : ''}" role="listitem" data-hash="${commit.hash}" style="--graph-width:${String(options.graphWidth)}px">`
    + `<button class="history-commit-row" type="button" aria-expanded="${String(expanded)}" title="${escapeHtml(title)}">`
    + renderGraphMarkup(commit, options.graphWidth, options.lanePitch)
    + `<span class="codicon codicon-chevron-${expanded ? 'down' : 'right'} history-chevron" aria-hidden="true"></span>`
    + '<span class="history-commit-copy">'
    + '<span class="history-commit-primary">'
    + `<span class="history-subject">${escapeHtml(commit.subject)}</span>`
    + `<span class="history-refs">${refMarkup(commit)}</span>`
    + '</span>'
    + `<span class="history-meta">${escapeHtml(meta)}</span>`
    + '</span>'
    + '</button>'
    + files
    + '</article>';
}

export function graphMetrics(commits: readonly CommitGraphNode[]): {
  readonly width: number;
  readonly pitch: number;
} {
  const laneCount = Math.max(1, ...commits.map((commit) => commit.laneCount));
  const width = Math.min(92, 16 + (laneCount - 1) * 12);
  return {
    width,
    pitch: laneCount === 1 ? 12 : (width - 16) / (laneCount - 1),
  };
}

export function renderHistory(
  container: HTMLElement,
  commits: readonly CommitGraphNode[],
  expandedHashes: ReadonlySet<string>,
  details: ReadonlyMap<string, readonly CommitFile[]>,
  callbacks: HistoryRendererCallbacks,
): void {
  const metrics = graphMetrics(commits);
  container.innerHTML = commits.map((commit) => renderCommitRowMarkup(commit, {
    expanded: expandedHashes.has(commit.hash),
    graphWidth: metrics.width,
    lanePitch: metrics.pitch,
    ...(details.get(commit.hash) === undefined
      ? {}
      : { files: details.get(commit.hash) ?? [] }),
  })).join('');
  for (const entry of container.querySelectorAll<HTMLElement>('.history-entry')) {
    const hash = entry.dataset.hash;
    if (hash === undefined) {
      continue;
    }
    entry.querySelector<HTMLButtonElement>('.history-commit-row')
      ?.addEventListener('click', () => {
        callbacks.toggleCommit(hash, !expandedHashes.has(hash));
      });
    for (const file of entry.querySelectorAll<HTMLButtonElement>('.history-file')) {
      const path = file.dataset.path;
      if (path !== undefined) {
        file.addEventListener('click', () => {
          callbacks.openCommitDiff(hash, path);
        });
      }
    }
  }
}
