import type { RepositoryViewModel } from '../domain/view-model.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';
import type { AiModelSelection } from '../services/ai-model-selection-store.js';
import {
  aiControlPresentation,
  commitControlState,
  densityLabel,
  operationFeedback,
} from './commit-view-state.js';
import type { WebviewMessage } from './messages.js';
import {
  beginScopedRequest,
  type PendingRequestPresentation,
} from './request-state.js';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
  readonly aiModelSelection?: AiModelSelection;
  readonly acknowledgedRequestId?: string;
}

interface PersistedState {
  readonly densities: Readonly<Record<string, CommitMessageDensity>>;
}

declare function acquireVsCodeApi(): VsCodeApi;

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) {
    throw new Error(`缺少提交信息控件：${id}`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPersistedState(value: unknown): PersistedState {
  if (!isObject(value) || !isObject(value.densities)) {
    return { densities: {} };
  }
  const densities: Record<string, CommitMessageDensity> = {};
  for (const [repositoryId, density] of Object.entries(value.densities)) {
    if (density === 'compact' || density === 'standard'
      || density === 'detailed') {
      densities[repositoryId] = density;
    }
  }
  return { densities };
}

const vscode = acquireVsCodeApi();
const layoutElement = document.querySelector<HTMLElement>('.layout');
if (layoutElement === null) {
  throw new Error('缺少提交信息主布局');
}
const layout = layoutElement;
const controls = {
  repositorySelect: element('repository-select') as HTMLSelectElement,
  repositorySummary: element('repository-summary') as HTMLParagraphElement,
  commitMessage: element('commit-message') as HTMLTextAreaElement,
  commitButton: element('commit-button') as HTMLButtonElement,
  commitPushButton: element('commit-push-button') as HTMLButtonElement,
  aiGenerateButton: element('ai-generate-button') as HTMLButtonElement,
  aiGenerateIcon: element('ai-generate-icon'),
  aiDensityButton: element('ai-density-button') as HTMLButtonElement,
  aiDensityMenu: element('ai-density-menu'),
  aiModelButton: element('ai-model-button') as HTMLButtonElement,
  loadingStatus: element('loading-status') as HTMLParagraphElement,
  operationStatus: element('operation-status') as HTMLParagraphElement,
  errorStatus: element('error-status') as HTMLParagraphElement,
  retryPushButton: element('retry-push-button') as HTMLButtonElement,
  feedback: element('operation-feedback'),
};

let currentModel: RepositoryViewModel | undefined;
let currentRepositoryId: string | undefined;
let currentAiModelSelection: AiModelSelection | undefined;
let pendingMessage: string | undefined;
let messageTimer: number | undefined;
let pendingRequestId: string | undefined;
let modelSelectionRequestId: string | undefined;
let pendingPresentation: PendingRequestPresentation | undefined;
let sequence = 0;
let density: CommitMessageDensity = 'standard';
let persisted = readPersistedState(vscode.getState());
let revealedFeedbackKey: string | undefined;

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function cancelMessageTimer(): void {
  if (messageTimer !== undefined) {
    window.clearTimeout(messageTimer);
    messageTimer = undefined;
  }
}

function updateRepository(model: RepositoryViewModel): void {
  const fragment = document.createDocumentFragment();
  for (const repository of model.repositories) {
    const option = document.createElement('option');
    option.value = repository.id;
    option.selected = repository.id === model.currentRepositoryId;
    option.textContent = repository.label;
    option.title = repository.rootPath;
    fragment.append(option);
  }
  controls.repositorySelect.replaceChildren(fragment);
  controls.repositorySelect.hidden = model.repositories.length < 2;
  const branch = model.detached ? '游离 HEAD' : (model.branch ?? '未识别分支');
  controls.repositorySummary.textContent = model.currentRepositoryId === undefined
    ? '打开一个 Git 仓库后可提交文件'
    : `${branch} · ${model.upstream === undefined ? '未设置上游' : `上游 ${model.upstream}`}`;
}

function render(model: RepositoryViewModel): void {
  currentModel = model;
  if (currentRepositoryId !== model.currentRepositoryId) {
    currentRepositoryId = model.currentRepositoryId;
    density = currentRepositoryId === undefined
      ? 'standard'
      : (persisted.densities[currentRepositoryId] ?? 'standard');
  }
  layout.setAttribute('aria-busy', model.operation.kind === 'running'
    ? 'true'
    : 'false');
  controls.loadingStatus.hidden = true;
  updateRepository(model);
  if (pendingMessage === undefined || pendingMessage === model.commitMessage) {
    controls.commitMessage.value = model.commitMessage;
    pendingMessage = undefined;
  }

  const running = model.operation.kind === 'running';
  const hasConflict = model.changes.some((change) => change.conflicted);
  const locallyBusy = pendingRequestId !== undefined
    || modelSelectionRequestId !== undefined;
  const {
    canWrite,
    canCommit,
    canCommitAndPush,
  } = commitControlState(model, {
    locallyBusy,
    message: controls.commitMessage.value,
  });
  const aiGenerating = model.ai.kind === 'generating'
    || pendingPresentation === 'ai-button';

  controls.repositorySelect.disabled = running || locallyBusy
    || model.repositories.length < 2;
  controls.commitMessage.disabled = !canWrite;
  controls.commitButton.disabled = !canCommit;
  controls.commitPushButton.disabled = !canCommitAndPush;
  controls.aiGenerateButton.disabled = aiGenerating
    ? false
    : !canWrite || model.selectedIds.length === 0;
  controls.aiDensityButton.disabled = !canWrite || model.selectedIds.length === 0;
  controls.aiModelButton.disabled = !canWrite || locallyBusy || aiGenerating;
  const aiPresentation = aiControlPresentation(density, aiGenerating);
  controls.aiGenerateIcon.dataset.density = aiPresentation.density;
  controls.aiGenerateIcon.classList.toggle(
    'is-generating',
    aiPresentation.generating,
  );
  controls.aiGenerateIcon.querySelector('.ai-density-loading')
    ?.classList.toggle(
      'codicon-modifier-spin',
      aiPresentation.generating,
    );
  controls.aiGenerateButton.setAttribute('aria-label', aiPresentation.generateLabel);
  controls.aiGenerateButton.title = aiPresentation.generateLabel;
  controls.aiDensityButton.setAttribute('aria-label', aiPresentation.densityLabel);
  controls.aiDensityButton.title = aiPresentation.densityLabel;
  const selectedModelName = modelSelectionRequestId === undefined
    ? (currentAiModelSelection?.name ?? '自动选择')
    : '正在选择';
  const modelLabel = `选择 AI 模型（${selectedModelName}）`;
  controls.aiModelButton.setAttribute('aria-label', modelLabel);
  controls.aiModelButton.title = modelLabel;

  const feedback = operationFeedback(model.operation);
  controls.operationStatus.textContent = feedback.message;
  controls.errorStatus.textContent = feedback.error;
  controls.errorStatus.hidden = feedback.error.length === 0;
  controls.retryPushButton.hidden = !feedback.retry;
  controls.retryPushButton.disabled = !feedback.retry || !canWrite;
  if (feedback.revealKey === undefined) {
    revealedFeedbackKey = undefined;
  } else if (feedback.revealKey !== revealedFeedbackKey) {
    revealedFeedbackKey = feedback.revealKey;
    window.requestAnimationFrame(() => {
      controls.feedback.scrollIntoView({ block: 'nearest' });
    });
  }
  if (!model.trusted && feedback.error.length === 0) {
    controls.errorStatus.textContent = '当前工作区未受信任，写操作已禁用。';
    controls.errorStatus.hidden = false;
  } else if (hasConflict && feedback.error.length === 0) {
    controls.errorStatus.textContent = '存在冲突文件，请先解决冲突。';
    controls.errorStatus.hidden = false;
  }
}

function beginRequest(
  model: RepositoryViewModel,
  mode: 'write' | 'ai' = 'write',
): ReturnType<typeof beginScopedRequest>['scope'] | undefined {
  if (pendingRequestId !== undefined || model.operation.kind === 'running'
    || model.currentRepositoryId === undefined) {
    return undefined;
  }
  sequence += 1;
  const request = beginScopedRequest({
    repositoryId: model.currentRepositoryId,
    version: model.version,
    sequence,
    mode,
  });
  pendingRequestId = request.pendingRequestId;
  pendingPresentation = request.pendingPresentation;
  render(model);
  return request.scope;
}

controls.repositorySelect.addEventListener('change', () => {
  if (controls.repositorySelect.value.length === 0) {
    return;
  }
  sequence += 1;
  post({
    type: 'selectRepository',
    repositoryId: controls.repositorySelect.value,
    requestId: `switch-${String(sequence)}`,
  });
});

controls.commitMessage.addEventListener('input', () => {
  pendingMessage = controls.commitMessage.value;
  cancelMessageTimer();
  if (currentModel !== undefined) {
    render(currentModel);
  }
  const repositoryId = currentModel?.currentRepositoryId;
  if (repositoryId !== undefined) {
    messageTimer = window.setTimeout(() => {
      messageTimer = undefined;
      post({
        type: 'setCommitMessage',
        repositoryId,
        message: controls.commitMessage.value,
      });
    }, 150);
  }
});

function submit(push: boolean): void {
  const model = currentModel;
  const message = controls.commitMessage.value;
  if (model === undefined || message.trim().length === 0) {
    return;
  }
  const scope = beginRequest(model);
  if (scope !== undefined) {
    cancelMessageTimer();
    pendingMessage = message;
    post({ type: push ? 'commitAndPush' : 'commit', ...scope, message });
  }
}

controls.commitButton.addEventListener('click', () => {
  submit(false);
});
controls.commitPushButton.addEventListener('click', () => {
  submit(true);
});
controls.retryPushButton.addEventListener('click', () => {
  if (currentModel === undefined) {
    return;
  }
  const scope = beginRequest(currentModel);
  if (scope !== undefined) {
    post({ type: 'retryPush', ...scope });
  }
});

for (const value of ['compact', 'standard', 'detailed'] as const) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.textContent = densityLabel(value);
  button.addEventListener('click', () => {
    density = value;
    controls.aiDensityMenu.hidden = true;
    if (currentRepositoryId !== undefined) {
      persisted = {
        densities: { ...persisted.densities, [currentRepositoryId]: value },
      };
      vscode.setState(persisted);
    }
    if (currentModel !== undefined) {
      render(currentModel);
    }
  });
  controls.aiDensityMenu.append(button);
}

controls.aiDensityButton.addEventListener('click', () => {
  controls.aiDensityMenu.hidden = !controls.aiDensityMenu.hidden;
});
controls.aiModelButton.addEventListener('click', () => {
  const model = currentModel;
  if (model?.currentRepositoryId === undefined
    || modelSelectionRequestId !== undefined) {
    return;
  }
  sequence += 1;
  modelSelectionRequestId = `ai-model-${String(sequence)}`;
  render(model);
  post({
    type: 'selectAiModel',
    repositoryId: model.currentRepositoryId,
    requestId: modelSelectionRequestId,
  });
});
controls.aiGenerateButton.addEventListener('click', () => {
  const model = currentModel;
  if (model?.currentRepositoryId === undefined) {
    return;
  }
  if (model.ai.kind === 'generating' || pendingPresentation === 'ai-button') {
    post({
      type: 'cancelCommitMessageGeneration',
      repositoryId: model.currentRepositoryId,
      requestId: pendingRequestId ?? 'ai-current',
    });
    return;
  }
  const scope = beginRequest(model, 'ai');
  if (scope !== undefined) {
    post({
      type: 'generateCommitMessage',
      ...scope,
      selectedIds: model.selectedIds,
      density,
    });
  }
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== 'object' || message === null
    || !('type' in message) || message.type !== 'state'
    || !('model' in message)) {
    return;
  }
  const state = message as StateMessage;
  currentAiModelSelection = state.aiModelSelection;
  if (state.acknowledgedRequestId === pendingRequestId) {
    pendingRequestId = undefined;
    pendingPresentation = undefined;
  }
  if (state.acknowledgedRequestId === modelSelectionRequestId) {
    modelSelectionRequestId = undefined;
  }
  render(state.model);
});

post({ type: 'ready' });
