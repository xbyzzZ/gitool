import type {
  CommitFile,
  CommitGraphEdge,
  CommitGraphNode,
  CommitRef,
} from '../domain/history-model.js';
import type { HistoryState } from '../domain/view-model.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface RenderedHistoryFile {
  readonly file: CommitFile;
  readonly iconClass?: string | null;
}

export interface HistoryRenderCallbacks {
  readonly toggleCommit: (hash: string, expanded: boolean) => void;
  readonly openCommitDiff: (hash: string, path: string) => void;
}

export interface HistoryListMarkup {
  readonly markup: string;
  readonly status: string;
  readonly statusVisible: boolean;
}

export function formatRelativeTime(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return '';
  }
  const delta = Math.max(0, now - time);
  if (delta < MINUTE) {
    return '刚刚';
  }
  if (delta < HOUR) {
    return `${String(Math.floor(delta / MINUTE))} 分钟前`;
  }
  if (delta < DAY) {
    return `${String(Math.floor(delta / HOUR))} 小时前`;
  }
  if (delta < 30 * DAY) {
    return `${String(Math.floor(delta / DAY))} 天前`;
  }
  if (delta < 365 * DAY) {
    return `${String(Math.floor(delta / (30 * DAY)))} 个月前`;
  }
  return `${String(Math.floor(delta / (365 * DAY)))} 年前`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
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
  const height = 28;
  const center = height / 2;
  const nodeX = laneX(commit.lane, lanePitch);
  const passing = commit.passingEdges.map((edge) =>
    `<path class="graph-line lane-color-${String(edge.color % 6)}" d="${edgePath(edge, lanePitch, height)}"></path>`
  ).join('');
  const incoming = commit.hasIncoming
    ? `<path class="graph-line lane-color-${String(commit.color % 6)}" d="M ${String(nodeX)} 0 L ${String(nodeX)} ${String(center)}"></path>`
    : '';
  const parents = commit.parentEdges.map((edge) => {
    const parentX = laneX(edge.toLane, lanePitch);
    return `<path class="graph-line lane-color-${String(edge.color % 6)}" d="M ${String(nodeX)} ${String(center)} C ${String(nodeX)} ${String(center + 7)} ${String(parentX)} ${String(height - 7)} ${String(parentX)} ${String(height)}"></path>`;
  }).join('');
  const current = commit.refs.some((ref) => ref.kind === 'head');
  const merge = commit.parents.length > 1;
  return `<svg class="commit-graph" width="${String(graphWidth)}" height="${String(height)}" viewBox="0 0 ${String(graphWidth)} ${String(height)}" aria-hidden="true">`
    + passing
    + incoming
    + parents
    + `<circle class="graph-node lane-color-${String(commit.color % 6)}${current ? ' current' : ''}${merge ? ' merge' : ''}" cx="${String(nodeX)}" cy="${String(center)}" r="${merge ? '4' : '3.25'}"></circle>`
    + '</svg>';
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

function refChip(ref: CommitRef): string {
  const title = ref.kind === 'head' ? `HEAD · ${ref.name}` : ref.name;
  const icon = ref.kind === 'remote' ? 'cloud' : 'git-branch';
  return `<span class="commit-ref ${ref.kind}" title="${escapeHtml(title)}">`
    + `<span class="codicon codicon-${icon}" aria-hidden="true"></span>`
    + `<span class="commit-ref-label">${escapeHtml(ref.name)}</span>`
    + '</span>';
}

function fullDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return iso;
  }
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
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

function fileMarkup(rendered: RenderedHistoryFile): string {
  const file = rendered.file;
  const path = splitFilePath(file.path);
  const icon = rendered.iconClass === undefined || rendered.iconClass === null
    ? '<span class="codicon codicon-file history-file-icon" aria-hidden="true"></span>'
    : `<span class="history-file-icon ${escapeHtml(rendered.iconClass)}" aria-hidden="true"></span>`;
  const title = file.originalPath === undefined
    ? file.path
    : `${file.originalPath} → ${file.path}`;
  return `<button class="history-file" type="button" data-path="${escapeHtml(file.path)}" title="${escapeHtml(title)}" aria-label="打开 ${escapeHtml(file.path)} 的历史差异">`
    + '<span class="history-file-guide" aria-hidden="true"></span>'
    + icon
    + `<span class="history-file-name">${escapeHtml(path.name)}</span>`
    + (path.directory.length === 0
      ? ''
      : `<span class="history-file-directory">${escapeHtml(path.directory)}</span>`)
    + `<span class="history-file-status history-status-${escapeHtml(file.status.at(0) ?? 'M')}">${escapeHtml(file.status)}</span>`
    + '</button>';
}

function commitRow(
  commit: CommitGraphNode,
  expanded: boolean,
  files: readonly RenderedHistoryFile[] | undefined,
  metrics: { readonly width: number; readonly pitch: number },
  now: number,
): string {
  const refsTitle = commit.refs.map((ref) => ref.kind === 'head'
    ? `HEAD · ${ref.name}`
    : ref.name).join(' · ');
  const title = [
    commit.subject,
    `${commit.author} · ${fullDate(commit.authoredAt)} · ${commit.hash}`,
    refsTitle,
  ].filter((value) => value.length > 0).join('\n');
  const refs = commit.refs.length === 0
    ? ''
    : `<span class="history-refs">${commit.refs.map(refChip).join('')}</span>`;
  const filesMarkup = expanded
    ? `<div class="history-files">${files === undefined
      ? '<p class="history-files-status">正在读取提交文件…</p>'
      : files.map(fileMarkup).join('')}</div>`
    : '';
  return `<article class="history-entry${expanded ? ' expanded' : ''}" data-hash="${commit.hash}">`
    + `<button class="history-commit-row" type="button" aria-expanded="${String(expanded)}" title="${escapeHtml(title)}" aria-label="查看提交 ${escapeHtml(commit.shortHash)} 的文件变更">`
    + renderGraphMarkup(commit, metrics.width, metrics.pitch)
    + `<span class="codicon codicon-chevron-${expanded ? 'down' : 'right'} history-chevron" aria-hidden="true"></span>`
    + '<span class="history-commit-copy">'
    + `<span class="history-subject">${escapeHtml(commit.subject)}</span>`
    + refs
    + '<span class="history-meta">'
    + `<span class="history-hash">${escapeHtml(commit.shortHash)}</span>`
    + `<span class="history-author">${escapeHtml(commit.author)}</span>`
    + `<span class="history-time">${escapeHtml(formatRelativeTime(commit.authoredAt, now))}</span>`
    + '</span>'
    + '</span>'
    + '</button>'
    + filesMarkup
    + '</article>';
}

export function historyListMarkup(
  history: HistoryState,
  expandedHashes: ReadonlySet<string>,
  details: ReadonlyMap<string, readonly RenderedHistoryFile[]>,
  now: number,
): HistoryListMarkup {
  const metrics = graphMetrics(history.commits);
  const markup = history.commits.map((commit) => commitRow(
    commit,
    expandedHashes.has(commit.hash),
    details.get(commit.hash),
    metrics,
    now,
  )).join('');
  if (history.kind === 'failed') {
    return {
      markup,
      status: history.commits.length === 0 ? history.message : '',
      statusVisible: history.commits.length === 0,
    };
  }
  if (history.commits.length > 0) {
    return { markup, status: '', statusVisible: false };
  }
  if (history.kind === 'ready') {
    return { markup, status: '暂无提交记录', statusVisible: true };
  }
  return { markup, status: '正在读取提交历史…', statusVisible: true };
}

export function renderHistoryList(
  container: HTMLElement,
  status: HTMLElement,
  history: HistoryState,
  expandedHashes: ReadonlySet<string>,
  details: ReadonlyMap<string, readonly RenderedHistoryFile[]>,
  callbacks: HistoryRenderCallbacks,
  now: number,
): void {
  const view = historyListMarkup(history, expandedHashes, details, now);
  container.innerHTML = view.markup;
  status.textContent = view.status;
  status.hidden = !view.statusVisible;
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
