import type {
  CommitFile,
  CommitGraphNode,
} from '../domain/history-model.js';
import { resolveFileIcon } from './file-icons.js';

export interface CommitRowRenderOptions {
  readonly expanded?: boolean;
  readonly files?: readonly CommitFile[];
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

function refMarkup(commit: CommitGraphNode): string {
  return commit.refs.map((ref) => {
    const label = ref.kind === 'head' ? `HEAD ${ref.name}` : ref.name;
    return `<span class="commit-ref ${ref.kind}">${escapeHtml(label)}</span>`;
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

export function renderCommitRowMarkup(
  commit: CommitGraphNode,
  options: CommitRowRenderOptions = {},
): string {
  const expanded = options.expanded === true;
  const meta = `${commit.author} · ${relativeTime(
    commit.authoredAt,
    options.now,
  )} · ${commit.shortHash}`;
  const title = `${commit.subject}\n${commit.author} · ${commit.authoredAt} · ${commit.hash}`;
  const files = expanded
    ? `<div class="commit-files">${(options.files ?? []).map((file) => {
      const path = splitFilePath(file.path);
      const icon = resolveFileIcon(file.path);
      return `<button class="commit-file" type="button" data-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">`
        + '<span class="commit-file-graph" aria-hidden="true"></span>'
        + `<span class="commit-file-icon file-icon ${icon.color}" aria-hidden="true">${escapeHtml(icon.glyph)}</span>`
        + `<span class="commit-file-name">${escapeHtml(path.name)}</span>`
        + (path.directory.length === 0
          ? ''
          : `<span class="commit-file-directory">${escapeHtml(path.directory)}</span>`)
        + `<span class="commit-file-status">${escapeHtml(file.status)}</span>`
        + '</button>';
    }).join('')}</div>`
    : '';
  return `<article class="commit-entry${expanded ? ' expanded' : ''}" data-hash="${commit.hash}">`
    + `<button class="commit-row" type="button" role="treeitem" aria-expanded="${String(expanded)}" title="${escapeHtml(title)}">`
    + `<span class="graph-cell lane-${String(commit.lane)}" aria-hidden="true"><span class="graph-dot"></span></span>`
    + `<span class="commit-chevron" aria-hidden="true">${expanded ? '⌄' : '›'}</span>`
    + `<span class="commit-subject">${escapeHtml(commit.subject)}</span>`
    + `<span class="commit-meta">${escapeHtml(meta)}</span>`
    + `<span class="commit-refs">${refMarkup(commit)}</span>`
    + '</button>'
    + files
    + '</article>';
}

export function renderHistory(
  container: HTMLElement,
  commits: readonly CommitGraphNode[],
  expandedHashes: ReadonlySet<string>,
  details: ReadonlyMap<string, readonly CommitFile[]>,
  callbacks: HistoryRendererCallbacks,
): void {
  container.innerHTML = commits.map((commit) => renderCommitRowMarkup(commit, {
    expanded: expandedHashes.has(commit.hash),
    ...(details.get(commit.hash) === undefined
      ? {}
      : { files: details.get(commit.hash) ?? [] }),
  })).join('');
  for (const entry of container.querySelectorAll<HTMLElement>('.commit-entry')) {
    const hash = entry.dataset.hash;
    if (hash === undefined) {
      continue;
    }
    entry.querySelector<HTMLButtonElement>('.commit-row')?.addEventListener(
      'click',
      () => {
        callbacks.toggleCommit(hash, !expandedHashes.has(hash));
      },
    );
    for (const file of entry.querySelectorAll<HTMLButtonElement>('.commit-file')) {
      const path = file.dataset.path;
      if (path !== undefined) {
        file.addEventListener('click', () => {
          callbacks.openCommitDiff(hash, path);
        });
      }
    }
  }
}
