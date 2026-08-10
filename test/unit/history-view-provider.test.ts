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
  it('选择提交后把详情交给原生提交文件视图', async () => {
    let receive: ((message: unknown) => void) | undefined;
    const details = {
      hash: 'a'.repeat(40),
      parentHash: 'b'.repeat(40),
      files: [{ status: 'M' as const, path: 'src/app.ts' }],
    };
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({ currentRepositoryId: '/repo/a', version: 3 })),
      loadCommitDetails: vi.fn(() => Promise.resolve(details)),
      reportFailure: vi.fn(),
    };
    const historyFilesProvider = { clear: vi.fn(), selectCommit: vi.fn() };
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
      historyFilesProvider: historyFilesProvider as never,
    });
    provider.resolveWebviewView({
      webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView);

    receive?.({
      type: 'selectHistoryCommit',
      repositoryId: '/repo/a',
      version: 3,
      hash: details.hash,
      requestId: 'select-1',
    });

    await vi.waitFor(() => {
      expect(historyFilesProvider.clear).toHaveBeenCalledOnce();
      expect(historyFilesProvider.selectCommit).toHaveBeenCalledWith(
        '/repo/a',
        3,
        details,
      );
    });
    provider.dispose();
  });

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
    const historyFilesProvider = { clear: vi.fn(), selectCommit: vi.fn() };
    const provider = new HistoryViewProvider({
      extensionUri: extensionUri(),
      gitApi: {} as never,
      repositoryService: service as never,
      historyFilesProvider: historyFilesProvider as never,
    });
    provider.resolveWebviewView({
      webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView);

    receive?.({
      type: 'selectHistoryCommit',
      repositoryId: '/repo/a',
      version: 3,
      hash: 'a'.repeat(40),
      requestId: 'details-1',
    });

    await vi.waitFor(() => {
      expect(historyFilesProvider.clear).toHaveBeenCalledOnce();
      expect(historyFilesProvider.selectCommit).not.toHaveBeenCalled();
      expect(service.reportFailure).toHaveBeenCalledWith('提交历史', '对象不存在');
      expect(mocks.showErrorMessage).toHaveBeenCalledWith('Gitool：对象不存在');
    });
    provider.dispose();
  });

  it('快速选择时只允许最新详情写入原生文件视图', async () => {
    let receive: ((message: unknown) => void) | undefined;
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = new Promise((resolve) => { resolveSecond = resolve; });
    const service = {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      getViewModel: vi.fn(() => ({ currentRepositoryId: '/repo/a', version: 3 })),
      loadCommitDetails: vi.fn((message: { readonly hash: string }) =>
        message.hash.startsWith('a') ? first : second),
      reportFailure: vi.fn(),
    };
    const historyFilesProvider = { clear: vi.fn(), selectCommit: vi.fn() };
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
      historyFilesProvider: historyFilesProvider as never,
    });
    provider.resolveWebviewView({
      webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView);
    const hashA = 'a'.repeat(40);
    const hashB = 'b'.repeat(40);
    receive?.({ type: 'selectHistoryCommit', repositoryId: '/repo/a', version: 3,
      hash: hashA, requestId: 'select-a' });
    receive?.({ type: 'selectHistoryCommit', repositoryId: '/repo/a', version: 3,
      hash: hashB, requestId: 'select-b' });

    resolveSecond?.({ hash: hashB, files: [{ status: 'M', path: 'b.ts' }] });
    await vi.waitFor(() => {
      expect(historyFilesProvider.selectCommit).toHaveBeenCalledOnce();
    });
    resolveFirst?.({ hash: hashA, files: [{ status: 'M', path: 'a.ts' }] });
    await Promise.resolve();
    expect(historyFilesProvider.clear).toHaveBeenCalledTimes(2);
    expect(historyFilesProvider.selectCommit).toHaveBeenCalledOnce();
    expect(historyFilesProvider.selectCommit).toHaveBeenCalledWith(
      '/repo/a', 3, expect.objectContaining({ hash: hashB }),
    );
    provider.dispose();
  });
});
