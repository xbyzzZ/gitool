import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

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

describe('提交历史 Webview Provider', () => {
  it('详情读取失败时在当前操作位置明确提示错误', async () => {
    let receive: ((message: unknown) => void) | undefined;
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({
        currentRepositoryId: '/repo/a',
        version: 3,
      })),
      loadCommitDetails: vi.fn(() => Promise.reject(new Error('对象不存在'))),
      reportFailure: vi.fn(() => true),
    };
    const webview = {
      cspSource: 'vscode-webview://gitool',
      options: {},
      html: '',
      asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
      postMessage: vi.fn(() => Promise.resolve(true)),
      onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
        receive = listener;
        return { dispose: vi.fn() };
      }),
    };
    const provider = new HistoryViewProvider({
      extensionUri: extensionUri(),
      gitApi: {} as never,
      repositoryService: service as never,
    });
    provider.resolveWebviewView({
      webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView);

    receive?.({
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
