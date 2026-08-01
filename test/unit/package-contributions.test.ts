import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CommandContribution {
  readonly command: string;
  readonly icon?: string;
}

interface ViewTitleMenuContribution {
  readonly command: string;
  readonly when?: string;
}

interface ViewItemContextMenuContribution {
  readonly command: string;
  readonly when?: string;
}

interface PackageManifest {
  readonly contributes: {
    readonly commands: readonly CommandContribution[];
    readonly menus: {
      readonly 'view/item/context': readonly ViewItemContextMenuContribution[];
      readonly 'view/title': readonly ViewTitleMenuContribution[];
    };
    readonly views: {
      readonly gitool: readonly {
        readonly type?: string;
        readonly id: string;
        readonly name: string;
      }[];
    };
  };
}

const manifest = JSON.parse(readFileSync(
  resolve(process.cwd(), 'package.json'),
  'utf8',
)) as PackageManifest;

function command(id: string): CommandContribution {
  const contribution = manifest.contributes.commands.find(
    (candidate) => candidate.command === id,
  );
  expect(contribution, `缺少命令贡献：${id}`).toBeDefined();
  if (contribution === undefined) {
    throw new Error(`缺少命令贡献：${id}`);
  }
  return contribution;
}

function viewTitleCommands(viewId: string): string[] {
  return manifest.contributes.menus['view/title']
    .filter((contribution) => contribution.when === `view == ${viewId}`)
    .map((contribution) => contribution.command);
}

function viewItemContextCommand(id: string): ViewItemContextMenuContribution {
  const contribution = manifest.contributes.menus['view/item/context'].find(
    (candidate) => candidate.command === id,
  );
  expect(contribution, `缺少视图项菜单贡献：${id}`).toBeDefined();
  if (contribution === undefined) {
    throw new Error(`缺少视图项菜单贡献：${id}`);
  }
  return contribution;
}

describe('扩展清单贡献点', () => {
  it('贡献提交信息、当前变更和提交历史三个独立视图', () => {
    const views = manifest.contributes.views.gitool;
    expect(views).toEqual([
      { type: 'webview', id: 'gitool.commitView', name: '提交信息' },
      { id: 'gitool.changesView', name: '当前变更' },
      { id: 'gitool.historyView', name: '提交历史' },
    ]);
  });

  it('高频操作使用 VS Code 产品图标并放在对应标题栏', () => {
    expect(command('gitool.editRemote').icon).toBe('$(remote)');
    expect(command('gitool.refreshChanges').icon).toBe('$(refresh)');
    expect(command('gitool.trashUntracked').icon).toBe('$(trash)');
    expect(command('gitool.openChange').icon).toBe('$(go-to-file)');
    expect(command('gitool.pull').icon).toBe('$(cloud-download)');
    expect(command('gitool.pushAll').icon).toBe('$(cloud-upload)');
    expect(command('gitool.refreshHistory').icon).toBe('$(refresh)');
    expect(command('gitool.openHistoryDiff').icon).toBe('$(diff)');
    expect(viewTitleCommands('gitool.commitView')).toEqual([
      'gitool.editRemote',
    ]);
    expect(viewTitleCommands('gitool.changesView')).toEqual([
      'gitool.refreshChanges',
    ]);
    expect(viewTitleCommands('gitool.historyView')).toEqual([
      'gitool.pull', 'gitool.pushAll', 'gitool.refreshHistory',
    ]);
    expect(viewItemContextCommand('gitool.trashUntracked').when).toBe(
      'view == gitool.changesView && viewItem == gitool.untrackedFile',
    );
  });
});
