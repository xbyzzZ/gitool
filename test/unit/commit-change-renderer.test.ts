import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/domain/change-model.js';
import {
  renderChangeList,
  renderChangeListMarkup,
} from '../../src/webview/commit-change-renderer.js';

function change(
  path: string,
  overrides: Partial<FileChange> = {},
): FileChange {
  return {
    id: path,
    path,
    kind: 'modified',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    commitPaths: [path],
    ...overrides,
  };
}

describe('提交工作台变更列表', () => {
  it('按固定分组渲染文件名、同行目录和当前主题图标', () => {
    const changes = [
      change('src/client.ts'),
      change('notes/new.md', {
        kind: 'untracked',
        untracked: true,
        unstaged: false,
      }),
    ];

    const markup = renderChangeListMarkup(
      changes,
      new Set(['src/client.ts']),
      new Set(),
      ['gitool-file-icon-typescript', null],
    );

    expect(markup).toContain('data-section="tracked"');
    expect(markup).toContain('data-section="untracked"');
    expect(markup).toContain('>变更<');
    expect(markup).toContain('>未进行版本管理的文件<');
    expect(markup).toContain('gitool-file-icon-typescript');
    expect(markup).toContain('<span class="change-file-name">client.ts</span>');
    expect(markup).toContain('<span class="change-file-directory">src</span>');
    expect(markup).toContain('aria-label="选择 src/client.ts" checked');
  });

  it('折叠未跟踪分组时不渲染其文件行', () => {
    const markup = renderChangeListMarkup(
      [change('draft.txt', {
        kind: 'untracked',
        untracked: true,
        unstaged: false,
      })],
      new Set(),
      new Set(['untracked']),
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-file-id="draft.txt"');
  });

  it('冲突文件不可选择且动态路径严格转义', () => {
    const markup = renderChangeListMarkup(
      [change('src/<unsafe>.ts', {
        kind: 'conflicted',
        conflicted: true,
      })],
      new Set(),
      new Set(),
    );

    expect(markup).toContain('data-section="conflicted"');
    expect(markup).toContain('aria-label="选择 src/&lt;unsafe&gt;.ts" disabled');
    expect(markup).not.toContain('src/<unsafe>.ts');
  });

  it('没有变更时显示可读空状态', () => {
    expect(renderChangeListMarkup([], new Set(), new Set())).toContain(
      '没有待提交的变更',
    );
  });

  it('绑定分组展开、整组选择、单文件选择和打开 Diff 事件', () => {
    const listeners = new Map<string, () => void>();
    const toggle = {
      addEventListener: (_type: string, listener: () => void) => {
        listeners.set('toggle', listener);
      },
    };
    const group = {
      checked: true,
      indeterminate: false,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.set('group', listener);
      },
    };
    const fileCheck = {
      checked: false,
      addEventListener: (_type: string, listener: (event: unknown) => void) => {
        listeners.set('file', () => {
          listener({ currentTarget: fileCheck });
        });
      },
    };
    const open = {
      addEventListener: (_type: string, listener: () => void) => {
        listeners.set('open', listener);
      },
    };
    const section = {
      dataset: { section: 'tracked' },
      querySelector: (selector: string) => selector === '.change-section-toggle'
        ? toggle
        : group,
    };
    const row = {
      dataset: { fileId: 'src/client.ts' },
      querySelector: (selector: string) => selector === '.change-file-check'
        ? fileCheck
        : open,
    };
    const container = {
      innerHTML: '',
      querySelectorAll: (selector: string) => selector === '.change-section'
        ? [section]
        : [row],
    };
    const calls: string[] = [];

    renderChangeList(
      container as unknown as HTMLElement,
      [change('src/client.ts')],
      new Set(),
      new Set(),
      [],
      {
        toggleSection: (kind) => { calls.push(`toggle:${kind}`); },
        setGroup: (kind, selected) => { calls.push(`group:${kind}:${String(selected)}`); },
        toggleFile: (fileId, selected) => { calls.push(`file:${fileId}:${String(selected)}`); },
        openDiff: (fileId) => { calls.push(`open:${fileId}`); },
      },
    );

    expect(group.indeterminate).toBe(false);
    listeners.get('toggle')?.();
    listeners.get('group')?.();
    listeners.get('file')?.();
    listeners.get('open')?.();
    expect(calls).toEqual([
      'toggle:tracked',
      'group:tracked:true',
      'file:src/client.ts:false',
      'open:src/client.ts',
    ]);
  });
});
