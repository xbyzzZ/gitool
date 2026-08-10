import type { CommitGraphEdge, CommitGraphNode } from '../domain/history-model.js';

export interface CommitRowRenderOptions {
  readonly selected?: boolean;
  readonly graphWidth: number;
  readonly lanePitch: number;
  readonly now?: Date;
}

export interface HistoryRendererCallbacks {
  readonly selectCommit: (hash: string) => void;
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

function refMarkup(commit: CommitGraphNode): string {
  return commit.refs.map((ref) => {
    const label = ref.name;
    const title = ref.kind === 'head' ? `HEAD · ${ref.name}` : ref.name;
    const icon = ref.kind === 'remote' ? 'cloud' : 'git-branch';
    return `<span class="commit-ref ${ref.kind}" title="${escapeHtml(title)}"><span class="codicon codicon-${icon}" aria-hidden="true"></span><span class="commit-ref-label">${escapeHtml(label)}</span></span>`;
  }).join('');
}

export function renderCommitRowMarkup(
  commit: CommitGraphNode,
  options: CommitRowRenderOptions,
): string {
  const selected = options.selected === true;
  const time = relativeTime(commit.authoredAt, options.now);
  const refs = commit.refs.map((ref) => ref.kind === 'head'
    ? `HEAD · ${ref.name}`
    : ref.name).join(' · ');
  const title = [
    commit.subject,
    `${commit.author} · ${commit.authoredAt} · ${commit.hash}`,
    refs,
  ].filter((value) => value.length > 0).join('\n');
  const refsMarkup = commit.refs.length === 0
    ? ''
    : `<span class="history-refs">${refMarkup(commit)}</span>`;
  return `<article class="history-entry${selected ? ' selected' : ''}" role="listitem" data-hash="${commit.hash}">`
    + `<button class="history-commit-row" type="button" aria-pressed="${String(selected)}" title="${escapeHtml(title)}">`
    + renderGraphMarkup(commit, options.graphWidth, options.lanePitch)
    + '<span class="history-commit-copy">'
    + `<span class="history-subject">${escapeHtml(commit.subject)}</span>`
    + refsMarkup
    + '<span class="history-meta">'
    + `<span class="history-author">${escapeHtml(commit.author)}</span>`
    + `<span class="history-time">${escapeHtml(time)}</span>`
    + `<span class="history-hash">${escapeHtml(commit.shortHash)}</span>`
    + '</span>'
    + '</span>'
    + '</button>'
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
  selectedHash: string | undefined,
  callbacks: HistoryRendererCallbacks,
): void {
  const metrics = graphMetrics(commits);
  container.innerHTML = commits.map((commit) => renderCommitRowMarkup(commit, {
    selected: selectedHash === commit.hash,
    graphWidth: metrics.width,
    lanePitch: metrics.pitch,
  })).join('');
  for (const entry of container.querySelectorAll<HTMLElement>('.history-entry')) {
    const hash = entry.dataset.hash;
    if (hash === undefined) {
      continue;
    }
    entry.querySelector<HTMLButtonElement>('.history-commit-row')
      ?.addEventListener('click', () => {
        callbacks.selectCommit(hash);
      });
  }
}
