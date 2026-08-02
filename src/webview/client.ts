import type { OperationState, RepositoryViewModel } from '../domain/view-model.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';
import type { WebviewMessage } from './messages.js';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
  readonly acknowledgedRequestId?: string;
}

interface PersistedClientState {
  readonly densities: Readonly<Record<string, CommitMessageDensity>>;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`缺少 Webview 控件：${id}`);
  }
  return value;
}

const layoutElement = document.querySelector<HTMLElement>('.layout');
if (layoutElement === null) {
  throw new Error('缺少 Webview 主布局');
}
const layout = layoutElement;

const controls = {
  repositorySelect: element('repository-select') as HTMLSelectElement,
  repositorySummary: element('repository-summary'),
  loadingStatus: element('loading-status'),
  operationStatus: element('operation-status'),
  errorStatus: element('error-status'),
  retryPushButton: element('retry-push-button') as HTMLButtonElement,
  commitMessage: element('commit-message') as HTMLTextAreaElement,
  commitButton: element('commit-button') as HTMLButtonElement,
  commitPushButton: element('commit-push-button') as HTMLButtonElement,
  aiGenerateButton: element('ai-generate-button') as HTMLButtonElement,
  aiDensityButton: element('ai-density-button') as HTMLButtonElement,
  aiDensityMenu: element('ai-density-menu'),
};

let currentModel: RepositoryViewModel | undefined;
let commitMessageTimer: number | undefined;
let pendingCommitMessage: string | undefined;
let pendingWriteRequestId: string | undefined;
let pendingRepositoryId: string | undefined;
let pendingRepositoryRequestId: string | undefined;
let writeRequestSequence = 0;
let persistedState = readPersistedState(vscode.getState());
let activeDensity: CommitMessageDensity = 'standard';

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function setText(node: HTMLElement, value: string): void {
  node.textContent = value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPersistedState(value: unknown): PersistedClientState {
  if (!isObject(value) || !isObject(value.densities)) {
    return { densities: {} };
  }
  const densities: Record<string, CommitMessageDensity> = {};
  for (const [repositoryId, density] of Object.entries(value.densities)) {
    if (density === 'compact' || density === 'standard' || density === 'detailed') {
      densities[repositoryId] = density;
    }
  }
  return { densities };
}

function densityLabel(density: CommitMessageDensity): string {
  return { compact: '精简', standard: '标准', detailed: '详细' }[density];
}

function operationLabel(
  action: Extract<OperationState, { readonly kind: 'running' }>['action'],
): string {
  switch (action) {
    case 'commit':
      return '正在提交所选文件…';
    case 'push':
      return '正在推送提交…';
    default:
      return '正在执行操作…';
  }
}

function operationFeedback(operation: OperationState): { readonly message: string; readonly error: string; readonly retry: boolean } {
  switch (operation.kind) {
    case 'idle': return { message: '', error: '', retry: false };
    case 'running': return { message: operationLabel(operation.action), error: '', retry: false };
    case 'commit-succeeded': return { message: `提交已完成：${operation.commitHash}`, error: '', retry: false };
    case 'push-failed': return { message: `提交已创建：${operation.commitHash}`, error: operation.message, retry: true };
    case 'failed': return { message: '', error: operation.message, retry: false };
  }
}

function updateRepository(model: RepositoryViewModel): void {
  const options = document.createDocumentFragment();
  if (model.repositories.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.disabled = true;
    option.selected = true;
    setText(option, '没有打开的 Git 仓库');
    options.append(option);
  } else {
    for (const repository of model.repositories) {
      const option = document.createElement('option');
      option.value = repository.id;
      option.selected = repository.id === (pendingRepositoryId ?? model.currentRepositoryId);
      option.title = repository.rootPath;
      setText(option, repository.label);
      options.append(option);
    }
  }
  controls.repositorySelect.replaceChildren(options);
  controls.repositorySelect.hidden = model.repositories.length < 2;
  const branch = model.detached ? '游离 HEAD' : (model.branch ?? '未识别分支');
  const upstream = model.upstream === undefined ? '未设置上游' : `上游 ${model.upstream}`;
  setText(controls.repositorySummary, model.currentRepositoryId === undefined
    ? '打开一个 Git 仓库后可选择并提交文件'
    : `${branch} · ${upstream}`);
}

function render(model: RepositoryViewModel, acknowledgeHostState: boolean): void {
  if (acknowledgeHostState && model.currentRepositoryId === pendingRepositoryId) {
    pendingRepositoryId = undefined;
    pendingRepositoryRequestId = undefined;
  }
  currentModel = model;
  activeDensity = model.currentRepositoryId === undefined
    ? 'standard' : (persistedState.densities[model.currentRepositoryId] ?? 'standard');
  layout.setAttribute('aria-busy', model.operation.kind === 'running' ? 'true' : 'false');
  controls.loadingStatus.hidden = true;
  updateRepository(model);
  if (pendingCommitMessage === undefined || pendingCommitMessage === model.commitMessage) {
    controls.commitMessage.value = model.commitMessage;
    pendingCommitMessage = undefined;
  }
  const running = model.operation.kind === 'running';
  const noRepository = model.currentRepositoryId === undefined;
  const locallyBusy = pendingWriteRequestId !== undefined || pendingRepositoryId !== undefined;
  const hasConflict = model.changes.some((change) => change.conflicted);
  const canWrite = model.trusted && !noRepository && !running && !locallyBusy && !hasConflict;
  const canCommit = canWrite && model.selectedIds.length > 0 && controls.commitMessage.value.trim().length > 0;

  controls.repositorySelect.disabled = running || locallyBusy || model.repositories.length < 2;
  controls.commitMessage.disabled = !canWrite;
  controls.commitButton.disabled = !canCommit;
  controls.commitPushButton.disabled = !canCommit || model.detached;
  controls.aiGenerateButton.disabled = model.ai.kind === 'generating' ? false : !canWrite || model.selectedIds.length === 0;
  controls.aiDensityButton.disabled = !canWrite || model.selectedIds.length === 0;
  setText(controls.aiGenerateButton, model.ai.kind === 'generating'
    ? '取消 AI 生成' : `AI 生成 · ${densityLabel(activeDensity)}`);

  const feedback = operationFeedback(model.operation);
  setText(controls.operationStatus, feedback.message.length === 0 && pendingWriteRequestId !== undefined
    ? '正在处理请求…' : feedback.message);
  setText(controls.errorStatus, feedback.error);
  controls.errorStatus.hidden = feedback.error.length === 0;
  controls.retryPushButton.hidden = !feedback.retry;
  controls.retryPushButton.disabled = !feedback.retry || !canWrite;
  if (!model.trusted && feedback.error.length === 0) {
    setText(controls.errorStatus, '当前工作区未受信任，写操作已禁用。');
    controls.errorStatus.hidden = false;
  } else if (hasConflict && feedback.error.length === 0) {
    setText(controls.errorStatus, '存在冲突文件，请先解决冲突。');
    controls.errorStatus.hidden = false;
  }
}

function withModel(callback: (model: RepositoryViewModel) => void): void {
  if (currentModel !== undefined) callback(currentModel);
}

function cancelCommitMessageTimer(): void {
  if (commitMessageTimer !== undefined) {
    window.clearTimeout(commitMessageTimer);
    commitMessageTimer = undefined;
  }
}

function beginWrite(model: RepositoryViewModel): { readonly repositoryId: string; readonly version: number; readonly requestId: string } | undefined {
  if (pendingWriteRequestId !== undefined || pendingRepositoryId !== undefined
    || model.operation.kind === 'running' || model.currentRepositoryId === undefined) return undefined;
  writeRequestSequence += 1;
  pendingWriteRequestId = `write-${String(writeRequestSequence)}`;
  render(model, false);
  return { repositoryId: model.currentRepositoryId, version: model.version, requestId: pendingWriteRequestId };
}

controls.repositorySelect.addEventListener('change', () => {
  if (controls.repositorySelect.value.length === 0) return;
  pendingRepositoryId = controls.repositorySelect.value;
  writeRequestSequence += 1;
  pendingRepositoryRequestId = `switch-${String(writeRequestSequence)}`;
  cancelCommitMessageTimer();
  if (currentModel !== undefined) render(currentModel, false);
  post({ type: 'selectRepository', repositoryId: controls.repositorySelect.value, requestId: pendingRepositoryRequestId });
});

controls.commitMessage.addEventListener('input', () => {
  pendingCommitMessage = controls.commitMessage.value;
  cancelCommitMessageTimer();
  if (currentModel !== undefined) render(currentModel, false);
  const repositoryId = currentModel?.currentRepositoryId;
  if (repositoryId === undefined) return;
  commitMessageTimer = window.setTimeout(() => {
    commitMessageTimer = undefined;
    post({ type: 'setCommitMessage', repositoryId, message: controls.commitMessage.value });
  }, 150);
});

controls.commitButton.addEventListener('click', () => {
  withModel((model) => {
  const message = controls.commitMessage.value;
  if (message.trim().length === 0) return;
  const scope = beginWrite(model);
  if (scope === undefined) return;
  cancelCommitMessageTimer();
  pendingCommitMessage = message;
  post({ type: 'commit', ...scope, message });
  });
});

controls.commitPushButton.addEventListener('click', () => {
  withModel((model) => {
  const message = controls.commitMessage.value;
  if (message.trim().length === 0) return;
  const scope = beginWrite(model);
  if (scope === undefined) return;
  cancelCommitMessageTimer();
  pendingCommitMessage = message;
  post({ type: 'commitAndPush', ...scope, message });
  });
});

controls.retryPushButton.addEventListener('click', () => {
  withModel((model) => {
  const scope = beginWrite(model);
  if (scope !== undefined) post({ type: 'retryPush', ...scope });
  });
});

for (const density of ['compact', 'standard', 'detailed'] as const) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  setText(button, densityLabel(density));
  button.addEventListener('click', () => {
    activeDensity = density;
    controls.aiDensityMenu.hidden = true;
    if (currentModel?.currentRepositoryId !== undefined) {
      persistedState = { densities: { ...persistedState.densities, [currentModel.currentRepositoryId]: density } };
      vscode.setState(persistedState);
      render(currentModel, false);
    }
  });
  controls.aiDensityMenu.append(button);
}

controls.aiDensityButton.addEventListener('click', () => {
  controls.aiDensityMenu.hidden = !controls.aiDensityMenu.hidden;
});
controls.aiGenerateButton.addEventListener('click', () => {
  withModel((model) => {
  if (model.currentRepositoryId === undefined) return;
  if (model.ai.kind === 'generating') {
    post({ type: 'cancelCommitMessageGeneration', repositoryId: model.currentRepositoryId, requestId: pendingWriteRequestId ?? 'ai-current' });
    return;
  }
  const scope = beginWrite(model);
  if (scope !== undefined) post({ type: 'generateCommitMessage', ...scope, selectedIds: model.selectedIds, density: activeDensity });
  });
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== 'object' || message === null || !('type' in message)
    || message.type !== 'state' || !('model' in message)
    || typeof message.model !== 'object' || message.model === null) return;
  const stateMessage = message as StateMessage;
  if (stateMessage.acknowledgedRequestId !== undefined
    && stateMessage.acknowledgedRequestId === pendingWriteRequestId) pendingWriteRequestId = undefined;
  if (stateMessage.acknowledgedRequestId !== undefined
    && stateMessage.acknowledgedRequestId === pendingRepositoryRequestId
    && stateMessage.model.currentRepositoryId !== pendingRepositoryId) {
    pendingRepositoryId = undefined;
    pendingRepositoryRequestId = undefined;
  }
  render(stateMessage.model, true);
});

post({ type: 'ready' });
