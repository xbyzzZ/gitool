import type * as vscode from 'vscode';

function mediaUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  fileName: string,
): string {
  const basePath = extensionUri.path.endsWith('/')
    ? extensionUri.path.slice(0, -1)
    : extensionUri.path;
  return webview.asWebviewUri(extensionUri.with({
    path: `${basePath}/media/${fileName}`,
  })).toString();
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const SVG_REFRESH = '<svg id="refreshIcon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 6.4A5.5 5.5 0 1 0 13.9 9.2"/><path d="M13.6 2.6v3.2h-3.2"/></svg>';
const SVG_CHECK_ALL = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 8.6l3.4 3.4 7.4-8.4"/></svg>';
const SVG_TRASH = '<svg id="discardIcon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.4h10"/><path d="M6.2 4.4V3.2h3.6v1.2"/><path d="M4.4 4.4l.7 8.2h5.8l.7-8.2"/><path d="M6.8 7v4M9.2 7v4"/></svg>';
const SVG_HISTORY = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.3l2.3 1.4"/></svg>';
const SVG_BRANCH = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="3.4" r="1.4"/><circle cx="4" cy="12.6" r="1.4"/><circle cx="12" cy="5.6" r="1.4"/><path d="M4 4.8v6.4"/><path d="M4 7.2c0 3.4 8-.6 8 1.8"/></svg>';
const SVG_EMPTY_CHECK = '<svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M5.4 8.2l1.8 1.8 3.4-3.8"/></svg>';
const SVG_AI_ROBOT = '<svg id="aiGenIcon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.8V2.7"/><circle cx="8" cy="1.8" r="0.75"/><path d="M3.7 6.9v2.2M12.3 6.9v2.2"/><rect x="3.7" y="4.8" width="8.6" height="7.4" rx="2.2"/><circle cx="6.1" cy="8" r="0.95" fill="currentColor" stroke="none"/><circle cx="9.9" cy="8" r="0.95" fill="currentColor" stroke="none"/><path d="M6.3 10.4h3.4"/></svg>';
const SVG_AI_GEAR = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.6"/><path d="M6.7 1.5h2.6M8 2.8v1.3M14.5 6.7v2.6M13.2 8h-1.3M6.7 14.5h2.6M8 13.2v-1.3M1.5 6.7v2.6M2.8 8h1.3M11 3.1l1.9 1.9M12 4.1l-1.1 1.1M5 3.1L3.1 5M4 4.1l1.1 1.1M3.1 11l1.9 1.9M4 11.9l1.1-1.1M12.9 11L11 12.9M12 11.9l-1.1-1.1"/></svg>';
const SVG_BACK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5"/></svg>';
const SVG_SEARCH = '<svg class="search-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>';
const SVG_BRANCH_CHIP = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4" cy="3" r="1.6"/><circle cx="4" cy="13" r="1.6"/><circle cx="12" cy="5" r="1.6"/><path d="M4 4.6v6.8"/><path d="M12 6.6c0 3-3.2 3.4-6.5 3.4"/></svg>';

function documentShell(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
  title: string,
  scriptName: string,
  content: string,
  additionalCss = '',
): string {
  const styleUri = escapeAttribute(mediaUri(webview, extensionUri, 'main.css'));
  const scriptUri = escapeAttribute(mediaUri(
    webview,
    extensionUri,
    scriptName,
  ));
  const safeNonce = escapeAttribute(nonce);
  const safeCspSource = escapeAttribute(webview.cspSource);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${safeCspSource} 'nonce-${safeNonce}'; font-src ${safeCspSource}; img-src ${safeCspSource}; script-src 'nonce-${safeNonce}';">
  <link rel="stylesheet" href="${styleUri}">
  ${additionalCss.length === 0 ? '' : `<style nonce="${safeNonce}">${additionalCss}</style>`}
  <title>${title}</title>
</head>
<body>
  ${content}
  <script nonce="${safeNonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

const workbenchView = `<div id="commit-view" class="view view-workbench">
    <header class="toolbar" data-od-id="commit-toolbar" aria-label="提交工具栏">
      <div class="toolbar-left" data-od-id="toolbar-primary">
        <button class="icon-btn" id="btnRefresh" type="button" title="刷新" aria-label="刷新">${SVG_REFRESH}</button>
        <button class="icon-btn" id="btnSelectAll" type="button" title="全选" aria-label="全选">${SVG_CHECK_ALL}</button>
        <button class="icon-btn danger" id="btnDiscard" type="button" title="舍弃所选更改" aria-label="舍弃所选更改">
          ${SVG_TRASH}<span id="discardText" hidden>确认舍弃？</span>
        </button>
        <span class="vsep" aria-hidden="true"></span>
        <button class="icon-btn" id="btnHistory" type="button" title="查看历史" aria-label="查看历史" aria-pressed="false">${SVG_HISTORY}</button>
      </div>
      <div class="toolbar-right" data-od-id="toolbar-secondary">
        <button class="btn btn-ghost pull-btn" id="btnPull" type="button">拉取</button>
        <button class="btn btn-secondary" id="btnPush" type="button">推送</button>
      </div>
    </header>
    <div class="repo-bar" data-od-id="repo-bar" aria-label="当前仓库">
      ${SVG_BRANCH}
      <span class="branch-name" id="branchName">…</span>
      <span class="repo-dot" aria-hidden="true">·</span>
      <span class="upstream" id="upstreamText">正在读取仓库…</span>
      <label class="visually-hidden" for="repository-select">选择仓库</label>
      <select id="repository-select" aria-label="选择 Git 仓库" hidden></select>
    </div>
    <main class="changes" id="changeList" data-od-id="change-list" aria-label="变更文件列表">
      <p id="loading-status" class="status-line" role="status">正在读取仓库状态…</p>
      <div class="empty" data-od-id="empty-state">
        ${SVG_EMPTY_CHECK}
        <span>没有待提交的变更</span>
      </div>
    </main>
    <div class="splitter" id="splitter" role="separator" aria-orientation="horizontal"
         aria-label="调整提交区高度" aria-valuemin="150" aria-valuenow="240" tabindex="0" data-od-id="dock-splitter"></div>
    <section class="dock" id="dock" data-od-id="commit-dock" aria-label="提交信息与操作">
      <section id="operation-feedback" class="dock-feedback" aria-label="操作反馈">
        <p id="operation-status" aria-live="polite"></p>
        <p id="error-status" role="alert" hidden></p>
        <button id="retry-push-button" class="link-btn" type="button" aria-label="重试推送当前提交" hidden>重试推送</button>
      </section>
      <div class="message-wrap" data-od-id="commit-message">
        <textarea id="message" rows="3" placeholder="输入本次提交信息…" aria-label="提交信息" spellcheck="true"></textarea>
      </div>
      <div class="dock-bar" data-od-id="commit-actions">
        <div class="dock-left" data-od-id="commit-ai">
          <div class="ai-group" data-od-id="ai-controls">
            <button class="icon-btn" id="btnAiGen" type="button"
                    title="生成提交信息（标准：标题 + 2–4 条关键变化）" aria-label="生成提交信息（标准：标题 + 2–4 条关键变化）">${SVG_AI_ROBOT}</button>
            <button class="icon-btn" id="btnAiSettings" type="button"
                    aria-haspopup="menu" aria-expanded="false" title="AI 设置" aria-label="AI 设置">${SVG_AI_GEAR}</button>
          </div>
        </div>
        <div class="dock-right" data-od-id="commit-confirm">
          <span class="stats">已选择 <b id="selCount">0</b><span class="total" id="selTotal"></span></span>
          <button class="btn btn-secondary" id="btnCommitPush" type="button" aria-label="提交并推送所选文件">提交并推送</button>
          <button class="btn btn-primary" id="btnCommit" type="button" aria-label="提交所选文件">提交</button>
        </div>
      </div>
    </section>
  </div>`;

const historyView = `<div id="history-view" class="view view-history" aria-label="提交历史" hidden>
    <header class="toolbar" data-od-id="history-toolbar">
      <button class="back-link" id="btnBack" type="button" aria-label="返回提交工作台">
        ${SVG_BACK}<span class="back-txt">提交工作台</span>
      </button>
      <h1 class="toolbar-title">提交历史</h1>
      <div class="toolbar-spacer"></div>
      <div class="search">
        ${SVG_SEARCH}
        <input id="search-input" type="text" placeholder="筛选提交…" aria-label="筛选提交">
      </div>
      <span class="branch-chip">${SVG_BRANCH_CHIP}<span class="branch-chip-name" id="historyBranchName">…</span></span>
    </header>
    <p id="history-status" class="status-line" role="status" hidden>正在读取提交历史…</p>
    <main class="commit-list" id="commit-list" data-od-id="commit-list" aria-label="提交历史列表">
      <div id="graph-host" aria-hidden="true"></div>
      <div class="empty-state" data-od-id="history-empty">没有匹配的提交</div>
    </main>
  </div>`;

export function renderCommitWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
  fileIconThemeCss = '',
): string {
  return documentShell(
    webview,
    extensionUri,
    nonce,
    'Gitool 提交',
    'commit.js',
    `<main class="layout commit-workbench" aria-busy="true">
  ${workbenchView}
  ${historyView}
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`,
    fileIconThemeCss,
  );
}
