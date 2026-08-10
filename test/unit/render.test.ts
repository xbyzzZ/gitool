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

  it('提交页面整合工具栏、变更列表和固定提交区', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );
    expect(html).toContain('id="commit-message"');
    expect(html).toContain('提交并推送');
    expect(html).toContain('id="changes-list"');
    expect(html).toContain('class="commit-toolbar"');
    expect(html).toContain('class="commit-dock"');
    expect(html).toContain('id="selection-summary"');
    expect(html).toContain('id="trash-button"');
    expect(html).toContain('id="edit-remote-button"');
    expect(html).toContain('id="ai-generate-button"');
    expect(html).toContain('id="ai-model-button"');
    expect(html).toContain('id="ai-model-name"');
    expect(html).toContain('>自动选择</span>');
    expect(html).not.toContain('id="history-list"');
    expect(html).not.toContain('class="pane-resizer"');
  });

  it('AI 按钮默认渲染标准密度的固定星群和加载节点', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );

    expect(html).toContain('id="ai-generate-icon"');
    expect(html).toContain('class="ai-density-icon"');
    expect(html).toContain('data-density="standard"');
    expect(html.match(/<svg class="ai-density-star/gu)).toHaveLength(3);
    expect(html).not.toContain('codicon-sparkle ai-density-star');
    expect(html).toContain('ai-density-loading');
  });

  it('提交操作使用 PyCharm 风格文字按钮', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );

    expect(html).toContain('codicon-chevron-down');
    expect(html).not.toContain('codicon-hubot');
    expect(html).toContain('>提交</button>');
    expect(html).toContain('>提交并推送</button>');
    expect(html).toContain('codicon-cloud-upload');
  });

  it('生成内容按钮委托宿主选择且不渲染受视图高度限制的菜单', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );

    expect(html).toContain('id="ai-density-button"');
    expect(html).not.toContain('id="ai-density-menu"');
    expect(html).not.toContain('role="menuitemradio"');
  });

  it('当前文件图标主题使用 nonce 样式且不放宽内联脚本策略', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
      '.gitool-file-icon-1::before { content: "x"; }',
    );
    expect(html).toContain('<style nonce="nonce-123">');
    expect(html).toContain('img-src vscode-webview://gitool');
    expect(html).not.toContain("'unsafe-inline'");
  });

  it('生成面向单一工作台的内部工具栏', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
    );
    expect(html).toContain('id="edit-remote-button"');
    expect(html).toContain('id="refresh-button"');
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
