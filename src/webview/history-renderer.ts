import type {
  CommitFile,
  CommitGraphNode,
  CommitRef,
} from '../domain/history-model.js';
import type { HistoryState } from '../domain/view-model.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const GRAPH_WIDTH_FALLBACK = 54;
const GRAPH_LANE_MAX = 6;
const GRAPH_ROW_ANCHOR_OFFSET = 16;

const CHEVRON_ICON = '<svg class="chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
const COPY_ICON = '<svg class="copy-icon" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M11 5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5.5A1.5 1.5 0 0 0 4 11h1"/></svg>';
const FILE_ICON = '<svg class="file-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2h5l3.5 3.5V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M9 2v4h4"/></svg>';
const CLOUD_ICON = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5a2.75 2.75 0 0 1 .4-5.47A3.75 3.75 0 0 1 12 7.6a2.5 2.5 0 0 1-.5 4.9H4Z"/></svg>';
const BRANCH_ICON = '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M4 4.5v7"/><path d="M12 6.5c0 2.6-3 3-7 3"/></svg>';

export interface RenderedHistoryFile {
  readonly file: CommitFile;
  readonly iconClass?: string | null;
}

export interface HistoryRenderCallbacks {
  readonly toggleCommit: (hash: string, expanded: boolean) => void;
  readonly openCommitDiff: (hash: string, path: string) => void;
  readonly copyHash: (hash: string) => void;
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
  if (delta < 2 * DAY) {
    return '昨天';
  }
  if (delta < WEEK) {
    return `${String(Math.floor(delta / DAY))} 天前`;
  }
  return `${String(Math.max(1, Math.round(delta / WEEK)))} 周前`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function isCurrentCommit(commit: CommitGraphNode): boolean {
  return commit.refs.some((ref) => ref.kind === 'head');
}

function commitKind(commit: CommitGraphNode): 'merge' | 'current' | 'normal' {
  if (commit.parents.length >= 2) {
    return 'merge';
  }
  return isCurrentCommit(commit) ? 'current' : 'normal';
}

function refBadge(ref: CommitRef): string {
  if (ref.kind === 'head') {
    return `<span class="badge-head" title="HEAD · ${escapeHtml(ref.name)}">HEAD</span>`;
  }
  if (ref.kind === 'local') {
    return `<span class="badge-branch" title="${escapeHtml(ref.name)}">${BRANCH_ICON}${escapeHtml(ref.name)}</span>`;
  }
  return `<span class="badge-origin" title="${escapeHtml(ref.name)}">${CLOUD_ICON}<span class="origin-txt">${escapeHtml(ref.name)}</span></span>`;
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

const STATUS_LETTERS = new Set(['M', 'A', 'D', 'R', 'T']);

function statusLetter(status: string): string {
  const letter = (status.at(0) ?? 'M').toUpperCase();
  if (letter === 'C') {
    return 'A';
  }
  return STATUS_LETTERS.has(letter) ? letter : 'T';
}

function fileMarkup(rendered: RenderedHistoryFile): string {
  const file = rendered.file;
  const path = splitFilePath(file.path);
  const letter = statusLetter(file.status);
  const icon = rendered.iconClass === undefined || rendered.iconClass === null
    ? FILE_ICON
    : `<span class="file-icon ${escapeHtml(rendered.iconClass)}" aria-hidden="true"></span>`;
  const title = file.originalPath === undefined
    ? file.path
    : `${file.originalPath} → ${file.path}`;
  const directory = path.directory.length === 0 ? '' : `${path.directory}/`;
  return `<button class="history-file" type="button" data-od-id="history-file" data-status="${letter}" data-path="${escapeHtml(file.path)}" title="${escapeHtml(title)}" aria-label="打开 ${escapeHtml(file.path)} 的历史差异">`
    + `<span class="status-block" aria-hidden="true">${letter}</span>`
    + icon
    + `<span class="file-name">${escapeHtml(path.name)}</span>`
    + `<span class="file-dir">${escapeHtml(directory)}</span>`
    + '<span class="diff-link">打开 diff</span>'
    + '</button>';
}

function filesMarkup(
  expanded: boolean,
  files: readonly RenderedHistoryFile[] | undefined,
): string {
  if (!expanded) {
    return '';
  }
  if (files === undefined) {
    return '<div class="files-empty">正在读取提交文件…</div>';
  }
  if (files.length === 0) {
    return '<div class="files-empty">合并提交 · 无文件变更</div>';
  }
  return files.map(fileMarkup).join('');
}

function commitEntryMarkup(
  commit: CommitGraphNode,
  expanded: boolean,
  files: readonly RenderedHistoryFile[] | undefined,
  now: number,
): string {
  const current = isCurrentCommit(commit);
  const classes = `commit-entry${current ? ' is-current' : ''}${expanded ? ' is-open' : ''}`;
  const search = `${commit.subject} ${commit.author} ${commit.shortHash} ${commit.hash}`.toLowerCase();
  return `<section class="${classes}" data-od-id="commit-entry" data-hash="${escapeHtml(commit.hash)}" data-kind="${commitKind(commit)}" data-lane="${String(commit.lane)}" data-search="${escapeHtml(search)}">`
    + `<div class="entry-head" role="button" tabindex="0" aria-expanded="${String(expanded)}" aria-label="展开提交 ${escapeHtml(commit.shortHash)}">`
    + '<div class="row-top">'
    + CHEVRON_ICON
    + `<span class="subject">${escapeHtml(commit.subject)}</span>`
    + `<span class="badges">${commit.refs.map(refBadge).join('')}</span>`
    + '</div>'
    + '<div class="row-meta">'
    + `<button class="hash-btn" type="button" data-hash="${escapeHtml(commit.hash)}" title="复制提交哈希" aria-label="复制提交哈希 ${escapeHtml(commit.shortHash)}">${escapeHtml(commit.shortHash)}${COPY_ICON}</button>`
    + '<span class="meta-sep" aria-hidden="true">·</span>'
    + `<span class="meta-author">${escapeHtml(commit.author)}</span>`
    + '<span class="meta-sep" aria-hidden="true">·</span>'
    + `<span class="meta-time">${escapeHtml(formatRelativeTime(commit.authoredAt, now))}</span>`
    + '</div>'
    + '</div>'
    + `<div class="files">${filesMarkup(expanded, files)}</div>`
    + '</section>';
}

export function historyListMarkup(
  history: HistoryState,
  expandedHashes: ReadonlySet<string>,
  details: ReadonlyMap<string, readonly RenderedHistoryFile[]>,
  now: number,
): HistoryListMarkup {
  const markup = history.commits.map((commit) => commitEntryMarkup(
    commit,
    expandedHashes.has(commit.hash),
    details.get(commit.hash),
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

function isWithinHashButton(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return typeof element?.closest === 'function'
    && element.closest('.hash-btn') !== null
    && element.closest('.hash-btn') !== undefined;
}

export function bindHistoryEntry(
  entry: HTMLElement,
  callbacks: HistoryRenderCallbacks,
): void {
  const hash = entry.dataset.hash;
  if (hash === undefined) {
    return;
  }
  const head = entry.querySelector<HTMLElement>('.entry-head');
  const expanded = (): boolean => head?.getAttribute('aria-expanded') === 'true';
  head?.addEventListener('click', (event) => {
    if (isWithinHashButton(event.target)) {
      return;
    }
    callbacks.toggleCommit(hash, !expanded());
  });
  head?.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === head) {
      event.preventDefault();
      callbacks.toggleCommit(hash, !expanded());
    }
  });
  entry.querySelector('.hash-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    callbacks.copyHash(hash);
  });
  for (const file of entry.querySelectorAll<HTMLElement>('.history-file')) {
    const path = file.dataset.path;
    if (path === undefined) {
      continue;
    }
    file.addEventListener('click', () => {
      callbacks.openCommitDiff(hash, path);
    });
  }
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
  for (const stale of container.querySelectorAll('.commit-entry')) {
    stale.remove();
  }
  if (view.markup.length > 0) {
    const template = document.createElement('template');
    template.innerHTML = view.markup;
    container.insertBefore(
      template.content,
      container.querySelector('.empty-state'),
    );
  }
  status.textContent = view.status;
  status.hidden = !view.statusVisible;
  for (const entry of container.querySelectorAll<HTMLElement>('.commit-entry')) {
    bindHistoryEntry(entry, callbacks);
  }
}

export interface HistoryGraphAnchor {
  readonly hash: string;
  readonly y: number;
}

export function laneXs(laneCount: number, width: number): readonly number[] {
  const count = Math.max(1, Math.min(GRAPH_LANE_MAX, Math.floor(laneCount)));
  if (count === 1) {
    return [Math.round(width * 0.33)];
  }
  return Array.from({ length: count }, (_, index) =>
    Math.round(width * (0.33 + 0.45 * index / (count - 1))));
}

function laneClass(color: number): string {
  return String(color % GRAPH_LANE_MAX + 1);
}

function graphEdgeMarkup(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  lane: string,
): string {
  const style = `class="graph-s${lane}" stroke-width="1.5" fill="none" opacity="0.55"`;
  if (fromX === toX) {
    return `<path d="M ${String(fromX)} ${String(fromY)} L ${String(toX)} ${String(toY)}" ${style}/>`;
  }
  const mid = (fromY + toY) / 2;
  return `<path d="M ${String(fromX)} ${String(fromY)} L ${String(fromX)} ${String(mid)}" ${style}/>`
    + `<path d="M ${String(fromX)} ${String(mid)} C ${String(fromX)} ${String(toY)}, ${String(toX)} ${String(toY)}, ${String(toX)} ${String(toY)}" ${style}/>`;
}

function graphNodeMarkup(
  commit: CommitGraphNode,
  cx: number,
  cy: number,
): string {
  const at = `cx="${String(cx)}" cy="${String(cy)}"`;
  const lane = laneClass(commit.color);
  if (commit.parents.length >= 2) {
    return `<circle ${at} r="5" class="graph-s${lane} graph-surface" stroke-width="1.6"/>`
      + `<circle ${at} r="2.6" class="graph-s${lane}" stroke-width="1" fill="none" opacity="0.7"/>`;
  }
  if (isCurrentCommit(commit)) {
    return `<circle ${at} r="8.5" class="graph-accent" stroke-width="1" fill="none" opacity="0.25"/>`
      + `<circle ${at} r="6" class="graph-accent" stroke-width="1.5" fill="none" opacity="0.55"/>`
      + `<circle ${at} r="3.5" class="graph-f${lane}"/>`;
  }
  return `<circle ${at} r="3.5" class="graph-f${lane}"/>`;
}

export function historyGraphMarkup(
  anchors: readonly HistoryGraphAnchor[],
  commits: readonly CommitGraphNode[],
  width: number,
  height: number,
): string {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const nodes = anchors.flatMap((anchor) => {
    const commit = byHash.get(anchor.hash);
    return commit === undefined ? [] : [{ commit, y: anchor.y }];
  });
  if (nodes.length === 0) {
    return '';
  }
  const laneCount = Math.max(1, ...nodes.map((node) => node.commit.lane + 1));
  const xs = laneXs(laneCount, width);
  const laneX = (lane: number): number =>
    xs[Math.min(Math.max(0, lane), xs.length - 1)] ?? Math.round(width * 0.33);
  const yByHash = new Map(nodes.map((node) => [node.commit.hash, node.y]));
  const parts: string[] = [
    `<svg id="graph-svg" viewBox="0 0 ${String(width)} ${String(height)}" preserveAspectRatio="none" width="${String(width)}" height="${String(height)}" aria-hidden="true">`,
  ];
  for (const node of nodes) {
    node.commit.parents.forEach((parentHash, index) => {
      const parent = byHash.get(parentHash);
      const parentY = yByHash.get(parentHash);
      if (parent === undefined || parentY === undefined) {
        return;
      }
      const edge = node.commit.parentEdges[index];
      const lane = laneClass(edge?.color ?? node.commit.color);
      parts.push(graphEdgeMarkup(
        laneX(node.commit.lane),
        node.y,
        laneX(parent.lane),
        parentY,
        lane,
      ));
    });
  }
  for (const node of nodes) {
    parts.push(graphNodeMarkup(node.commit, laneX(node.commit.lane), node.y));
  }
  parts.push('</svg>');
  return parts.join('');
}

export function renderHistoryGraph(
  graphHost: HTMLElement,
  listEl: HTMLElement,
  commits: readonly CommitGraphNode[],
): void {
  if (commits.length === 0) {
    graphHost.innerHTML = '';
    return;
  }
  const anchors: HistoryGraphAnchor[] = [];
  for (const entry of listEl.querySelectorAll<HTMLElement>('.commit-entry')) {
    if (entry.style.display === 'none') {
      continue;
    }
    const hash = entry.dataset.hash;
    if (hash !== undefined) {
      anchors.push({ hash, y: entry.offsetTop + GRAPH_ROW_ANCHOR_OFFSET });
    }
  }
  const width = graphHost.clientWidth || GRAPH_WIDTH_FALLBACK;
  const height = listEl.scrollHeight || 1;
  graphHost.innerHTML = historyGraphMarkup(anchors, commits, width, height);
}
