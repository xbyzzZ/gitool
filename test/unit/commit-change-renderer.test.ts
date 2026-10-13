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
  it('按原型渲染分组、文件行、三态勾选和当前主题图标', () => {
    const changes = [
      change('src/client.ts'),
      change('src/server.ts'),
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
      ['gitool-file-icon-typescript', null, null],
    );

    expect(markup).toContain('class="group" data-group="tracked"');
    expect(markup).toContain('class="group" data-group="untracked"');
    expect(markup).toContain('<span class="group-name">变更</span>');
    expect(markup).toContain('<span class="group-name">未进行版本管理的文件</span>');
    expect(markup).toContain('aria-label="选择变更"');
    expect(markup).toContain('class="cbx" data-state="mixed"');
    expect(markup).toContain('gitool-file-icon-typescript');
    expect(markup).toContain(
      'class="file-row selected" role="checkbox" aria-checked="true"',
    );
    expect(markup).toContain('<span class="st" data-s="M">M</span>');
    expect(markup).toContain('<span class="st" data-s="?">?</span>');
    expect(markup).toContain('<span class="fname">client.ts</span>');
    expect(markup).toContain('<span class="fdir">src</span>');
    expect(markup).toContain('class="diff-link"');
    expect(markup).toContain('打开 diff');
  });

  it('整组全选时组勾选为 checked 并带主题图标兜底', () => {
    const markup = renderChangeListMarkup(
      [change('a.ts'), change('b.ts')],
      new Set(['a.ts', 'b.ts']),
      new Set(),
    );

    expect(markup).toContain(
      'class="group-check" role="checkbox" aria-checked="true"',
    );
    expect(markup).toContain('class="cbx" data-state="checked"');
    expect(markup).toContain('<svg class="ft"');
  });

  it('折叠分组通过 collapsed 类与 aria-expanded 表达且保留文件行', () => {
    const markup = renderChangeListMarkup(
      [change('draft.txt', {
        kind: 'untracked',
        untracked: true,
        unstaged: false,
      })],
      new Set(),
      new Set(['untracked']),
    );

    expect(markup).toContain('class="group collapsed" data-group="untracked"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="展开未进行版本管理的文件"');
    expect(markup).toContain('data-file-id="draft.txt"');
  });

  it('冲突分组只展示不可选择且动态路径严格转义', () => {
    const markup = renderChangeListMarkup(
      [change('src/<unsafe>.ts', {
        kind: 'conflicted',
        conflicted: true,
      })],
      new Set(),
      new Set(),
    );

    expect(markup).toContain('data-group="conflicted"');
    expect(markup).toContain('<span class="group-warn">需先解决冲突</span>');
    expect(markup).not.toContain('class="group-check"');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('<span class="st" data-s="!">!</span>');
    expect(markup).not.toContain('role="checkbox" aria-checked');
    expect(markup).not.toContain('src/<unsafe>.ts');
    expect(markup).toContain('src/&lt;unsafe&gt;.ts');
  });

  it('没有变更时不输出分组，由容器空态接管', () => {
    expect(renderChangeListMarkup([], new Set(), new Set())).toBe('');
  });

  it('渲染时清理旧分组、切换空态并绑定全部交互', () => {
    const calls: string[] = [];
    const removed: string[] = [];
    const staleGroup = {
      dataset: {},
      remove: () => { removed.push('stale'); },
    };
    const empties: boolean[] = [];
    const headerListeners = new Map<string, (event: unknown) => void>();
    const checkListeners = new Map<string, (event: unknown) => void>();
    const rowListeners = new Map<string, (event: unknown) => void>();
    const linkListeners = new Map<string, (event: unknown) => void>();
    const header = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        headerListeners.set(type, listener);
      },
    };
    const groupCheck = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        checkListeners.set(type, listener);
      },
    };
    const diffLink = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        linkListeners.set(type, listener);
      },
    };
    const section = {
      dataset: { group: 'tracked' },
      querySelector: (selector: string) => selector === '.group-header'
        ? header
        : selector === '.group-check'
          ? groupCheck
          : null,
    };
    const row = {
      dataset: { fileId: 'src/client.ts' },
      getAttribute: (name: string) => name === 'role' ? 'checkbox' : null,
      querySelector: (selector: string) => selector === '.diff-link'
        ? diffLink
        : null,
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        rowListeners.set(type, listener);
      },
    };
    const sections: unknown[] = [staleGroup];
    const rows: unknown[] = [];
    let inserted = '';
    const container = {
      classList: {
        toggle: (name: string, on: boolean) => {
          if (name === 'is-empty') {
            empties.push(on);
          }
        },
      },
      querySelectorAll: (selector: string) => selector === '.group'
        ? sections
        : selector === '.file-row'
          ? rows
          : [],
      insertAdjacentHTML: (_position: string, markup: string) => {
        inserted = markup;
        sections.push(section);
        rows.push(row);
      },
    };

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

    expect(removed).toEqual(['stale']);
    expect(empties).toEqual([false]);
    expect(inserted).toContain('data-group="tracked"');

    headerListeners.get('click')?.({});
    let stopped = false;
    checkListeners.get('click')?.({
      stopPropagation: () => { stopped = true; },
    });
    rowListeners.get('click')?.({ target: null });
    let prevented = false;
    let linkStopped = false;
    linkListeners.get('click')?.({
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { linkStopped = true; },
    });
    expect(calls).toEqual([
      'toggle:tracked',
      'group:tracked:true',
      'file:src/client.ts:true',
      'open:src/client.ts',
    ]);
    expect(stopped).toBe(true);
    expect(prevented).toBe(true);
    expect(linkStopped).toBe(true);

    let keyPrevented = false;
    rowListeners.get('keydown')?.({
      key: ' ',
      preventDefault: () => { keyPrevented = true; },
    });
    expect(keyPrevented).toBe(true);
    expect(calls.at(-1)).toBe('file:src/client.ts:true');
  });

  it('空列表渲染只切换空态类不插入分组', () => {
    const empties: boolean[] = [];
    let inserted = 0;
    const container = {
      classList: {
        toggle: (name: string, on: boolean) => {
          if (name === 'is-empty') {
            empties.push(on);
          }
        },
      },
      querySelectorAll: () => [],
      insertAdjacentHTML: () => {
        inserted += 1;
      },
    };

    renderChangeList(
      container as unknown as HTMLElement,
      [],
      new Set(),
      new Set(),
      [],
      {
        toggleSection: () => undefined,
        setGroup: () => undefined,
        toggleFile: () => undefined,
        openDiff: () => undefined,
      },
    );

    expect(empties).toEqual([true]);
    expect(inserted).toBe(0);
  });
});
