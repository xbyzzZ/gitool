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

function renderHtml(): string {
  return renderCommitWebviewHtml(createWebview(), createExtensionUri(), 'nonce-123');
}

describe('独立 Webview 壳页面', () => {
  it('生成带严格 CSP 和 nonce 的固定壳页面', () => {
    const html = renderHtml();

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-nonce-123'");
    expect(html).toContain("style-src vscode-webview://gitool");
    expect(html).toContain("font-src vscode-webview://gitool");
    expect(html).toContain('/media/main.css');
    expect(html).not.toContain('codicon');
    expect(html).toContain('<script nonce="nonce-123"');
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
  });

  it('工作台工具栏按原型排布：刷新、全选、两步舍弃、分隔线、历史入口，右侧拉取与推送', () => {
    const html = renderHtml();

    expect(html).toContain('id="btnRefresh"');
    expect(html).toContain('id="refreshIcon"');
    expect(html).toContain('id="btnSelectAll"');
    expect(html).toContain('id="btnDiscard"');
    expect(html).toContain('class="icon-btn danger" id="btnDiscard"');
    expect(html).toContain('<span id="discardText" hidden>确认舍弃？</span>');
    expect(html).toContain('<span class="vsep"');
    expect(html).toContain('id="btnHistory"');
    expect(html).toContain('class="btn btn-ghost pull-btn" id="btnPull"');
    expect(html).toContain('class="btn btn-secondary" id="btnPush"');
    expect(html).toContain('>拉取</button>');
    expect(html).toContain('>推送</button>');

    expect(html.indexOf('id="btnRefresh"')).toBeLessThan(html.indexOf('id="btnSelectAll"'));
    expect(html.indexOf('id="btnSelectAll"')).toBeLessThan(html.indexOf('id="btnDiscard"'));
    expect(html.indexOf('id="btnDiscard"')).toBeLessThan(html.indexOf('id="btnHistory"'));
    expect(html.indexOf('id="btnHistory"')).toBeLessThan(html.indexOf('id="btnPull"'));
    expect(html.indexOf('id="btnPull"')).toBeLessThan(html.indexOf('id="btnPush"'));
  });

  it('工具栏移除修改远程与独立清空选择按钮', () => {
    const html = renderHtml();

    expect(html).not.toContain('edit-remote-button');
    expect(html).not.toContain('clear-selection-button');
    expect(html).not.toContain('view-switch-button');
  });

  it('仓库条包含分支名、上游信息与多仓库下拉', () => {
    const html = renderHtml();

    expect(html).toContain('class="repo-bar"');
    expect(html).toContain('class="branch-name" id="branchName"');
    expect(html).toContain('class="repo-dot"');
    expect(html).toContain('class="upstream" id="upstreamText"');
    expect(html).toContain('<select id="repository-select" aria-label="选择 Git 仓库" hidden></select>');
    expect(html).toContain('class="visually-hidden" for="repository-select"');
  });

  it('变更列表容器、空态与读取状态齐全', () => {
    const html = renderHtml();

    expect(html).toContain('class="changes" id="changeList"');
    expect(html).toContain('id="loading-status" class="status-line" role="status"');
    expect(html).toContain('class="empty" data-od-id="empty-state"');
    expect(html).toContain('没有待提交的变更');
  });

  it('分隔拖条带 separator 语义并位于变更列表与提交坞之间', () => {
    const html = renderHtml();

    expect(html).toContain('class="splitter" id="splitter" role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-valuemin="150"');
    expect(html).toContain('tabindex="0"');
    expect(html.indexOf('id="splitter"')).toBeGreaterThan(html.indexOf('id="changeList"'));
    expect(html.indexOf('id="splitter"')).toBeLessThan(html.indexOf('id="dock"'));
  });

  it('提交坞包含操作反馈区、消息输入与字符计数', () => {
    const html = renderHtml();

    expect(html).toContain('class="dock" id="dock"');
    expect(html).toContain('id="operation-feedback" class="dock-feedback"');
    expect(html).toContain('id="operation-status" aria-live="polite"');
    expect(html).toContain('id="error-status" role="alert" hidden');
    expect(html).toContain('id="retry-push-button" class="link-btn"');
    expect(html).toContain('重试推送');
    expect(html).toContain('class="message-wrap"');
    expect(html).toContain('<textarea id="message"');
    expect(html).toContain('placeholder="输入本次提交信息…"');
    expect(html).toContain('class="char-count" id="charCount"');
    expect(html.indexOf('id="operation-feedback"')).toBeLessThan(html.indexOf('id="message"'));
  });

  it('提交坞底栏左侧为 AI 控件组，右侧统计在前、主按钮最后', () => {
    const html = renderHtml();

    expect(html).toContain('class="ai-group"');
    expect(html).toContain('id="btnAiGen"');
    expect(html).toContain('id="aiGenIcon"');
    expect(html).toContain('id="btnAiSettings"');
    expect(html).toMatch(/id="btnAiSettings"[^>]*aria-haspopup="menu" aria-expanded="false"/u);
    expect(html).toContain('<b id="selCount">0</b>');
    expect(html).toContain('class="total" id="selTotal"');
    expect(html).toContain('已选择');
    expect(html).toContain('class="btn btn-secondary" id="btnCommitPush"');
    expect(html).toContain('class="btn btn-primary" id="btnCommit"');

    expect(html.indexOf('id="btnAiGen"')).toBeLessThan(html.indexOf('id="btnAiSettings"'));
    expect(html.indexOf('id="btnAiSettings"')).toBeLessThan(html.indexOf('id="selCount"'));
    expect(html.indexOf('id="selCount"')).toBeLessThan(html.indexOf('id="btnCommitPush"'));
    expect(html.indexOf('id="btnCommitPush"')).toBeLessThan(html.indexOf('id="btnCommit"'));
  });

  it('AI 弹层由客户端动态创建，骨架仅提供按钮钩子', () => {
    const html = renderHtml();

    expect(html).not.toContain('class="popover"');
    expect(html).not.toContain('role="menuitemradio"');
    expect(html).not.toContain('id="ai-density-menu"');
  });

  it('历史视图默认隐藏，包含返回按钮、标题、搜索框与分支徽章', () => {
    const html = renderHtml();

    expect(html).toContain('id="history-view" class="view view-history" aria-label="提交历史" hidden');
    expect(html.indexOf('id="history-view"')).toBeGreaterThan(html.indexOf('id="commit-view"'));
    expect(html).toContain('class="back-link" id="btnBack"');
    expect(html).toContain('<span class="back-txt">提交工作台</span>');
    expect(html).toContain('<h1 class="toolbar-title">提交历史</h1>');
    expect(html).toContain('class="toolbar-spacer"');
    expect(html).toContain('class="search-icon"');
    expect(html).toContain('<input id="search-input" type="text" placeholder="筛选提交…" aria-label="筛选提交">');
    expect(html).toContain('class="branch-chip"');
    expect(html).toContain('class="branch-chip-name" id="historyBranchName"');
  });

  it('历史列表容器包含图覆盖层、空态、状态行与全局 toast', () => {
    const html = renderHtml();

    expect(html).toContain('class="commit-list" id="commit-list"');
    expect(html).toContain('<div id="graph-host" aria-hidden="true"></div>');
    expect(html).toContain('class="empty-state" data-od-id="history-empty"');
    expect(html).toContain('没有匹配的提交');
    expect(html).toContain('id="history-status" class="status-line" role="status" hidden');
    expect(html).toContain('<div class="toast" id="toast" role="status" aria-live="polite"></div>');
  });

  it('图标全部内联 SVG，不依赖 Codicon 类', () => {
    const html = renderHtml();

    expect(html).toContain('<svg');
    expect(html).not.toContain('codicon-');
  });

  it('当前文件图标主题使用 nonce 样式且不放宽内联脚本策略', () => {
    const html = renderCommitWebviewHtml(
      createWebview(),
      createExtensionUri(),
      'nonce-123',
      '.gitool-file-icon-1::before { content: "x"; }',
    );
    expect(html).toContain('<style nonce="nonce-123">');
    expect(html).toContain('.gitool-file-icon-1::before');
    expect(html).toContain('img-src vscode-webview://gitool');
    expect(html).not.toContain("'unsafe-inline'");
  });

  it('只生成固定壳，不包含动态仓库数据或敏感文本', () => {
    const html = renderHtml();

    expect(html).not.toContain('/workspace/private/project');
    expect(html).not.toContain('https://user:secret@example.test/repo.git');
    expect(html).not.toContain('尚未发送的提交信息');
    expect(html).not.toContain('innerHTML');
  });
});
