import { describe, expect, it } from 'vitest';
import { SelectionStore } from '../../src/domain/selection-store.js';
import type { FileChange } from '../../src/domain/change-model.js';

const tracked = (path: string): FileChange => ({
  id: path,
  path,
  kind: 'modified',
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false,
  commitPaths: [path],
});

const untracked = (path: string): FileChange => ({
  ...tracked(path),
  kind: 'untracked',
  untracked: true,
});

describe('SelectionStore', () => {
  it('首次选择已跟踪文件但不选择未跟踪文件', () => {
    const store = new SelectionStore();
    expect([...store.reconcile('repo', [
      tracked('a.ts'),
      untracked('secret.env'),
    ])]).toEqual(['a.ts']);
  });

  it('刷新保留人工取消并让新未跟踪文件保持未选', () => {
    const store = new SelectionStore();
    store.reconcile('repo', [tracked('a.ts')]);
    store.setSelected('repo', 'a.ts', false);

    expect([...store.reconcile('repo', [
      tracked('a.ts'),
      untracked('new.txt'),
    ])]).toEqual([]);
  });
});
