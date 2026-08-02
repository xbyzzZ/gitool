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

function documentShell(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
  title: string,
  scriptName: string,
  content: string,
): string {
  const styleUri = escapeAttribute(mediaUri(webview, extensionUri, 'main.css'));
  const codiconStyleUri = escapeAttribute(mediaUri(
    webview,
    extensionUri,
    'codicon.css',
  ));
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${safeCspSource}; font-src ${safeCspSource}; script-src 'nonce-${safeNonce}';">
  <link rel="stylesheet" href="${codiconStyleUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>${title}</title>
</head>
<body>
  ${content}
  <script nonce="${safeNonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function renderCommitWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string {
  return documentShell(
    webview,
    extensionUri,
    nonce,
    'Gitool 提交信息',
    'commit.js',
    `<main class="layout commit-layout" aria-busy="true">
    <section class="commit-panel workbench-pane">
      <label class="visually-hidden" for="repository-select">选择仓库</label>
      <select id="repository-select" aria-label="选择 Git 仓库" hidden></select>
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
        <section id="operation-feedback" class="feedback" aria-label="操作反馈">
          <p id="loading-status" class="loading-status" role="status">正在加载仓库状态…</p>
          <p id="operation-status" class="operation-status" aria-live="polite"></p>
          <p id="error-status" class="error-status" role="alert" hidden></p>
          <button id="retry-push-button" class="secondary" type="button" aria-label="重试推送当前提交" hidden>重试推送</button>
        </section>
      </div>
    </section>
  </main>`,
  );
}
