import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ManifestCommand {
  readonly command: string;
  readonly title: string;
  readonly icon?: string;
}

interface ManifestMenuItem {
  readonly command: string;
  readonly when?: string;
  readonly group?: string;
}

interface Manifest {
  readonly activationEvents: readonly string[];
  readonly contributes: {
    readonly views: Readonly<Record<string, readonly Record<string, unknown>[]>>;
    readonly commands: readonly ManifestCommand[];
    readonly menus?: Readonly<Record<string, readonly ManifestMenuItem[]>>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8'),
) as Manifest;

function titleCommands(viewId: string): readonly string[] {
  return (manifest.contributes.menus?.['view/title'] ?? [])
    .filter((item) => item.when?.includes(`view == ${viewId}`) === true)
    .map((item) => item.command);
}

describe('扩展贡献点', () => {
  it('贡献提交信息、当前变更和提交历史三个独立视图', () => {
    expect(manifest.contributes.views.gitool).toEqual([
      { type: 'webview', id: 'gitool.commitView', name: '提交信息' },
      { id: 'gitool.changesView', name: '当前变更' },
      { id: 'gitool.historyView', name: '提交历史' },
    ]);
  });

  it('声明打开历史文件改动命令', () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: 'gitool.openHistoryChange',
      title: 'Gitool：打开历史文件改动',
    });
  });

  it('标题栏命令位于对应视图', () => {
    expect(titleCommands('gitool.commitView')).toEqual([
      'gitool.editRemote',
    ]);
    expect(titleCommands('gitool.changesView')).toEqual([
      'gitool.refreshChanges',
    ]);
    expect(titleCommands('gitool.historyView')).toEqual([
      'gitool.pull',
      'gitool.pushAll',
      'gitool.refreshHistory',
    ]);
  });

  it('舍弃命令只在未跟踪文件节点显示', () => {
    expect(manifest.contributes.menus?.['view/item/context'] ?? []).toContainEqual({
      command: 'gitool.trashUntracked',
      when: 'view == gitool.changesView && viewItem == gitool.untrackedFile',
      group: 'inline',
    });
  });
});
