import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import * as renderModule from '../../src/webview/render.js';

const { renderCommitWebviewHtml } = renderModule;

function createWebview(): vscode.Webview {
  return {
    cspSource: 'vscode-webview://gitool',
    asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
  } as unknown as vscode.Webview;
}

function createExtensionUri(): vscode.Uri {
  function uriForPath(path: string): vscode.Uri {
    return {
      path,
    with(change: { readonly path?: string }): vscode.Uri {
        return uriForPath(change.path ?? path);
    },
    toString(): string {
      return `file://${path}`;
    },
    } as vscode.Uri;
  }
  return uriForPath('/extensions/gitool');
}

describe('独立 Webview 壳页面', () => {
  it('生成带严格 CSP 和 nonce 的固定壳页面', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-nonce-123'");
    expect(html).toContain("style-src vscode-webview://gitool");
    expect(html).toContain("font-src vscode-webview://gitool");
    expect(html).toContain('/media/codicon.css');
    expect(html).toContain('<script nonce="nonce-123"');
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
  });

  it('提交页面只保留现有提交内容', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );
    expect(html).toContain('id="commit-message"');
    expect(html).toContain('提交并推送');
    expect(html).toContain('id="ai-generate-button"');
    expect(html).not.toContain('id="tracked-group"');
    expect(html).not.toContain('id="history-list"');
    expect(html).not.toContain('class="pane-resizer"');
  });

  it('渲染模块不再提供历史 Webview 页面', () => {
    expect('renderHistoryWebviewHtml' in renderModule).toBe(false);
  });

  it('不再生成由原生视图标题栏承载的内部工具栏', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );
    expect(html).not.toContain('id="edit-remote-button"');
    expect(html).not.toContain('class="pane-header"');
    expect(html).not.toContain('>⋯</button>');
  });

  it('只生成固定壳，不包含动态仓库数据或敏感文本', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );

    expect(html).not.toContain('/workspace/private/project');
    expect(html).not.toContain('https://user:secret@example.test/repo.git');
    expect(html).not.toContain('尚未发送的提交信息');
    expect(html).not.toContain('innerHTML');
  });

  it('为状态、错误和关键操作提供可访问语义', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="提交所选文件"');
    expect(html).toContain('aria-label="提交并推送所选文件"');
    expect(html).toContain('aria-label="重试推送当前提交"');
  });
});
