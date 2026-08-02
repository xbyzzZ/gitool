import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/domain/change-model.js';
import { groupChanges } from '../../src/domain/change-groups.js';

function change(
  path: string,
  options: Partial<Pick<FileChange, 'untracked' | 'conflicted'>> = {},
): FileChange {
  return {
    id: path,
    path,
    kind: options.conflicted === true
      ? 'conflicted'
      : options.untracked === true
        ? 'untracked'
        : 'modified',
    staged: false,
    unstaged: options.untracked !== true,
    untracked: options.untracked === true,
    conflicted: options.conflicted === true,
    commitPaths: [path],
  };
}

describe('变更分区', () => {
  it('按待提交、未跟踪和冲突的固定顺序分区', () => {
    const result = groupChanges([
      change('conflict.ts', { conflicted: true }),
      change('new.ts', { untracked: true }),
      change('tracked.ts'),
    ]);

    expect(result.map((section) => section.kind)).toEqual([
      'tracked',
      'untracked',
      'conflicted',
    ]);
    expect(result.map((section) => section.fileCount)).toEqual([1, 1, 1]);
  });

  it('冲突文件只进入冲突分区', () => {
    const conflictedUntracked = change('both.ts', {
      conflicted: true,
      untracked: true,
    });

    const result = groupChanges([conflictedUntracked]);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('conflicted');
    expect(result[0]?.directories[0]?.files).toEqual([conflictedUntracked]);
  });

  it('按目录弱分组并稳定排序根目录和嵌套目录', () => {
    const result = groupChanges([
      change('src/services/z.ts'),
      change('README.md'),
      change('src/services/a.ts'),
      change('src/domain/model.ts'),
    ]);

    expect(result[0]?.directories.map((directory) => ({
      path: directory.path,
      files: directory.files.map((file) => file.path),
    }))).toEqual([
      { path: '.', files: ['README.md'] },
      { path: 'src/domain', files: ['src/domain/model.ts'] },
      {
        path: 'src/services',
        files: ['src/services/a.ts', 'src/services/z.ts'],
      },
    ]);
  });

  it('没有文件时不产生空分区', () => {
    expect(groupChanges([])).toEqual([]);
  });
});
