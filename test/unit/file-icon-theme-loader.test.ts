import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  themeId: 'test-icons',
  files: new Map<string, string>(),
}));

function uri(path: string): vscode.Uri {
  return {
    path,
    with: (change: { readonly path?: string }) => uri(change.path ?? path),
    toString: () => `file://${path}`,
  } as vscode.Uri;
}

function joinPath(base: vscode.Uri, ...parts: readonly string[]): vscode.Uri {
  const segments = `${base.path}/${parts.join('/')}`.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  return uri(`/${normalized.join('/')}`);
}

vi.mock('vscode', () => ({
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  window: { activeColorTheme: { kind: 1 } },
  extensions: {
    all: [{
      extensionUri: uri('/extensions/theme'),
      packageJSON: {
        contributes: {
          iconThemes: [{ id: 'test-icons', path: './icons/theme.json' }],
        },
      },
    }],
  },
  workspace: {
    getConfiguration: () => ({ get: () => state.themeId }),
    fs: {
      readFile: vi.fn((value: vscode.Uri) => {
        const content = state.files.get(value.path);
        if (content === undefined) {
          throw new Error(`缺少测试主题：${value.path}`);
        }
        return Promise.resolve(new TextEncoder().encode(content));
      }),
    },
  },
  Uri: { joinPath },
}));

import { loadCurrentFileIconTheme } from '../../src/webview/file-icon-theme-loader.js';

describe('当前文件图标主题加载', () => {
  it('从当前主题贡献读取 JSONC 并转换字体与图片资源 URI', async () => {
    state.files.set('/extensions/theme/icons/theme.json', `{
      // 主题允许 JSONC 注释
      "fonts": [{ "id": "icons", "src": [{ "path": "./icons.woff", "format": "woff" }] }],
      "iconDefinitions": {
        "ts": { "fontCharacter": "\\uE001", "fontColor": "#519aba" },
        "vue": { "iconPath": "./vue.svg" }
      },
      "fileExtensions": { "ts": "ts", "vue": "ts" },
      "light": { "fileExtensions": { "vue": "vue" } },
    }`);
    const webview = {
      asWebviewUri: (value: vscode.Uri) => ({
        toString: () => `webview:${value.path}`,
      }),
    } as vscode.Webview;

    const loaded = await loadCurrentFileIconTheme(webview);

    expect(loaded.localResourceRoots.map((value) => value.path)).toEqual([
      '/extensions/theme',
    ]);
    expect(loaded.css).toContain('webview:/extensions/theme/icons/icons.woff');
    expect(loaded.css).toContain('webview:/extensions/theme/icons/vue.svg');
    const vueClass = loaded.classForPath('src/App.vue');
    expect(vueClass).toBeDefined();
    expect(loaded.css).toContain(`.${vueClass ?? ''} { background-image: url("webview:/extensions/theme/icons/vue.svg")`);
  });

  it('继承父主题时分别按父子文件位置解析资源并合并映射', async () => {
    state.files.set('/extensions/theme/icons/theme.json', `{
      "extends": "../base/base.json",
      "iconDefinitions": {
        "vue": { "iconPath": "./child/vue.svg" }
      },
      "fileExtensions": { "vue": "vue" }
    }`);
    state.files.set('/extensions/theme/base/base.json', `{
      "iconDefinitions": {
        "ts": { "iconPath": "./parent/typescript.svg" }
      },
      "fileExtensions": { "ts": "ts" }
    }`);
    const webview = {
      asWebviewUri: (value: vscode.Uri) => ({
        toString: () => `webview:${value.path}`,
      }),
    } as vscode.Webview;

    const loaded = await loadCurrentFileIconTheme(webview);
    const tsClass = loaded.classForPath('src/app.ts');
    const vueClass = loaded.classForPath('src/App.vue');

    expect(tsClass).toBeDefined();
    expect(vueClass).toBeDefined();
    expect(loaded.css).toContain(`.${tsClass ?? ''} { background-image: url("webview:/extensions/theme/base/parent/typescript.svg")`);
    expect(loaded.css).toContain(`.${vueClass ?? ''} { background-image: url("webview:/extensions/theme/icons/child/vue.svg")`);
  });
});
