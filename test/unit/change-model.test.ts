import { describe, expect, it } from 'vitest';
import { mergeChanges } from '../../src/domain/change-model.js';

describe('mergeChanges', () => {
  it('把同一路径的暂存和未暂存修改合并为双状态文件', () => {
    const result = mergeChanges(
      [{ path: 'src/a.ts', kind: 'modified', layer: 'index' }],
      [{ path: 'src/a.ts', kind: 'modified', layer: 'working' }],
      [],
    );

    expect(result).toEqual([{
      id: 'src/a.ts',
      path: 'src/a.ts',
      kind: 'modified',
      staged: true,
      unstaged: true,
      untracked: false,
      conflicted: false,
      commitPaths: ['src/a.ts'],
    }]);
  });

  it('重命名文件的提交路径同时包含旧路径和新路径', () => {
    const result = mergeChanges(
      [],
      [{
        path: 'src/new.ts',
        originalPath: 'src/old.ts',
        kind: 'renamed',
        layer: 'working',
      }],
      [],
    );

    expect(result[0]?.commitPaths).toEqual(['src/old.ts', 'src/new.ts']);
  });

  it('按路径稳定排序合并后的文件', () => {
    const result = mergeChanges(
      [{ path: 'src/z.ts', kind: 'modified', layer: 'index' }],
      [{ path: 'src/a.ts', kind: 'modified', layer: 'working' }],
      [],
    );

    expect(result.map((change) => change.path)).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it.each([
    '',
    '/absolute.ts',
    'src/with\u0000nul.ts',
  ])('拒绝非法路径 %j', (path) => {
    expect(() => mergeChanges(
      [{ path, kind: 'modified', layer: 'index' }],
      [],
      [],
    )).toThrow(RangeError);
  });
});
