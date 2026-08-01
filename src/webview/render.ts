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

export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string {
  const styleUri = escapeAttribute(mediaUri(
    webview,
    extensionUri,
    'main.css',
  ));
  const scriptUri = escapeAttribute(mediaUri(
    webview,
    extensionUri,
    'main.js',
  ));
  const safeNonce = escapeAttribute(nonce);
  const safeCspSource = escapeAttribute(webview.cspSource);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${safeCspSource}; script-src 'nonce-${safeNonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Gitool 文件提交</title>
</head>
<body>
  <main class="layout" aria-busy="true">
    <section class="commit-panel workbench-pane" aria-labelledby="commit-heading">
      <header class="pane-header">
        <h1 id="commit-heading">提交信息</h1>
        <div class="pane-actions">
          <label class="visually-hidden" for="repository-select">选择仓库</label>
          <select id="repository-select" aria-label="选择 Git 仓库" hidden></select>
          <button id="edit-remote-button" class="icon-button" type="button" aria-label="修改远程 URL" title="修改远程 URL">⋯</button>
          <button id="collapse-commit-button" class="icon-button" type="button" aria-label="折叠提交信息" title="折叠提交信息">⌃</button>
        </div>
      </header>
      <p id="repository-summary" class="visually-hidden">正在读取仓库…</p>
      <div class="pane-content commit-content">
        <textarea id="commit-message" rows="3" placeholder="输入本次提交信息" spellcheck="true"></textarea>
        <div class="commit-actions">
          <div class="ai-actions">
            <button id="ai-generate-button" class="ai-button" type="button" aria-label="使用 AI 生成提交信息">AI 生成 · 标准</button>
            <button id="ai-density-button" class="ai-menu-button" type="button" aria-label="选择 AI 信息密度" aria-haspopup="menu">⌄</button>
            <div id="ai-density-menu" role="menu" hidden></div>
          </div>
          <div class="primary-actions">
            <button id="commit-button" class="secondary" type="button" aria-label="提交所选文件">仅提交</button>
            <button id="commit-push-button" class="primary" type="button" aria-label="提交并推送所选文件">提交并推送</button>
          </div>
        </div>
        <section class="feedback" aria-label="操作反馈">
          <p id="loading-status" class="loading-status" role="status">正在加载仓库状态…</p>
          <p id="operation-status" class="operation-status" aria-live="polite"></p>
          <p id="error-status" class="error-status" role="alert" hidden></p>
          <button id="retry-push-button" class="secondary" type="button" aria-label="重试推送当前提交" hidden>重试推送</button>
        </section>
      </div>
    </section>

    <div id="commit-changes-resizer" class="pane-resizer" role="separator" aria-label="调整提交信息与当前变更的高度" aria-orientation="horizontal" tabindex="0"></div>

    <section class="changes-panel workbench-pane" aria-labelledby="changes-heading">
      <header class="pane-header">
        <h2 id="changes-heading">当前变更 <span id="selection-summary" class="pane-summary">已选择 0 个文件</span></h2>
        <div class="pane-actions">
          <button id="pull-button" class="icon-button" type="button" aria-label="从远程拉取" title="从远程拉取">↓</button>
          <button id="push-all-button" class="icon-button" type="button" aria-label="将全部本地提交推送到远程" title="推送全部">↑</button>
          <button id="fetch-history-button" class="icon-button" type="button" aria-label="刷新远程状态" title="刷新远程状态">↻</button>
          <button id="refresh-button" class="icon-button" type="button" aria-label="刷新仓库状态" title="刷新仓库状态">刷新</button>
          <button id="collapse-changes-button" class="icon-button" type="button" aria-label="折叠当前变更" title="折叠当前变更">⌃</button>
        </div>
      </header>
      <div class="pane-content changes-content">
        <section class="change-group" aria-labelledby="tracked-heading">
          <div class="group-heading">
            <label>
              <input id="tracked-group-toggle" type="checkbox">
              <span id="tracked-heading">已跟踪变更</span>
            </label>
            <span id="tracked-count" class="count">0</span>
          </div>
          <div id="tracked-group" class="file-list" role="list"></div>
        </section>

        <section class="change-group" aria-labelledby="untracked-heading">
          <div class="group-heading">
            <label>
              <input id="untracked-group-toggle" type="checkbox">
              <span id="untracked-heading">未跟踪文件</span>
            </label>
            <div class="group-actions">
              <span id="untracked-count" class="count">0</span>
              <button id="trash-button" class="danger-link" type="button" aria-label="将选中的未跟踪文件移入废纸篓">舍弃</button>
            </div>
          </div>
          <div id="untracked-group" class="file-list" role="list"></div>
        </section>
      </div>
    </section>

    <div id="changes-history-resizer" class="pane-resizer" role="separator" aria-label="调整当前变更与提交历史的高度" aria-orientation="horizontal" tabindex="0"></div>

    <section class="history-panel workbench-pane" aria-labelledby="history-heading">
      <header class="pane-header">
        <h2 id="history-heading">提交历史 <span id="sync-summary" class="pane-summary"></span></h2>
        <div class="pane-actions">
          <button id="refresh-history-button" class="icon-button" type="button" aria-label="刷新提交历史" title="刷新提交历史">↻</button>
          <button id="collapse-history-button" class="icon-button" type="button" aria-label="折叠提交历史" title="折叠提交历史">⌃</button>
        </div>
      </header>
      <div id="history-status" class="history-status" aria-live="polite"></div>
      <div id="history-list" class="history-list" role="tree" aria-label="提交历史记录"></div>
    </section>
  </main>
  <script nonce="${safeNonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
