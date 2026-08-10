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
  additionalCss = '',
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${safeCspSource} 'nonce-${safeNonce}'; font-src ${safeCspSource}; img-src ${safeCspSource}; script-src 'nonce-${safeNonce}';">
  <link rel="stylesheet" href="${codiconStyleUri}">
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
      <header class="commit-toolbar" aria-label="提交工具栏">
        <div class="toolbar-group">
          <button id="refresh-button" class="icon-button" type="button" aria-label="刷新变更" title="刷新变更"><span class="codicon codicon-refresh" aria-hidden="true"></span></button>
          <button id="select-all-button" class="icon-button" type="button" aria-label="选择全部变更" title="选择全部变更"><span class="codicon codicon-check-all" aria-hidden="true"></span></button>
          <button id="clear-selection-button" class="icon-button" type="button" aria-label="清空文件选择" title="清空文件选择"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
          <button id="trash-button" class="icon-button danger-toolbar-button" type="button" aria-label="舍弃所选未跟踪文件" title="舍弃所选未跟踪文件"><span class="codicon codicon-trash" aria-hidden="true"></span></button>
        </div>
        <div class="toolbar-group toolbar-group-end">
          <button id="pull-button" class="icon-button" type="button" aria-label="从远程拉取" title="从远程拉取"><span class="codicon codicon-cloud-download" aria-hidden="true"></span></button>
          <button id="push-all-button" class="icon-button" type="button" aria-label="推送全部本地提交" title="推送全部本地提交"><span class="codicon codicon-cloud-upload" aria-hidden="true"></span></button>
        </div>
      </header>
      <section class="repository-strip" aria-label="当前仓库">
        <label class="visually-hidden" for="repository-select">选择仓库</label>
        <select id="repository-select" aria-label="选择 Git 仓库" hidden></select>
        <p id="repository-summary">正在读取仓库…</p>
      </section>
      <section class="changes-pane" aria-label="当前变更">
        <p id="loading-status" class="changes-status" role="status">正在读取仓库状态…</p>
        <div id="changes-list" class="changes-list" aria-label="变更文件列表"></div>
      </section>
      <div id="commit-resizer" class="commit-resizer" role="separator" aria-label="调整文件列表和提交信息区域高度" aria-orientation="horizontal" aria-valuemin="156" aria-valuenow="240" tabindex="0" title="拖动调整提交信息区域高度"></div>
      <section class="commit-dock" aria-label="提交信息与操作">
        <section id="operation-feedback" class="feedback" aria-label="操作反馈">
          <p id="operation-status" class="operation-status" aria-live="polite"></p>
          <p id="error-status" class="error-status" role="alert" hidden></p>
          <button id="retry-push-button" class="secondary retry-push-button" type="button" aria-label="重试推送当前提交" hidden>重试推送</button>
        </section>
        <div class="commit-meta-row">
          <div class="ai-actions">
            <div class="ai-density-actions">
              <button id="ai-generate-button" class="ai-button ai-density-text-button" type="button" aria-label="生成提交信息：标准（标题 + 2–4 条关键变化）" title="生成提交信息：标准（标题 + 2–4 条关键变化）">
                <span id="ai-generate-label">标准</span>
                <span id="ai-generate-loading" class="codicon codicon-loading ai-density-loading" aria-hidden="true"></span>
              </button>
              <button id="ai-density-button" class="ai-menu-button" type="button" aria-label="选择生成内容（当前：标准）" title="选择生成内容（当前：标准）">
                <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
              </button>
            </div>
            <button id="ai-model-button" class="ai-model-button" type="button" aria-label="选择 AI 模型（自动选择）" title="选择 AI 模型（自动选择）">
              <span id="ai-model-name" class="ai-model-name">自动选择</span>
              <span class="codicon codicon-chevron-down ai-model-chevron" aria-hidden="true"></span>
            </button>
          </div>
          <p id="selection-summary" class="selection-summary">已选择 0 / 0</p>
        </div>
        <label class="visually-hidden" for="commit-message">提交信息</label>
        <textarea id="commit-message" rows="5" placeholder="输入本次提交信息" spellcheck="true"></textarea>
        <footer class="commit-footer">
          <div class="primary-actions">
            <button id="commit-button" class="secondary commit-text-button" type="button" aria-label="提交所选文件">提交</button>
            <button id="commit-push-button" class="secondary commit-text-button" type="button" aria-label="提交并推送所选文件">提交并推送</button>
          </div>
          <button id="edit-remote-button" class="icon-button" type="button" aria-label="远程仓库设置" title="远程仓库设置"><span class="codicon codicon-settings-gear" aria-hidden="true"></span></button>
        </footer>
      </section>
    </main>`,
    fileIconThemeCss,
  );
}
