import { isAbsolute } from 'node:path';

export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'type-changed'
  | 'conflicted'
  | 'untracked';

export type ChangeLayer = 'index' | 'working' | 'untracked';

export interface RawChange {
  readonly path: string;
  readonly originalPath?: string;
  readonly kind: ChangeKind;
  readonly layer: ChangeLayer;
}

export interface FileChange {
  readonly id: string;
  readonly path: string;
  readonly originalPath?: string;
  readonly kind: ChangeKind;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
  readonly commitPaths: readonly string[];
}

interface MergedChange {
  path: string;
  originalPath?: string;
  kind: ChangeKind;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

function validatePath(path: string): void {
  if (path.length === 0 || path.includes('\u0000') || isAbsolute(path)) {
    throw new RangeError(`非法 Git 路径：${JSON.stringify(path)}`);
  }
}

function addChanges(
  mergedChanges: Map<string, MergedChange>,
  changes: readonly RawChange[],
): void {
  for (const change of changes) {
    validatePath(change.path);
    if (change.originalPath !== undefined) {
      validatePath(change.originalPath);
    }

    const current = mergedChanges.get(change.path) ?? {
      path: change.path,
      kind: change.kind,
      staged: false,
      unstaged: false,
      untracked: false,
      conflicted: false,
    };

    current.kind = change.kind;
    if (current.originalPath === undefined && change.originalPath !== undefined) {
      current.originalPath = change.originalPath;
    }
    current.staged ||= change.layer === 'index';
    current.unstaged ||= change.layer === 'working';
    current.untracked ||= change.layer === 'untracked';
    current.conflicted ||= change.kind === 'conflicted';
    mergedChanges.set(change.path, current);
  }
}

export function mergeChanges(
  indexChanges: readonly RawChange[],
  workingChanges: readonly RawChange[],
  untrackedChanges: readonly RawChange[],
): FileChange[] {
  const mergedChanges = new Map<string, MergedChange>();
  addChanges(mergedChanges, indexChanges);
  addChanges(mergedChanges, workingChanges);
  addChanges(mergedChanges, untrackedChanges);

  return [...mergedChanges.values()]
    .sort((left, right) => {
      if (left.path < right.path) {
        return -1;
      }
      if (left.path > right.path) {
        return 1;
      }
      return 0;
    })
    .map((change) => {
      const commitPaths = change.originalPath === undefined
        ? [change.path]
        : [...new Set([change.originalPath, change.path])];

      return {
        id: change.path,
        path: change.path,
        ...(change.originalPath === undefined ? {} : { originalPath: change.originalPath }),
        kind: change.kind,
        staged: change.staged,
        unstaged: change.unstaged,
        untracked: change.untracked,
        conflicted: change.conflicted,
        commitPaths,
      };
    });
}
