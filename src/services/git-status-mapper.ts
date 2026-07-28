import { relative, resolve, sep } from 'node:path';
import type * as vscode from 'vscode';
import {
  mergeChanges,
  type ChangeKind,
  type ChangeLayer,
  type FileChange,
  type RawChange,
} from '../domain/change-model.js';
import type {
  BuiltinChange,
  BuiltinRepository,
} from '../git/builtin-git-api.js';

const STATUS_KIND = new Map<number, ChangeKind>([
  [0, 'modified'],
  [1, 'added'],
  [2, 'deleted'],
  [3, 'renamed'],
  [4, 'added'],
  [5, 'modified'],
  [6, 'deleted'],
  [7, 'untracked'],
  [9, 'added'],
  [10, 'renamed'],
  [11, 'type-changed'],
  [12, 'conflicted'],
  [13, 'conflicted'],
  [14, 'conflicted'],
  [15, 'conflicted'],
  [16, 'conflicted'],
  [17, 'conflicted'],
  [18, 'conflicted'],
]);

function relativeGitPath(repositoryRoot: string, uri: vscode.Uri): string {
  const path = relative(repositoryRoot, resolve(uri.fsPath));
  if (
    path.length === 0
    || path === '..'
    || path.startsWith(`..${sep}`)
  ) {
    throw new RangeError('Git 变更路径不在仓库内');
  }
  return path;
}

function toRawChange(
  repositoryRoot: string,
  change: BuiltinChange,
  layer: ChangeLayer,
  forceConflict = false,
): RawChange | undefined {
  if (change.status === 8) {
    return undefined;
  }
  const kind = forceConflict ? 'conflicted' : STATUS_KIND.get(change.status);
  if (kind === undefined) {
    throw new RangeError(`未知的 Git 状态：${String(change.status)}`);
  }
  const originalPath = kind !== 'renamed' || change.originalUri === undefined
    ? undefined
    : relativeGitPath(repositoryRoot, change.originalUri);
  return {
    path: relativeGitPath(repositoryRoot, change.uri),
    ...(originalPath === undefined ? {} : { originalPath }),
    kind,
    layer: kind === 'untracked' ? 'untracked' : layer,
  };
}

function mapChanges(
  repositoryRoot: string,
  changes: readonly BuiltinChange[],
  layer: ChangeLayer,
  forceConflict = false,
): RawChange[] {
  return changes.flatMap((change) => {
    const mapped = toRawChange(
      repositoryRoot,
      change,
      layer,
      forceConflict,
    );
    return mapped === undefined ? [] : [mapped];
  });
}

export function mapRepositoryChanges(
  repositoryRoot: string,
  state: BuiltinRepository['state'],
): readonly FileChange[] {
  const indexChanges = mapChanges(
    repositoryRoot,
    state.indexChanges,
    'index',
  );
  const workingChanges = [
    ...mapChanges(
      repositoryRoot,
      state.workingTreeChanges,
      'working',
    ),
    ...mapChanges(
      repositoryRoot,
      state.mergeChanges,
      'working',
      true,
    ),
  ];
  const untrackedChanges = mapChanges(
    repositoryRoot,
    state.untrackedChanges,
    'untracked',
  );
  return mergeChanges(indexChanges, workingChanges, untrackedChanges);
}
