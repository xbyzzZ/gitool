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

const conflicted = (path: string): FileChange => ({
  ...tracked(path),
  kind: 'conflicted',
  conflicted: true,
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

  it('首次不选择冲突文件', () => {
    const store = new SelectionStore();

    expect([...store.reconcile('repo', [conflicted('a.ts')])]).toEqual([]);
  });

  it('按仓库隔离选择状态', () => {
    const store = new SelectionStore();
    store.reconcile('repo-a', [tracked('a.ts')]);
    store.reconcile('repo-b', [tracked('b.ts')]);
    store.setSelected('repo-a', 'a.ts', false);

    expect([...store.reconcile('repo-a', [tracked('a.ts')])]).toEqual([]);
    expect([...store.reconcile('repo-b', [tracked('b.ts')])]).toEqual(['b.ts']);
  });

  it('文件消失后清除人工选择并在再次出现时按新文件选择', () => {
    const store = new SelectionStore();
    store.reconcile('repo', [tracked('a.ts')]);
    store.setSelected('repo', 'a.ts', false);
    store.reconcile('repo', []);

    expect([...store.reconcile('repo', [tracked('a.ts')])]).toEqual(['a.ts']);
  });

  it('刷新保留人工重新选择的文件', () => {
    const store = new SelectionStore();
    store.reconcile('repo', [tracked('a.ts')]);
    store.setSelected('repo', 'a.ts', false);
    store.setSelected('repo', 'a.ts', true);

    expect([...store.reconcile('repo', [tracked('a.ts')])]).toEqual(['a.ts']);
  });

  it('批量设置同组文件的选择状态', () => {
    const store = new SelectionStore();
    store.reconcile('repo', [tracked('a.ts'), tracked('b.ts')]);
    store.setGroup('repo', ['a.ts', 'b.ts'], false);

    expect([...store.reconcile('repo', [tracked('a.ts'), tracked('b.ts')])]).toEqual([]);

    store.setGroup('repo', ['a.ts', 'b.ts'], true);
    expect([...store.reconcile('repo', [tracked('a.ts'), tracked('b.ts')])])
      .toEqual(['a.ts', 'b.ts']);
  });
});
