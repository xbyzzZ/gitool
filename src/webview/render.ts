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
    <section class="repository-panel" aria-labelledby="repository-heading">
      <h1 id="repository-heading" class="visually-hidden">当前 Git 仓库</h1>
      <div class="field-row">
        <label class="visually-hidden" for="repository-select">选择仓库</label>
        <select id="repository-select" aria-label="选择 Git 仓库"></select>
        <button id="edit-remote-button" class="icon-button" type="button" aria-label="修改远程 URL" title="修改远程 URL">远程</button>
      </div>
      <p id="repository-summary" class="repository-summary">正在读取仓库…</p>
    </section>

    <section class="selection-toolbar" aria-label="选择摘要">
      <span id="selection-summary">已选择 0 个文件</span>
      <button id="refresh-button" class="icon-button" type="button" aria-label="刷新仓库状态" title="刷新仓库状态">刷新</button>
    </section>

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

    <section class="feedback" aria-label="操作反馈">
      <p id="loading-status" class="loading-status" role="status">正在加载仓库状态…</p>
      <p id="operation-status" class="operation-status" aria-live="polite"></p>
      <p id="error-status" class="error-status" role="alert" hidden></p>
      <button id="retry-push-button" class="secondary" type="button" hidden>重试推送</button>
    </section>

    <section class="commit-panel" aria-labelledby="commit-heading">
      <label id="commit-heading" for="commit-message">提交信息</label>
      <textarea id="commit-message" rows="3" placeholder="输入本次提交信息" spellcheck="true"></textarea>
      <div class="commit-actions">
        <button id="commit-button" class="secondary" type="button" aria-label="提交所选文件">提交</button>
        <button id="commit-push-button" class="primary" type="button" aria-label="提交并推送所选文件">提交并推送</button>
      </div>
    </section>
  </main>
  <script nonce="${safeNonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
