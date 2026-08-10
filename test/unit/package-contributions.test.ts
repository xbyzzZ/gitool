import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ManifestCommand {
  readonly command: string;
  readonly title: string;
  readonly icon?: string;
  readonly enablement?: string;
}

interface ManifestMenuItem {
  readonly command: string;
  readonly when?: string;
  readonly group?: string;
}

interface Manifest {
  readonly icon?: string;
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
const vscodeIgnore = readFileSync(resolve('.vscodeignore'), 'utf8')
  .split(/\r?\n/u);

function titleCommands(viewId: string): readonly string[] {
  return (manifest.contributes.menus?.['view/title'] ?? [])
    .filter((item) => item.when?.includes(`view == ${viewId}`) === true)
    .map((item) => item.command);
}

describe('扩展贡献点', () => {
  it('声明 Marketplace 使用的 PNG Logo', () => {
    expect(manifest.icon).toBe('media/logo.png');
  });

  it('贡献提交信息、当前变更、提交历史和原生提交文件四个独立视图', () => {
    expect(manifest.contributes.views.gitool).toEqual([
      { type: 'webview', id: 'gitool.commitView', name: '提交信息' },
      { id: 'gitool.changesView', name: '当前变更' },
      { type: 'webview', id: 'gitool.historyView', name: '提交历史' },
      { id: 'gitool.historyFilesView', name: '提交文件' },
    ]);
  });

  it('声明打开历史文件改动命令', () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: 'gitool.openHistoryChange',
      title: 'Gitool：打开历史文件改动',
    });
  });

  it('历史区推送命令由仓库可推送状态控制', () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: 'gitool.pushAll',
      title: 'Gitool：推送全部本地提交',
      icon: '$(cloud-upload)',
      enablement: 'gitool.canPushAll',
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

  it('打包时保留历史 Webview 并排除旧合并 Webview', () => {
    expect(vscodeIgnore).toContain('media/main.js');
    expect(vscodeIgnore).not.toContain('media/history.js');
  });
});
