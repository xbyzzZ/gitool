import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { renderWebviewHtml } from '../../src/webview/render.js';

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

describe('renderWebviewHtml', () => {
  it('生成带严格 CSP 和 nonce 的固定壳页面', () => {
    const html = renderWebviewHtml(
      createWebview(), createExtensionUri(), 'nonce-123',
    );

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-nonce-123'");
    expect(html).toContain("style-src vscode-webview://gitool");
    expect(html).toContain('<script nonce="nonce-123"');
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
  });

  it('只渲染提交输入，不重复绘制 View 标题、变更树和历史树', () => {
    const html = renderWebviewHtml(
      createWebview(), createExtensionUri(), 'nonce-123',
    );

    expect(html).toContain('id="commit-message"');
    expect(html).toContain('id="ai-generate-button"');
    expect(html).toContain('id="commit-button"');
    expect(html).toContain('id="commit-push-button"');
    expect(html).not.toContain('class="pane-header"');
    expect(html).not.toContain('id="tracked-group"');
    expect(html).not.toContain('id="history-list"');
    expect(html).not.toContain('pane-resizer');
  });

  it('只生成固定壳，不包含动态仓库数据或敏感文本', () => {
    const html = renderWebviewHtml(
      createWebview(), createExtensionUri(), 'nonce-123',
    );

    expect(html).not.toContain('/workspace/private/project');
    expect(html).not.toContain('https://user:secret@example.test/repo.git');
    expect(html).not.toContain('尚未发送的提交信息');
    expect(html).not.toContain('innerHTML');
  });

  it('为状态、错误和关键操作提供可访问语义', () => {
    const html = renderWebviewHtml(
      createWebview(), createExtensionUri(), 'nonce-123',
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="提交所选文件"');
    expect(html).toContain('aria-label="提交并推送所选文件"');
    expect(html).toContain('aria-label="重试推送当前提交"');
  });
});
