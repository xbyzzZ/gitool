import type { CommitDetails } from '../domain/history-model.js';
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

interface CommitDetailsMessage {
  readonly type: 'commitDetails';
  readonly repositoryId: string;
  readonly version: number;
  readonly details: CommitDetails;
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
const expandedCommits = new Set<string>();
const commitDetails = new Map<string, readonly CommitDetails['files'][number][]>();
let currentModel: RepositoryViewModel | undefined;
let currentScope = '';
let sequence = 0;

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function render(model: RepositoryViewModel): void {
  const nextScope = `${model.currentRepositoryId ?? ''}:${String(model.version)}`;
  if (nextScope !== currentScope) {
    currentScope = nextScope;
    expandedCommits.clear();
    commitDetails.clear();
  }
  currentModel = model;
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
  renderHistory(historyList, model.history.commits, expandedCommits, commitDetails, {
    toggleCommit: (hash, expanded) => {
      if (expanded) {
        expandedCommits.add(hash);
        if (!commitDetails.has(hash) && model.currentRepositoryId !== undefined) {
          sequence += 1;
          post({
            type: 'loadCommitDetails',
            repositoryId: model.currentRepositoryId,
            version: model.version,
            hash,
            requestId: `details-${String(sequence)}`,
          });
        }
      } else {
        expandedCommits.delete(hash);
      }
      render(model);
    },
    openCommitDiff: (hash, path) => {
      if (model.currentRepositoryId === undefined) {
        return;
      }
      sequence += 1;
      post({
        type: 'openCommitDiff',
        repositoryId: model.currentRepositoryId,
        version: model.version,
        hash,
        path,
        requestId: `history-diff-${String(sequence)}`,
      });
    },
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return;
  }
  if (message.type === 'commitDetails') {
    const details = message as CommitDetailsMessage;
    if (currentModel?.currentRepositoryId === details.repositoryId
      && currentModel.version === details.version) {
      commitDetails.set(details.details.hash, details.details.files);
      render(currentModel);
    }
    return;
  }
  if (message.type === 'state' && 'model' in message) {
    render((message as StateMessage).model);
  }
});

post({ type: 'ready' });
