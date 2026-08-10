import type { FileChange } from '../domain/change-model.js';
import {
  groupChanges,
  type ChangeSection,
  type ChangeSectionKind,
} from '../domain/change-groups.js';

export interface ChangeListCallbacks {
  readonly toggleSection: (section: ChangeSectionKind) => void;
  readonly setGroup: (section: 'tracked' | 'untracked', selected: boolean) => void;
  readonly toggleFile: (fileId: string, selected: boolean) => void;
  readonly openDiff: (fileId: string) => void;
}

const sectionLabels: Readonly<Record<ChangeSectionKind, string>> = {
  tracked: '变更',
  untracked: '未进行版本管理的文件',
  conflicted: '冲突文件',
};

const statusLabels: Readonly<Record<FileChange['kind'], string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  'type-changed': 'T',
  conflicted: '!',
  untracked: '?',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function splitPath(path: string): { readonly name: string; readonly directory: string } {
  const segments = path.split('/');
  return {
    name: segments.pop() ?? path,
    directory: segments.join('/'),
  };
}

function fileMarkup(
  file: FileChange,
  selected: boolean,
  iconClass: string | null | undefined,
): string {
  const path = splitPath(file.path);
  const icon = iconClass === null || iconClass === undefined
    ? '<span class="codicon codicon-file change-file-icon" aria-hidden="true"></span>'
    : `<span class="change-file-icon ${escapeHtml(iconClass)}" aria-hidden="true"></span>`;
  const disabled = file.conflicted ? ' disabled' : '';
  const checked = selected ? ' checked' : '';
  const directory = path.directory.length === 0
    ? ''
    : `<span class="change-file-directory">${escapeHtml(path.directory)}</span>`;
  const title = file.originalPath === undefined
    ? file.path
    : `${file.originalPath} → ${file.path}`;
  return `<div class="change-file-row" data-file-id="${escapeHtml(file.id)}">`
    + `<input class="change-file-check" type="checkbox" aria-label="选择 ${escapeHtml(file.path)}"${checked}${disabled}>`
    + `<button class="change-file-open" type="button" title="${escapeHtml(title)}" aria-label="打开 ${escapeHtml(file.path)} 的变更">`
    + icon
    + `<span class="change-file-name">${escapeHtml(path.name)}</span>`
    + directory
    + `<span class="change-file-status status-${escapeHtml(file.kind)}">${statusLabels[file.kind]}</span>`
    + '</button>'
    + '</div>';
}

function sectionMarkup(
  section: ChangeSection,
  collapsed: boolean,
  selectedIds: ReadonlySet<string>,
  iconClasses: ReadonlyMap<string, string | null>,
): string {
  const files = section.directories.flatMap((directory) => directory.files);
  const selectedCount = files.filter((file) => selectedIds.has(file.id)).length;
  const selectable = section.kind !== 'conflicted';
  const checked = selectable && selectedCount === files.length && files.length > 0
    ? ' checked'
    : '';
  const groupCheckbox = selectable
    ? `<input class="change-group-check" type="checkbox" data-group="${section.kind}" aria-label="选择${sectionLabels[section.kind]}"${checked}>`
    : '<span class="change-group-check-placeholder" aria-hidden="true"></span>';
  const body = collapsed
    ? ''
    : `<div class="change-section-files">${files.map((file) => fileMarkup(
      file,
      selectedIds.has(file.id),
      iconClasses.get(file.id),
    )).join('')}</div>`;
  return `<section class="change-section" data-section="${section.kind}">`
    + '<div class="change-section-heading">'
    + `<button class="change-section-toggle" type="button" aria-expanded="${String(!collapsed)}" aria-label="${collapsed ? '展开' : '收起'}${sectionLabels[section.kind]}">`
    + `<span class="codicon codicon-chevron-${collapsed ? 'right' : 'down'}" aria-hidden="true"></span>`
    + '</button>'
    + groupCheckbox
    + `<span class="change-section-label">${sectionLabels[section.kind]}</span>`
    + `<span class="change-section-count">${String(section.fileCount)} 个文件</span>`
    + '</div>'
    + body
    + '</section>';
}

export function renderChangeListMarkup(
  changes: readonly FileChange[],
  selectedIds: ReadonlySet<string>,
  collapsedSections: ReadonlySet<ChangeSectionKind>,
  fileIconClasses: readonly (string | null)[] = [],
): string {
  if (changes.length === 0) {
    return '<div class="changes-empty"><span class="codicon codicon-check-all" aria-hidden="true"></span><p>没有待提交的变更</p></div>';
  }
  const iconClasses = new Map(changes.map((change, index) => [
    change.id,
    fileIconClasses[index] ?? null,
  ]));
  return groupChanges(changes).map((section) => sectionMarkup(
    section,
    collapsedSections.has(section.kind),
    selectedIds,
    iconClasses,
  )).join('');
}

export function renderChangeList(
  container: HTMLElement,
  changes: readonly FileChange[],
  selectedIds: ReadonlySet<string>,
  collapsedSections: ReadonlySet<ChangeSectionKind>,
  fileIconClasses: readonly (string | null)[],
  callbacks: ChangeListCallbacks,
): void {
  container.innerHTML = renderChangeListMarkup(
    changes,
    selectedIds,
    collapsedSections,
    fileIconClasses,
  );
  for (const section of container.querySelectorAll<HTMLElement>('.change-section')) {
    const kind = section.dataset.section as ChangeSectionKind | undefined;
    if (kind === undefined) {
      continue;
    }
    section.querySelector<HTMLButtonElement>('.change-section-toggle')
      ?.addEventListener('click', () => {
        callbacks.toggleSection(kind);
      });
    const group = section.querySelector<HTMLInputElement>('.change-group-check');
    if (group !== null && (kind === 'tracked' || kind === 'untracked')) {
      const files = changes.filter((change) => kind === 'tracked'
        ? !change.untracked && !change.conflicted
        : change.untracked);
      const selectedCount = files.filter((file) => selectedIds.has(file.id)).length;
      group.indeterminate = selectedCount > 0 && selectedCount < files.length;
      group.addEventListener('change', () => {
        callbacks.setGroup(kind, group.checked);
      });
    }
  }
  for (const row of container.querySelectorAll<HTMLElement>('.change-file-row')) {
    const fileId = row.dataset.fileId;
    if (fileId === undefined) {
      continue;
    }
    row.querySelector<HTMLInputElement>('.change-file-check')
      ?.addEventListener('change', (event) => {
        callbacks.toggleFile(fileId, (event.currentTarget as HTMLInputElement).checked);
      });
    row.querySelector<HTMLButtonElement>('.change-file-open')
      ?.addEventListener('click', () => {
        callbacks.openDiff(fileId);
      });
  }
}
