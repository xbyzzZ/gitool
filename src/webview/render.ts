import type * as vscode from 'vscode';

// 源自 VS Code Codicon sparkle-filled 的单颗星轮廓。
const aiDensityStarPath = 'M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962Z';

function densityStarsMarkup(): string {
  const star = (className: string): string =>
    `<svg class="ai-density-star ${className}" viewBox="2 2 8 8" fill="currentColor" focusable="false"><path d="${aiDensityStarPath}"></path></svg>`;
  return `<span class="ai-density-stars">
    ${star('ai-density-star-primary')}
    ${star('ai-density-star-secondary')}
    ${star('ai-density-star-tertiary')}
  </span>`;
}

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
      <section class="commit-dock" aria-label="提交信息与操作">
        <section id="operation-feedback" class="feedback" aria-label="操作反馈">
          <p id="operation-status" class="operation-status" aria-live="polite"></p>
          <p id="error-status" class="error-status" role="alert" hidden></p>
          <button id="retry-push-button" class="secondary retry-push-button" type="button" aria-label="重试推送当前提交" hidden>重试推送</button>
        </section>
        <div class="commit-meta-row">
          <div class="ai-actions">
            <div class="ai-density-actions">
              <button id="ai-generate-button" class="ai-button commit-icon-button" type="button" aria-label="生成提交信息：标准（标题 + 2–4 条关键变化）" title="生成提交信息：标准（标题 + 2–4 条关键变化）">
                <span id="ai-generate-icon" class="ai-density-icon" data-density="standard" aria-hidden="true">
                  ${densityStarsMarkup()}
                  <span class="codicon codicon-loading ai-density-loading"></span>
                </span>
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
