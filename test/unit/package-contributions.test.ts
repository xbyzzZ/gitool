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

  it('0.3 只贡献统一提交工作台', () => {
    expect(manifest.contributes.views.gitool).toEqual([
      { type: 'webview', id: 'gitool.commitView', name: '提交' },
    ]);
  });

  it('保留提交工作台需要的推送命令', () => {
    expect(manifest.contributes.commands).toContainEqual({
      command: 'gitool.pushAll',
      title: 'Gitool：推送全部本地提交',
      icon: '$(cloud-upload)',
    });
  });

  it('全部操作由工作台内部工具栏承载', () => {
    expect(manifest.contributes.menus).toBeUndefined();
    expect(titleCommands('gitool.commitView')).toEqual([]);
  });

  it('打包时只保留统一工作台脚本', () => {
    expect(vscodeIgnore).toContain('media/main.js');
    expect(vscodeIgnore).toContain('media/history.js');
  });
});
