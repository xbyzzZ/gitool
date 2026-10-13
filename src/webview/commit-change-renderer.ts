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

const SVG_CHEVRON = '<svg class="chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
const SVG_TICK = '<svg class="tick" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.6l3.2 3.2L13 4.6"/></svg>';
const SVG_DASH = '<svg class="dash" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
const SVG_ARROW = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12.5 8l-4 3.5"/></svg>';
const SVG_FILE_FALLBACK = '<svg class="ft" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 2.6h4.8l3 3v7.8H4.2z"/><path d="M9 2.6v3h3"/></svg>';

type CheckboxState = 'unchecked' | 'checked' | 'mixed';

function cbxMarkup(state: CheckboxState): string {
  return `<span class="cbx" data-state="${state}">${SVG_TICK}${SVG_DASH}</span>`;
}

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
    ? SVG_FILE_FALLBACK
    : `<span class="ft ${escapeHtml(iconClass)}" aria-hidden="true"></span>`;
  const directory = path.directory.length === 0
    ? ''
    : `<span class="fdir">${escapeHtml(path.directory)}</span>`;
  const title = file.originalPath === undefined
    ? file.path
    : `${file.originalPath} → ${file.path}`;
  const status = statusLabels[file.kind];
  const diffLink = `<a class="diff-link" href="#" title="打开 ${escapeHtml(title)} 的变更" aria-label="打开 ${escapeHtml(file.path)} 的变更">${SVG_ARROW}打开 diff</a>`;
  const content = cbxMarkup(selected ? 'checked' : 'unchecked')
    + `<span class="st" data-s="${status}">${status}</span>`
    + icon
    + `<span class="fname">${escapeHtml(path.name)}</span>`
    + directory
    + diffLink;
  if (file.conflicted) {
    return `<div class="file-row" data-file-id="${escapeHtml(file.id)}" aria-disabled="true" title="${escapeHtml(title)}">`
      + content
      + '</div>';
  }
  return `<div class="file-row${selected ? ' selected' : ''}" role="checkbox" aria-checked="${String(selected)}" tabindex="0" data-file-id="${escapeHtml(file.id)}" title="${escapeHtml(title)}">`
    + content
    + '</div>';
}

function groupCheckboxState(
  files: readonly FileChange[],
  selectedIds: ReadonlySet<string>,
): CheckboxState {
  const selectedCount = files.filter((file) => selectedIds.has(file.id)).length;
  if (selectedCount === 0) {
    return 'unchecked';
  }
  return selectedCount === files.length ? 'checked' : 'mixed';
}

function sectionMarkup(
  section: ChangeSection,
  collapsed: boolean,
  selectedIds: ReadonlySet<string>,
  iconClasses: ReadonlyMap<string, string | null>,
): string {
  const files = section.directories.flatMap((directory) => directory.files);
  const selectable = section.kind !== 'conflicted';
  const groupState = groupCheckboxState(files, selectedIds);
  const groupCheck = selectable
    ? `<span class="group-check" role="checkbox" aria-checked="${groupState === 'mixed' ? 'mixed' : String(groupState === 'checked')}" tabindex="0" aria-label="选择${sectionLabels[section.kind]}">${cbxMarkup(groupState)}</span>`
    : '';
  const warning = section.kind === 'conflicted'
    ? '<span class="group-warn">需先解决冲突</span>'
    : '';
  const rows = files.map((file) => fileMarkup(
    file,
    selectedIds.has(file.id),
    iconClasses.get(file.id),
  )).join('');
  return `<section class="group${collapsed ? ' collapsed' : ''}" data-group="${section.kind}">`
    + `<div class="group-header" role="button" tabindex="0" aria-expanded="${String(!collapsed)}" aria-label="${collapsed ? '展开' : '收起'}${sectionLabels[section.kind]}">`
    + SVG_CHEVRON
    + groupCheck
    + `<span class="group-name">${sectionLabels[section.kind]}</span>`
    + `<span class="group-count">${String(section.fileCount)} 个文件</span>`
    + warning
    + '</div>'
    + `<div class="group-body"><div>${rows}</div></div>`
    + '</section>';
}

export function renderChangeListMarkup(
  changes: readonly FileChange[],
  selectedIds: ReadonlySet<string>,
  collapsedSections: ReadonlySet<ChangeSectionKind>,
  fileIconClasses: readonly (string | null)[] = [],
): string {
  if (changes.length === 0) {
    return '';
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

function activationKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Enter';
}

export function renderChangeList(
  container: HTMLElement,
  changes: readonly FileChange[],
  selectedIds: ReadonlySet<string>,
  collapsedSections: ReadonlySet<ChangeSectionKind>,
  fileIconClasses: readonly (string | null)[],
  callbacks: ChangeListCallbacks,
): void {
  for (const group of container.querySelectorAll('.group')) {
    group.remove();
  }
  container.classList.toggle('is-empty', changes.length === 0);
  const markup = renderChangeListMarkup(
    changes,
    selectedIds,
    collapsedSections,
    fileIconClasses,
  );
  if (markup.length > 0) {
    container.insertAdjacentHTML('beforeend', markup);
  }
  for (const section of container.querySelectorAll<HTMLElement>('.group')) {
    const kind = section.dataset.group as ChangeSectionKind | undefined;
    if (kind === undefined) {
      continue;
    }
    const header = section.querySelector<HTMLElement>('.group-header');
    header?.addEventListener('click', () => {
      callbacks.toggleSection(kind);
    });
    header?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.target === header && activationKey(event)) {
        event.preventDefault();
        callbacks.toggleSection(kind);
      }
    });
    if (kind === 'tracked' || kind === 'untracked') {
      const files = changes.filter((change) => kind === 'tracked'
        ? !change.untracked && !change.conflicted
        : change.untracked);
      const allSelected = files.length > 0
        && files.every((file) => selectedIds.has(file.id));
      const check = section.querySelector<HTMLElement>('.group-check');
      const toggleGroup = (event: Event): void => {
        event.stopPropagation();
        callbacks.setGroup(kind, !allSelected);
      };
      check?.addEventListener('click', toggleGroup);
      check?.addEventListener('keydown', (event: KeyboardEvent) => {
        if (activationKey(event)) {
          event.preventDefault();
          toggleGroup(event);
        }
      });
    }
  }
  for (const row of container.querySelectorAll<HTMLElement>('.file-row')) {
    const fileId = row.dataset.fileId;
    if (fileId === undefined) {
      continue;
    }
    row.querySelector<HTMLElement>('.diff-link')
      ?.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        callbacks.openDiff(fileId);
      });
    if (row.getAttribute('role') !== 'checkbox') {
      continue;
    }
    row.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target !== null && typeof target.closest === 'function'
        && target.closest('.diff-link') !== null) {
        return;
      }
      callbacks.toggleFile(fileId, !selectedIds.has(fileId));
    });
    row.addEventListener('keydown', (event: KeyboardEvent) => {
      if (activationKey(event)) {
        event.preventDefault();
        callbacks.toggleFile(fileId, !selectedIds.has(fileId));
      }
    });
  }
}
