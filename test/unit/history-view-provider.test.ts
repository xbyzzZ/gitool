import type * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('vscode', () => ({
  window: { showErrorMessage: mocks.showErrorMessage },
  Uri: {
    joinPath: vi.fn(),
    from: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
}));

import { HistoryViewProvider } from '../../src/webview/history-view-provider.js';

function extensionUri(path = '/extensions/gitool'): vscode.Uri {
  return {
    path,
    with: (change: { readonly path?: string }) => extensionUri(change.path ?? path),
    toString: () => `file://${path}`,
  } as vscode.Uri;
}

function webviewHarness(): {
  readonly webview: vscode.Webview;
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly receive: () => ((message: unknown) => void) | undefined;
} {
  let listener: ((message: unknown) => void) | undefined;
  const postMessage = vi.fn(() => Promise.resolve(true));
  const webview = {
    cspSource: 'vscode-webview://gitool',
    options: {},
    html: '',
    asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
    postMessage,
    onDidReceiveMessage: vi.fn((value: (message: unknown) => void) => {
      listener = value;
      return { dispose: vi.fn() };
    }),
  } as unknown as vscode.Webview;
  return { webview, postMessage, receive: () => listener };
}

describe('提交历史 Webview Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展开详情时回传当前主题文件图标类', async () => {
    const details = {
      hash: 'a'.repeat(40),
      parentHash: 'b'.repeat(40),
      files: [
        { status: 'M' as const, path: 'src/app.ts' },
        { status: 'A' as const, path: 'README' },
      ],
    };
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({ currentRepositoryId: '/repo/a', version: 3 })),
      loadCommitDetails: vi.fn(() => Promise.resolve(details)),
      reportFailure: vi.fn(),
    };
    const harness = webviewHarness();
    const themeRoot = extensionUri('/extensions/theme');
    const provider = new HistoryViewProvider({
      extensionUri: extensionUri(),
      gitApi: {} as never,
      repositoryService: service as never,
      loadFileIconTheme: vi.fn(() => Promise.resolve({
        css: '.gitool-file-icon-1::before { content: "x"; }',
        classForPath: (path: string) => path.endsWith('.ts')
          ? 'gitool-file-icon-1'
          : undefined,
        localResourceRoots: [themeRoot],
      })),
    });
    await provider.resolveWebviewView({
      webview: harness.webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView);

    harness.receive()?.({
      type: 'loadCommitDetails',
      repositoryId: '/repo/a',
      version: 3,
      hash: details.hash,
      requestId: 'details-1',
    });

    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith({
        type: 'commitDetails',
        repositoryId: '/repo/a',
        version: 3,
        details,
        fileIconClasses: ['gitool-file-icon-1', null],
      });
    });
    expect(harness.webview.options.localResourceRoots?.map((value) => value.path)).toEqual([
      '/extensions/gitool',
      '/extensions/theme',
    ]);
    expect(harness.webview.html).toContain('gitool-file-icon-1');
    expect(harness.webview.html).toMatch(/<style nonce="[^"]+">/u);
    provider.dispose();
  });

  it('详情读取失败时在当前操作位置明确提示错误', async () => {
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({ currentRepositoryId: '/repo/a', version: 3 })),
      loadCommitDetails: vi.fn(() => Promise.reject(new Error('对象不存在'))),
      reportFailure: vi.fn(() => true),
    };
    const harness = webviewHarness();
    const provider = new HistoryViewProvider({
      extensionUri: extensionUri(),
      gitApi: {} as never,
      repositoryService: service as never,
      loadFileIconTheme: vi.fn(() => Promise.resolve({
        css: '',
        classForPath: () => undefined,
        localResourceRoots: [],
      })),
    });
    await provider.resolveWebviewView({
      webview: harness.webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView);
    harness.receive()?.({
      type: 'loadCommitDetails',
      repositoryId: '/repo/a',
      version: 3,
      hash: 'a'.repeat(40),
      requestId: 'details-1',
    });

    await vi.waitFor(() => {
      expect(service.reportFailure).toHaveBeenCalledWith('提交历史', '对象不存在');
      expect(mocks.showErrorMessage).toHaveBeenCalledWith('Gitool：对象不存在');
    });
    provider.dispose();
  });
});
