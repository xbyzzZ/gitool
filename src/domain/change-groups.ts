import type { FileChange } from './change-model.js';

export type ChangeSectionKind = 'tracked' | 'untracked' | 'conflicted';

export interface ChangeDirectoryGroup {
  readonly path: string;
  readonly files: readonly FileChange[];
}

export interface ChangeSection {
  readonly kind: ChangeSectionKind;
  readonly fileCount: number;
  readonly directories: readonly ChangeDirectoryGroup[];
}

const sectionOrder: readonly ChangeSectionKind[] = [
  'tracked',
  'untracked',
  'conflicted',
];

function sectionKind(change: FileChange): ChangeSectionKind {
  if (change.conflicted) {
    return 'conflicted';
  }
  return change.untracked ? 'untracked' : 'tracked';
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function directoryPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator <= 0 ? '.' : path.slice(0, separator);
}

export function groupChanges(
  changes: readonly FileChange[],
): ChangeSection[] {
  const sections = new Map<
    ChangeSectionKind,
    Map<string, FileChange[]>
  >();

  for (const change of changes) {
    const kind = sectionKind(change);
    const directory = directoryPath(change.path);
    const directories = sections.get(kind) ?? new Map<string, FileChange[]>();
    const files = directories.get(directory) ?? [];
    files.push(change);
    directories.set(directory, files);
    sections.set(kind, directories);
  }

  return sectionOrder.flatMap((kind) => {
    const directories = sections.get(kind);
    if (directories === undefined) {
      return [];
    }
    const groups = [...directories.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, files]) => ({
        path,
        files: [...files].sort((left, right) => compareText(
          left.path,
          right.path,
        )),
      }));
    return [{
      kind,
      fileCount: groups.reduce((count, group) => count + group.files.length, 0),
      directories: groups,
    }];
  });
}
