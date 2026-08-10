import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class ThemeIcon {
    static readonly File = new ThemeIcon('file');
    constructor(readonly id: string) {}
  }
  class TreeItem {
    description: string | boolean | undefined;
    tooltip: string | vscode.MarkdownString | undefined;
    iconPath: vscode.ThemeIcon | undefined;
    resourceUri: vscode.Uri | undefined;
    command: vscode.Command | undefined;
    contextValue: string | undefined;
    constructor(
      readonly label: string,
      readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {}
  }
  class EventEmitter<T> {
    readonly event: vscode.Event<T> = vi.fn(() => ({ dispose: vi.fn() }));
    fire = vi.fn();
    dispose = vi.fn();
  }
  return { EventEmitter, ThemeIcon, TreeItem };
});

vi.mock('vscode', () => ({
  EventEmitter: mocks.EventEmitter,
  ThemeIcon: mocks.ThemeIcon,
  TreeItem: mocks.TreeItem,
  TreeItemCollapsibleState: { None: 0 },
  Uri: {
    joinPath: (base: vscode.Uri, path: string) => ({
      fsPath: `${base.fsPath}/${path}`,
    }),
  },
}));

import { HistoryFilesTreeProvider } from '../../src/views/history-files-tree-provider.js';

describe('原生提交文件视图', () => {
  it('使用真实资源 URI 和当前文件图标主题，并可打开历史 Diff', () => {
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({ currentRepositoryId: '/repo', version: 4 })),
      getRepository: vi.fn(() => ({ rootUri: { fsPath: '/repo' } })),
    };
    const provider = new HistoryFilesTreeProvider(service as never);
    provider.selectCommit('/repo', 4, {
      hash: 'a'.repeat(40),
      parentHash: 'b'.repeat(40),
      files: [{ status: 'M', path: 'src/app.ts' }],
    });

    const [node] = provider.getChildren();
    if (node === undefined) {
      throw new Error('预期生成历史文件节点');
    }
    const item = provider.getTreeItem(node);
    expect(item.label).toBe('app.ts');
    expect(item.resourceUri?.fsPath).toBe('/repo/src/app.ts');
    expect(item.iconPath).toBe(mocks.ThemeIcon.File);
    expect(item.command).toMatchObject({
      command: 'gitool.openHistoryChange',
      arguments: [node],
    });
  });

  it('仓库版本变化时清空过期文件', () => {
    let model = { currentRepositoryId: '/repo', version: 4 };
    let onChange: (() => void) | undefined;
    const service = {
      onDidChange: vi.fn((listener: () => void) => {
        onChange = listener;
        return { dispose: vi.fn() };
      }),
      getViewModel: vi.fn(() => model),
      getRepository: vi.fn(),
    };
    const provider = new HistoryFilesTreeProvider(service);
    provider.selectCommit('/repo', 4, {
      hash: 'a'.repeat(40),
      files: [{ status: 'A', path: 'new.ts' }],
    });
    model = { currentRepositoryId: '/repo', version: 5 };
    onChange?.();
    expect(provider.getChildren()).toEqual([]);
  });

  it('开始选择新提交时立即清空旧文件', () => {
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({ currentRepositoryId: '/repo', version: 4 })),
      getRepository: vi.fn(),
    };
    const provider = new HistoryFilesTreeProvider(service);
    provider.selectCommit('/repo', 4, {
      hash: 'a'.repeat(40),
      files: [{ status: 'M', path: 'old.ts' }],
    });
    provider.clear();
    expect(provider.getChildren()).toEqual([]);
  });
});
