import type { RepositoryViewModel } from '../domain/view-model.js';
import type { ChangeSectionKind } from '../domain/change-groups.js';
import type { CommitDetails } from '../domain/history-model.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';
import type { AiModelSelection } from '../services/ai-model-selection-store.js';
import { canPushAll } from '../views/push-availability-context.js';
import {
  aiControlPresentation,
  aiDensityMenuItems,
  aiModelMenuItems,
  aiSettingsPresentation,
  commitControlState,
  operationFeedback,
  type AiMenuItem,
  type AiModelInfo,
} from './commit-view-state.js';
import type { WebviewMessage } from './messages.js';
import {
  beginScopedRequest,
  type PendingRequestPresentation,
} from './request-state.js';
import { renderChangeList } from './commit-change-renderer.js';
import {
  renderHistoryGraph,
  renderHistoryList,
  type RenderedHistoryFile,
} from './history-renderer.js';
import {
  bindDockResizer,
  clampCommitDockHeight,
  defaultCommitDockHeight,
  dockResizerAriaValues,
  persistDockHeight,
  popoverBottomOffset,
  popoverHorizontalOffset,
  readPersistedDockHeight,
} from './commit-workbench-layout.js';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
  readonly aiModelSelection?: AiModelSelection;
  readonly aiModels?: readonly AiModelInfo[];
  readonly acknowledgedRequestId?: string;
  readonly fileIconClasses?: readonly (string | null)[];
}

interface CommitDetailsMessage {
  readonly type: 'commitDetails';
  readonly repositoryId: string;
  readonly version: number;
  readonly details: CommitDetails;
  readonly fileIconClasses?: readonly (string | null)[];
}

interface PersistedState {
  readonly densities: Readonly<Record<string, CommitMessageDensity>>;
  readonly dockHeight?: number;
  readonly view?: 'commit' | 'history';
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function readPersistedState(value: unknown): PersistedState {
  if (!isObject(value)) {
    return { densities: {} };
  }
  const densities: Record<string, CommitMessageDensity> = {};
  if (isObject(value.densities)) {
    for (const [repositoryId, density] of Object.entries(value.densities)) {
      if (density === 'compact' || density === 'standard'
        || density === 'detailed') {
        densities[repositoryId] = density;
      }
    }
  }
  const dockHeight = readPersistedDockHeight(value);
  const view = value.view === 'history' ? 'history' as const : undefined;
  return {
    densities,
    ...(dockHeight === undefined ? {} : { dockHeight }),
    ...(view === undefined ? {} : { view }),
  };
}

const vscode = acquireVsCodeApi();
const layoutElement = document.querySelector<HTMLElement>('.layout');
if (layoutElement === null) {
  throw new Error('缺少提交信息主布局');
}
const layout = layoutElement;
const controls = {
  repositorySelect: element('repository-select') as HTMLSelectElement,
  branchName: element('branchName'),
  upstreamText: element('upstreamText'),
  changesList: element('changeList'),
  loadingStatus: element('loading-status') as HTMLParagraphElement,
  selectedCount: element('selCount'),
  selectedTotal: element('selTotal'),
  commitMessage: element('message') as HTMLTextAreaElement,
  charCount: element('charCount'),
  commitButton: element('btnCommit') as HTMLButtonElement,
  commitPushButton: element('btnCommitPush') as HTMLButtonElement,
  aiGenerateButton: element('btnAiGen') as HTMLButtonElement,
  aiGenerateIcon: element('aiGenIcon'),
  aiSettingsButton: element('btnAiSettings') as HTMLButtonElement,
  operationStatus: element('operation-status') as HTMLParagraphElement,
  errorStatus: element('error-status') as HTMLParagraphElement,
  retryPushButton: element('retry-push-button') as HTMLButtonElement,
  feedback: element('operation-feedback'),
  refreshButton: element('btnRefresh') as HTMLButtonElement,
  refreshIcon: element('refreshIcon'),
  selectAllButton: element('btnSelectAll') as HTMLButtonElement,
  discardButton: element('btnDiscard') as HTMLButtonElement,
  discardIcon: element('discardIcon'),
  discardText: element('discardText'),
  historyButton: element('btnHistory') as HTMLButtonElement,
  pullButton: element('btnPull') as HTMLButtonElement,
  pushAllButton: element('btnPush') as HTMLButtonElement,
  commitView: element('commit-view'),
  historyView: element('history-view'),
  backButton: element('btnBack') as HTMLButtonElement,
  searchInput: element('search-input') as HTMLInputElement,
  historyBranchName: element('historyBranchName'),
  historyStatus: element('history-status') as HTMLParagraphElement,
  historyList: element('commit-list'),
  graphHost: element('graph-host'),
  toast: element('toast'),
  splitter: element('splitter'),
  dock: element('dock'),
};

let currentModel: RepositoryViewModel | undefined;
let currentRepositoryId: string | undefined;
let currentAiModelSelection: AiModelSelection | undefined;
let currentAiModels: readonly AiModelInfo[] | undefined;
let pendingMessage: string | undefined;
let messageTimer: number | undefined;
let invalidTimer: number | undefined;
let toastTimer: number | undefined;
let graphFrame = 0;
let pendingRequestId: string | undefined;
let pendingPresentation: PendingRequestPresentation | undefined;
let sequence = 0;
let density: CommitMessageDensity = 'standard';
let persisted = readPersistedState(vscode.getState());
let revealedFeedbackKey: string | undefined;
let commitFlow: 'commit' | 'commit-push' | undefined;
let currentView: 'commit' | 'history' = 'commit';
let discardArmed = false;
const expandedCommits = new Set<string>();
const commitDetailsCache = new Map<string, readonly RenderedHistoryFile[]>();
const pendingDetails = new Set<string>();
let historyScopeKey = '';
let fileIconClasses: readonly (string | null)[] = [];
const collapsedSections = new Set<ChangeSectionKind>(['untracked']);

function applyDockHeight(requestedHeight: number, persist: boolean): void {
  const height = clampCommitDockHeight(requestedHeight, window.innerHeight);
  const aria = dockResizerAriaValues(height, window.innerHeight);
  controls.dock.style.height = `${String(height)}px`;
  controls.splitter.setAttribute('aria-valuenow', String(aria.current));
  controls.splitter.setAttribute('aria-valuemin', String(aria.minimum));
  controls.splitter.setAttribute('aria-valuemax', String(aria.maximum));
  if (persist) {
    persisted = persistDockHeight(persisted, height);
    vscode.setState(persisted);
  }
}

applyDockHeight(persisted.dockHeight ?? defaultCommitDockHeight, false);

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function scheduleGraphRender(): void {
  if (currentView !== 'history') {
    return;
  }
  window.cancelAnimationFrame(graphFrame);
  graphFrame = window.requestAnimationFrame(() => {
    const model = currentModel;
    if (model === undefined) {
      return;
    }
    renderHistoryGraph(
      controls.graphHost,
      controls.historyList,
      model.history.commits,
    );
  });
}

function applyView(view: 'commit' | 'history', persist: boolean): void {
  currentView = view;
  const historyMode = view === 'history';
  controls.commitView.hidden = historyMode;
  controls.historyView.hidden = !historyMode;
  controls.historyButton.setAttribute('aria-pressed', String(historyMode));
  if (persist) {
    persisted = { ...persisted, view };
    vscode.setState(persisted);
  }
  if (historyMode) {
    scheduleGraphRender();
    if (currentModel?.history.kind === 'idle') {
      post({ type: 'refresh' });
    }
  }
}

applyView(persisted.view ?? 'commit', false);

function cancelMessageTimer(): void {
  if (messageTimer !== undefined) {
    window.clearTimeout(messageTimer);
    messageTimer = undefined;
  }
}

function branchLabel(model: RepositoryViewModel): string {
  return model.detached ? '游离 HEAD' : (model.branch ?? '未识别分支');
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
  if (model.currentRepositoryId === undefined) {
    controls.branchName.textContent = '…';
    controls.upstreamText.textContent = '打开一个 Git 仓库后可提交文件';
    controls.historyBranchName.textContent = '…';
    return;
  }
  controls.branchName.textContent = branchLabel(model);
  controls.upstreamText.textContent = model.upstream === undefined
    ? '未设置上游'
    : `上游 ${model.upstream}`;
  controls.historyBranchName.textContent = branchLabel(model);
}

function setButtonLoading(button: HTMLButtonElement, loading: boolean): void {
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function resetDiscardConfirm(): void {
  if (!discardArmed) {
    return;
  }
  discardArmed = false;
  controls.discardButton.classList.remove('confirming');
  controls.discardButton.setAttribute('aria-label', '舍弃所选更改');
  controls.discardButton.title = '舍弃所选更改';
  controls.discardIcon.hidden = false;
  controls.discardText.hidden = true;
}

function selectableChanges(
  model: RepositoryViewModel,
): RepositoryViewModel['changes'] {
  return model.changes.filter((change) => !change.conflicted);
}

function trashableFileIds(model: RepositoryViewModel): readonly string[] {
  return model.changes
    .filter((change) => change.untracked
      && model.selectedIds.includes(change.id))
    .map((change) => change.id);
}

function applyHistoryFilter(): void {
  const query = controls.searchInput.value.trim().toLowerCase();
  let shown = 0;
  for (const entry of controls.historyList
    .querySelectorAll<HTMLElement>('.commit-entry')) {
    const hit = query.length === 0
      || (entry.dataset.search ?? '').includes(query);
    entry.style.display = hit ? '' : 'none';
    if (hit) {
      shown += 1;
    }
  }
  controls.historyList.classList.toggle(
    'is-empty',
    query.length > 0 && shown === 0,
  );
}

function toggleCommitExpanded(hash: string, expanded: boolean): void {
  expandedCommits.clear();
  if (expanded) {
    expandedCommits.add(hash);
    if (!commitDetailsCache.has(hash) && !pendingDetails.has(hash)
      && currentModel?.currentRepositoryId !== undefined) {
      pendingDetails.add(hash);
      sequence += 1;
      post({
        type: 'loadCommitDetails',
        repositoryId: currentModel.currentRepositoryId,
        version: currentModel.version,
        hash,
        requestId: `details-${String(sequence)}`,
      });
    }
  }
  if (currentModel !== undefined) {
    render(currentModel);
  }
}

function openCommitDiff(hash: string, path: string): void {
  if (currentModel?.currentRepositoryId === undefined) {
    return;
  }
  sequence += 1;
  post({
    type: 'openCommitDiff',
    repositoryId: currentModel.currentRepositoryId,
    version: currentModel.version,
    hash,
    path,
    requestId: `diff-${String(sequence)}`,
  });
}

function showToast(text: string): void {
  controls.toast.textContent = text;
  controls.toast.classList.add('show');
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    controls.toast.classList.remove('show');
    toastTimer = undefined;
  }, 1600);
}

function legacyCopyText(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.append(textarea);
  textarea.select();
  try {
    // 原型要求的兜底复制路径：navigator.clipboard 不可用或被拒时使用
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy');
  } catch {
    // 兜底复制失败时仍提示，与原型行为一致
  }
  textarea.remove();
}

function copyHash(hash: string): void {
  const done = (): void => {
    showToast(`已复制 ${hash}`);
  };
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard !== undefined) {
    clipboard.writeText(hash).then(done, () => {
      legacyCopyText(hash);
      done();
    });
    return;
  }
  legacyCopyText(hash);
  done();
}

const SVG_PI_CHECK = '<svg class="pi-check" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.6l3.2 3.2L13 4.6"/></svg>';

const aiPopover = document.createElement('div');
aiPopover.className = 'popover';
aiPopover.setAttribute('role', 'menu');
aiPopover.hidden = true;
document.body.append(aiPopover);
let aiPopoverOpen = false;

function popoverItemMarkup(item: AiMenuItem): string {
  return `<button class="popover-item" type="button" role="menuitemradio" aria-checked="${String(item.checked)}" data-action="${escapeHtml(item.action)}">`
    + SVG_PI_CHECK
    + `<span class="pi-body"><span class="pi-title">${escapeHtml(item.title)}</span>`
    + (item.description === undefined
      ? ''
      : `<span class="pi-desc">${escapeHtml(item.description)}</span>`)
    + '</span></button>';
}

function renderAiPopover(): void {
  const models = aiModelMenuItems(currentAiModels, currentAiModelSelection);
  const parts = ['<div class="popover-label">AI 模型</div>'];
  parts.push(...models.items.map(popoverItemMarkup));
  if (models.modelsUnavailable) {
    parts.push('<div class="popover-item" aria-disabled="true">'
      + '<span class="pi-body"><span class="pi-title">暂无可用模型</span></span>'
      + '</div>');
  }
  parts.push('<div class="popover-label">生成详细程度</div>');
  parts.push(...aiDensityMenuItems(density).map(popoverItemMarkup));
  aiPopover.innerHTML = parts.join('');
}

function openAiPopover(): void {
  renderAiPopover();
  aiPopover.hidden = false;
  aiPopoverOpen = true;
  controls.aiSettingsButton.setAttribute('aria-expanded', 'true');
  const anchor = controls.aiSettingsButton.getBoundingClientRect();
  aiPopover.style.left = `${String(popoverHorizontalOffset(
    anchor.left,
    aiPopover.offsetWidth,
    window.innerWidth,
  ))}px`;
  aiPopover.style.bottom = `${String(popoverBottomOffset(
    anchor.top,
    window.innerHeight,
  ))}px`;
}

function closeAiPopover(): void {
  if (!aiPopoverOpen) {
    return;
  }
  aiPopover.hidden = true;
  aiPopoverOpen = false;
  controls.aiSettingsButton.setAttribute('aria-expanded', 'false');
}

function render(model: RepositoryViewModel): void {
  currentModel = model;
  const scopeKey = `${model.currentRepositoryId ?? ''}:${String(model.version)}`;
  if (scopeKey !== historyScopeKey) {
    historyScopeKey = scopeKey;
    expandedCommits.clear();
    commitDetailsCache.clear();
    pendingDetails.clear();
  }
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
  renderHistoryList(
    controls.historyList,
    controls.historyStatus,
    model.history,
    expandedCommits,
    commitDetailsCache,
    {
      toggleCommit: toggleCommitExpanded,
      openCommitDiff,
      copyHash,
    },
    Date.now(),
  );
  applyHistoryFilter();
  scheduleGraphRender();
  renderChangeList(
    controls.changesList,
    model.changes,
    new Set(model.selectedIds),
    collapsedSections,
    fileIconClasses,
    {
      toggleSection: (section) => {
        if (collapsedSections.has(section)) {
          collapsedSections.delete(section);
        } else {
          collapsedSections.add(section);
        }
        render(model);
      },
      setGroup: (group, selected) => {
        if (model.currentRepositoryId !== undefined) {
          post({
            type: 'setGroup',
            repositoryId: model.currentRepositoryId,
            group,
            selected,
          });
        }
      },
      toggleFile: (fileId, selected) => {
        if (model.currentRepositoryId !== undefined) {
          post({
            type: 'toggleFile',
            repositoryId: model.currentRepositoryId,
            fileId,
            selected,
          });
        }
      },
      openDiff: (fileId) => {
        if (model.currentRepositoryId !== undefined) {
          post({
            type: 'openDiff',
            repositoryId: model.currentRepositoryId,
            fileId,
          });
        }
      },
    },
  );
  resetDiscardConfirm();
  controls.selectedCount.textContent = String(model.selectedIds.length);
  controls.selectedTotal.textContent = ` / ${String(model.changeCount)}`;
  if (pendingMessage === undefined || pendingMessage === model.commitMessage) {
    controls.commitMessage.value = model.commitMessage;
    pendingMessage = undefined;
  }
  controls.charCount.textContent = String(controls.commitMessage.value.length);

  const running = model.operation.kind === 'running';
  const hasConflict = model.changes.some((change) => change.conflicted);
  const locallyBusy = pendingRequestId !== undefined;
  const aiGenerating = model.ai.kind === 'generating'
    || pendingPresentation === 'ai-button';
  const {
    canWrite,
    canCommit,
    canCommitAndPush,
    canGenerateCommitMessage,
    canOpenAiSettings,
  } = commitControlState(model, {
    locallyBusy,
    aiGenerating,
  });

  controls.repositorySelect.disabled = running || locallyBusy
    || model.repositories.length < 2;
  controls.commitMessage.disabled = !canWrite;
  controls.commitButton.disabled = !canCommit;
  controls.commitPushButton.disabled = !canCommitAndPush;
  controls.aiGenerateButton.disabled = aiGenerating
    ? false
    : !canGenerateCommitMessage;
  controls.aiSettingsButton.disabled = !canOpenAiSettings;
  controls.refreshButton.disabled = running || locallyBusy;
  const selectable = selectableChanges(model);
  const allSelected = selectable.length > 0
    && selectable.every((change) => model.selectedIds.includes(change.id));
  controls.selectAllButton.disabled = !canWrite || selectable.length === 0;
  const selectAllLabel = allSelected ? '清空选择' : '全选';
  controls.selectAllButton.title = selectAllLabel;
  controls.selectAllButton.setAttribute('aria-label', selectAllLabel);
  controls.discardButton.disabled = !canWrite
    || trashableFileIds(model).length === 0;
  controls.pullButton.disabled = !canWrite || model.sync.kind !== 'ready';
  controls.pushAllButton.disabled = locallyBusy || !canPushAll(model);
  const runningAction = model.operation.kind === 'running'
    ? model.operation.action
    : undefined;
  const commitInFlight = commitFlow !== undefined
    && (pendingRequestId !== undefined || runningAction !== undefined);
  setButtonLoading(
    controls.commitButton,
    commitInFlight && commitFlow === 'commit',
  );
  setButtonLoading(
    controls.commitPushButton,
    commitInFlight && commitFlow === 'commit-push',
  );
  setButtonLoading(controls.pullButton, runningAction === 'pull');
  setButtonLoading(
    controls.pushAllButton,
    runningAction === 'push' && commitFlow !== 'commit-push',
  );
  setButtonLoading(controls.discardButton, runningAction === 'trash');
  setButtonLoading(controls.refreshButton, runningAction === 'fetch');
  controls.refreshIcon.classList.toggle('spin', runningAction === 'fetch');
  const aiPresentation = aiControlPresentation(density, aiGenerating);
  setButtonLoading(controls.aiGenerateButton, aiPresentation.generating);
  controls.aiGenerateIcon.classList.toggle('spin', aiPresentation.generating);
  controls.aiGenerateButton.setAttribute('aria-label', aiPresentation.generateLabel);
  controls.aiGenerateButton.title = aiPresentation.generateLabel;
  const settingsPresentation = aiSettingsPresentation(currentAiModelSelection);
  controls.aiSettingsButton.setAttribute('aria-label', settingsPresentation.label);
  controls.aiSettingsButton.title = settingsPresentation.label;

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

controls.refreshButton.addEventListener('click', () => {
  post({ type: 'refresh' });
});

controls.historyButton.addEventListener('click', () => {
  applyView('history', true);
});
controls.backButton.addEventListener('click', () => {
  applyView('commit', true);
});

controls.searchInput.addEventListener('input', () => {
  applyHistoryFilter();
  scheduleGraphRender();
});

window.addEventListener('resize', () => {
  scheduleGraphRender();
});

function setAllGroups(selected: boolean): void {
  const repositoryId = currentModel?.currentRepositoryId;
  if (repositoryId === undefined) {
    return;
  }
  post({ type: 'setGroup', repositoryId, group: 'tracked', selected });
  post({ type: 'setGroup', repositoryId, group: 'untracked', selected });
}

controls.selectAllButton.addEventListener('click', () => {
  const model = currentModel;
  if (model === undefined) {
    return;
  }
  const selectable = selectableChanges(model);
  const allSelected = selectable.length > 0
    && selectable.every((change) => model.selectedIds.includes(change.id));
  setAllGroups(!allSelected);
});

controls.discardButton.addEventListener('click', () => {
  const model = currentModel;
  if (model === undefined) {
    return;
  }
  if (!discardArmed) {
    discardArmed = true;
    controls.discardButton.classList.add('confirming');
    controls.discardButton.setAttribute('aria-label', '取消舍弃');
    controls.discardButton.title = '取消舍弃';
    controls.discardIcon.hidden = true;
    controls.discardText.hidden = false;
    return;
  }
  resetDiscardConfirm();
  const fileIds = trashableFileIds(model);
  if (fileIds.length === 0) {
    return;
  }
  const scope = beginRequest(model);
  if (scope !== undefined) {
    post({ type: 'trash', ...scope, fileIds });
  }
});

bindDockResizer({
  resizer: controls.splitter,
  target: window,
  getDockHeight: () => controls.dock.getBoundingClientRect().height,
  getViewportHeight: () => window.innerHeight,
  getPreferredHeight: () => persisted.dockHeight,
  applyHeight: applyDockHeight,
});

function postVersionAction(
  type: 'pull' | 'pushAll',
): void {
  const model = currentModel;
  if (model === undefined) {
    return;
  }
  const scope = beginRequest(model);
  if (scope !== undefined) {
    post({ type, ...scope });
  }
}

controls.pullButton.addEventListener('click', () => {
  postVersionAction('pull');
});
controls.pushAllButton.addEventListener('click', () => {
  postVersionAction('pushAll');
});

function syncMessageInput(): void {
  pendingMessage = controls.commitMessage.value;
  controls.charCount.textContent = String(controls.commitMessage.value.length);
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
}

controls.commitMessage.addEventListener('input', () => {
  syncMessageInput();
});

controls.commitMessage.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Tab') {
    return;
  }
  event.preventDefault();
  const textarea = controls.commitMessage;
  const start = textarea.selectionStart;
  textarea.value = textarea.value.slice(0, start)
    + '  '
    + textarea.value.slice(textarea.selectionEnd);
  textarea.selectionStart = start + 2;
  textarea.selectionEnd = start + 2;
  syncMessageInput();
});

function submit(push: boolean): void {
  const model = currentModel;
  if (model === undefined) {
    return;
  }
  const message = controls.commitMessage.value;
  if (message.trim().length === 0) {
    const button = push ? controls.commitPushButton : controls.commitButton;
    button.classList.remove('shake');
    void button.offsetWidth;
    button.classList.add('shake');
    controls.commitMessage.classList.add('invalid');
    if (invalidTimer !== undefined) {
      window.clearTimeout(invalidTimer);
    }
    invalidTimer = window.setTimeout(() => {
      controls.commitMessage.classList.remove('invalid');
      invalidTimer = undefined;
    }, 1400);
    controls.commitMessage.focus();
    return;
  }
  const scope = beginRequest(model);
  if (scope !== undefined) {
    cancelMessageTimer();
    pendingMessage = message;
    commitFlow = push ? 'commit-push' : 'commit';
    render(model);
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

controls.aiSettingsButton.addEventListener('click', () => {
  if (aiPopoverOpen) {
    closeAiPopover();
  } else {
    openAiPopover();
  }
});

document.addEventListener('pointerdown', (event: PointerEvent) => {
  if (!aiPopoverOpen || !(event.target instanceof Element)) {
    return;
  }
  if (event.target.closest('.popover') !== null
    || event.target.closest('#btnAiSettings') !== null) {
    return;
  }
  closeAiPopover();
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeAiPopover();
  }
});

aiPopover.addEventListener('click', (event: MouseEvent) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const item = event.target.closest('.popover-item');
  if (!(item instanceof HTMLElement)) {
    return;
  }
  const action = item.dataset.action;
  if (action === undefined) {
    return;
  }
  const separator = action.indexOf(':');
  const kind = action.slice(0, separator);
  const value = action.slice(separator + 1);
  if (kind === 'density'
    && (value === 'compact' || value === 'standard' || value === 'detailed')) {
    density = value;
    if (currentRepositoryId !== undefined) {
      persisted = {
        ...persisted,
        densities: { ...persisted.densities, [currentRepositoryId]: value },
      };
      vscode.setState(persisted);
    }
  } else if (kind === 'model' && currentRepositoryId !== undefined) {
    post({
      type: 'setAiModel',
      repositoryId: currentRepositoryId,
      modelId: value,
    });
  } else {
    return;
  }
  closeAiPopover();
  if (currentModel !== undefined) {
    render(currentModel);
  }
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
  if (typeof message !== 'object' || message === null || !('type' in message)) {
    return;
  }
  if (message.type === 'commitDetails' && 'details' in message) {
    const detailsMessage = message as CommitDetailsMessage;
    if (currentModel === undefined) {
      return;
    }
    if (detailsMessage.repositoryId !== currentModel.currentRepositoryId
      || detailsMessage.version !== currentModel.version) {
      return;
    }
    const icons = detailsMessage.fileIconClasses ?? [];
    commitDetailsCache.set(
      detailsMessage.details.hash,
      detailsMessage.details.files.map((file, index) => ({
        file,
        iconClass: icons[index] ?? null,
      })),
    );
    pendingDetails.delete(detailsMessage.details.hash);
    render(currentModel);
    return;
  }
  if (message.type !== 'state' || !('model' in message)) {
    return;
  }
  const state = message as StateMessage;
  fileIconClasses = state.fileIconClasses ?? [];
  currentAiModelSelection = state.aiModelSelection;
  if (state.aiModels !== undefined) {
    currentAiModels = state.aiModels;
  }
  if (state.acknowledgedRequestId === pendingRequestId) {
    pendingRequestId = undefined;
    pendingPresentation = undefined;
    commitFlow = undefined;
  }
  render(state.model);
  if (aiPopoverOpen) {
    renderAiPopover();
  }
});

post({ type: 'ready' });
