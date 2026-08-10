import type { RepositoryViewModel } from '../domain/view-model.js';
import type { WebviewMessage } from './messages.js';
import { renderHistory } from './history-renderer.js';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
}

declare function acquireVsCodeApi(): VsCodeApi;

function requiredElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`缺少提交历史控件：${id}`);
  }
  return value;
}

const vscode = acquireVsCodeApi();
const layoutElement = document.querySelector<HTMLElement>('.history-layout');
if (layoutElement === null) {
  throw new Error('缺少提交历史主布局');
}
const layout = layoutElement;
const syncSummary = requiredElement('sync-summary');
const historyStatus = requiredElement('history-status');
const historyList = requiredElement('history-list');
let currentScope = '';
let sequence = 0;
let selectedCommitHash: string | undefined;

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function render(model: RepositoryViewModel): void {
  const nextScope = `${model.currentRepositoryId ?? ''}:${String(model.version)}`;
  if (nextScope !== currentScope) {
    currentScope = nextScope;
    selectedCommitHash = undefined;
  }
  layout.setAttribute('aria-busy', String(model.history.kind === 'loading'));
  syncSummary.textContent = model.sync.kind === 'ready'
    ? `${model.sync.upstream} · ↑${String(model.sync.ahead)} ↓${String(model.sync.behind)}`
    : model.sync.kind === 'detached' ? '游离 HEAD' : '未设置上游';
  const status = model.history.kind === 'loading'
    ? '正在读取提交历史…'
    : model.history.kind === 'failed'
      ? model.history.message
      : model.history.commits.length === 0 ? '暂无提交记录' : '';
  historyStatus.textContent = status;
  historyStatus.hidden = status.length === 0;
  historyStatus.classList.toggle('error-status', model.history.kind === 'failed');
  renderHistory(historyList, model.history.commits, selectedCommitHash, {
    selectCommit: (hash) => {
      if (model.currentRepositoryId === undefined) {
        return;
      }
      selectedCommitHash = hash;
      render(model);
      sequence += 1;
      post({
        type: 'selectHistoryCommit',
        repositoryId: model.currentRepositoryId,
        version: model.version,
        hash,
        requestId: `history-select-${String(sequence)}`,
      });
    },
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return;
  }
  if (message.type === 'state' && 'model' in message) {
    render((message as StateMessage).model);
  }
});

post({ type: 'ready' });
