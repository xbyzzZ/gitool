import type { FileChange } from '../domain/change-model.js';
import { groupChanges, type ChangeDirectoryGroup } from '../domain/change-groups.js';
import type { CommitDetails } from '../domain/history-model.js';
import type {
  OperationState,
  RepositoryViewModel,
} from '../domain/view-model.js';
import type { WebviewMessage } from './messages.js';
import { resolveFileIcon } from './file-icons.js';
import { renderHistory } from './history-renderer.js';
import {
  defaultLayoutState,
  normalizeLayoutState,
  resetLayout,
  resizeLayout,
  togglePane,
  type PaneName,
  type ResizeHandle,
  type WorkbenchLayoutState,
} from './layout-state.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';
import { beginScopedRequest } from './request-state.js';

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

interface CommitDetailsMessage {
  readonly type: 'commitDetails';
  readonly repositoryId: string;
  readonly version: number;
  readonly details: CommitDetails;
}

interface PersistedClientState {
  readonly layouts: Readonly<Record<string, WorkbenchLayoutState>>;
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

function classElement(selector: string): HTMLElement {
  const value = document.querySelector<HTMLElement>(selector);
  if (value === null) {
    throw new Error(`缺少 Webview 控件：${selector}`);
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
  repositorySummary: element('repository-summary') as HTMLParagraphElement,
  editRemoteButton: element('edit-remote-button') as HTMLButtonElement,
  selectionSummary: element('selection-summary'),
  refreshButton: element('refresh-button') as HTMLButtonElement,
  trackedToggle: element('tracked-group-toggle') as HTMLInputElement,
  trackedCount: element('tracked-count'),
  trackedGroup: element('tracked-group') as HTMLDivElement,
  untrackedToggle: element('untracked-group-toggle') as HTMLInputElement,
  untrackedCount: element('untracked-count'),
  untrackedGroup: element('untracked-group') as HTMLDivElement,
  conflictedSection: element('conflicted-section'),
  conflictedCount: element('conflicted-count'),
  conflictedGroup: element('conflicted-group') as HTMLDivElement,
  trashButton: element('trash-button') as HTMLButtonElement,
  loadingStatus: element('loading-status') as HTMLParagraphElement,
  operationStatus: element('operation-status') as HTMLParagraphElement,
  errorStatus: element('error-status') as HTMLParagraphElement,
  retryPushButton: element('retry-push-button') as HTMLButtonElement,
  commitMessage: element('commit-message') as HTMLTextAreaElement,
  commitButton: element('commit-button') as HTMLButtonElement,
  commitPushButton: element('commit-push-button') as HTMLButtonElement,
  aiGenerateButton: element('ai-generate-button') as HTMLButtonElement,
  aiDensityButton: element('ai-density-button') as HTMLButtonElement,
  aiDensityMenu: element('ai-density-menu'),
  pullButton: element('pull-button') as HTMLButtonElement,
  pushAllButton: element('push-all-button') as HTMLButtonElement,
  fetchHistoryButton: element('fetch-history-button') as HTMLButtonElement,
  refreshHistoryButton: element('refresh-history-button') as HTMLButtonElement,
  syncSummary: element('sync-summary'),
  historyStatus: element('history-status'),
  historyList: element('history-list'),
  commitPane: classElement('.commit-panel'),
  changesPane: classElement('.changes-panel'),
  historyPane: classElement('.history-panel'),
  collapseCommitButton: element('collapse-commit-button') as HTMLButtonElement,
  collapseChangesButton: element('collapse-changes-button') as HTMLButtonElement,
  collapseHistoryButton: element('collapse-history-button') as HTMLButtonElement,
  commitChangesResizer: element('commit-changes-resizer'),
  changesHistoryResizer: element('changes-history-resizer'),
};

let currentModel: RepositoryViewModel | undefined;
let commitMessageTimer: number | undefined;
let pendingCommitMessage: string | undefined;
let pendingWriteRequestId: string | undefined;
let pendingRepositoryId: string | undefined;
let pendingRepositoryRequestId: string | undefined;
let writeRequestSequence = 0;
let persistedState = readPersistedState(vscode.getState());
let activeLayout = defaultLayoutState;
let activeDensity: CommitMessageDensity = 'standard';
let activeRepositoryForLayout: string | undefined;
const collapsedDirectories = new Set<string>();
const expandedCommits = new Set<string>();
const commitDetails = new Map<string, readonly CommitDetails['files'][number][]>();

const changeLabels: Readonly<Record<FileChange['kind'], string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  'type-changed': 'T',
  conflicted: '!',
  untracked: '?',
};

const actionLabels: Readonly<Record<
  Extract<OperationState, { readonly kind: 'running' }>['action'],
  string
>> = {
  commit: '正在提交所选文件…',
  push: '正在推送提交…',
  trash: '正在移入废纸篓…',
  remote: '正在修改远程 URL…',
  fetch: '正在刷新远程状态…',
  pull: '正在从远程拉取…',
};

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
  if (!isObject(value) || !isObject(value.layouts)
    || !isObject(value.densities)) {
    return { layouts: {}, densities: {} };
  }
  const densities: Record<string, CommitMessageDensity> = {};
  for (const [repositoryId, density] of Object.entries(value.densities)) {
    if (density === 'compact' || density === 'standard'
      || density === 'detailed') {
      densities[repositoryId] = density;
    }
  }
  return {
    layouts: value.layouts as Readonly<Record<string, WorkbenchLayoutState>>,
    densities,
  };
}

function saveClientState(): void {
  vscode.setState(persistedState);
}

function densityLabel(density: CommitMessageDensity): string {
  const labels: Readonly<Record<CommitMessageDensity, string>> = {
    compact: '精简',
    standard: '标准',
    detailed: '详细',
  };
  return labels[density];
}

function selectedSet(model: RepositoryViewModel): ReadonlySet<string> {
  return new Set(model.selectedIds);
}

function layerLabel(change: FileChange): string {
  if (change.untracked) {
    return '未跟踪';
  }
  if (change.staged && change.unstaged) {
    return '已暂存 + 未暂存';
  }
  if (change.staged) {
    return '已暂存';
  }
  return '未暂存';
}

function renderFile(
  change: FileChange,
  repositoryId: string,
  selected: boolean,
  selectionDisabled: boolean,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.setAttribute('role', 'listitem');

  const checkbox = document.createElement('input');
  checkbox.className = 'file-check';
  checkbox.type = 'checkbox';
  checkbox.checked = selected;
  checkbox.disabled = selectionDisabled || change.conflicted;
  checkbox.setAttribute(
    'aria-label',
    `${selected ? '取消选择' : '选择'} ${change.path}`,
  );
  checkbox.addEventListener('change', () => {
    post({
      type: 'toggleFile',
      repositoryId,
      fileId: change.id,
      selected: checkbox.checked,
    });
  });

  const status = document.createElement('span');
  status.className = `file-status${change.untracked ? ' untracked' : ''}`
    + (change.conflicted ? ' conflicted' : '');
  status.setAttribute('aria-hidden', 'true');
  setText(status, changeLabels[change.kind]);

  const iconPresentation = resolveFileIcon(change.path);
  const icon = document.createElement('span');
  icon.className = `file-icon ${iconPresentation.color}`;
  icon.setAttribute('aria-hidden', 'true');
  setText(icon, iconPresentation.glyph);

  const path = document.createElement('button');
  path.className = 'file-path';
  path.type = 'button';
  path.title = change.originalPath === undefined
    ? change.path
    : `${change.originalPath} → ${change.path}`;
  path.setAttribute('aria-label', `打开 ${path.title} 的变更`);
  setText(path, change.path.split('/').at(-1) ?? change.path);
  path.addEventListener('click', () => {
    post({ type: 'openDiff', repositoryId, fileId: change.id });
  });

  const layer = document.createElement('span');
  layer.className = 'layer-badge';
  setText(layer, layerLabel(change));

  row.append(checkbox, icon, path, layer, status);
  return row;
}

function renderDirectoryGroups(
  container: HTMLElement,
  directories: readonly ChangeDirectoryGroup[],
  repositoryId: string | undefined,
  selected: ReadonlySet<string>,
  selectionDisabled: boolean,
): void {
  const fragment = document.createDocumentFragment();
  if (repositoryId === undefined) {
    container.replaceChildren(fragment);
    return;
  }
  for (const directory of directories) {
    const key = `${repositoryId}:${container.id}:${directory.path}`;
    const group = document.createElement('div');
    group.className = 'directory-group';
    const directoryButton = document.createElement('button');
    directoryButton.type = 'button';
    directoryButton.className = 'directory-heading';
    directoryButton.setAttribute('aria-expanded', String(
      !collapsedDirectories.has(key),
    ));
    setText(
      directoryButton,
      `${collapsedDirectories.has(key) ? '›' : '⌄'} ${directory.path === '.' ? '根目录' : directory.path}`,
    );
    directoryButton.addEventListener('click', () => {
      if (collapsedDirectories.has(key)) {
        collapsedDirectories.delete(key);
      } else {
        collapsedDirectories.add(key);
      }
      if (currentModel !== undefined) {
        render(currentModel, false);
      }
    });
    group.append(directoryButton);
    if (!collapsedDirectories.has(key)) {
      for (const change of directory.files) {
        group.append(renderFile(
          change,
          repositoryId,
          selected.has(change.id),
          selectionDisabled,
        ));
      }
    }
    fragment.append(group);
  }
  container.replaceChildren(fragment);
}

function updateGroupToggle(
  toggle: HTMLInputElement,
  changes: readonly FileChange[],
  selected: ReadonlySet<string>,
  disabled: boolean,
): void {
  const selectedCount = changes.filter((change) => selected.has(change.id))
    .length;
  toggle.checked = changes.length > 0 && selectedCount === changes.length;
  toggle.indeterminate = selectedCount > 0 && selectedCount < changes.length;
  toggle.disabled = disabled || changes.length === 0;
}

function operationFeedback(operation: OperationState): {
  readonly message: string;
  readonly error: string;
  readonly retry: boolean;
} {
  switch (operation.kind) {
    case 'idle':
      return { message: '', error: '', retry: false };
    case 'running':
      return {
        message: actionLabels[operation.action],
        error: '',
        retry: false,
      };
    case 'commit-succeeded':
      return {
        message: `提交已完成：${operation.commitHash}`,
        error: '',
        retry: false,
      };
    case 'push-failed':
      return {
        message: `提交已创建：${operation.commitHash}`,
        error: operation.message,
        retry: true,
      };
    case 'failed':
      return {
        message: '',
        error: operation.message,
        retry: false,
      };
  }
}

function persistLayout(repositoryId: string): void {
  persistedState = {
    ...persistedState,
    layouts: {
      ...persistedState.layouts,
      [repositoryId]: activeLayout,
    },
  };
  saveClientState();
}

function applyLayout(): void {
  const panes: Readonly<Record<PaneName, HTMLElement>> = {
    commit: controls.commitPane,
    changes: controls.changesPane,
    history: controls.historyPane,
  };
  const collapseButtons: Readonly<Record<PaneName, HTMLButtonElement>> = {
    commit: controls.collapseCommitButton,
    changes: controls.collapseChangesButton,
    history: controls.collapseHistoryButton,
  };
  for (const pane of ['commit', 'changes', 'history'] as const) {
    const collapsed = activeLayout.collapsed[pane];
    panes[pane].classList.toggle('collapsed', collapsed);
    panes[pane].style.height = collapsed
      ? '34px'
      : `${String(activeLayout.heights[pane])}px`;
    collapseButtons[pane].classList.toggle('is-collapsed', collapsed);
    collapseButtons[pane].setAttribute(
      'aria-label',
      `${collapsed ? '展开' : '折叠'}${pane === 'commit' ? '提交信息' : pane === 'changes' ? '当前变更' : '提交历史'}`,
    );
  }
}

function activateRepositoryLayout(repositoryId: string | undefined): void {
  if (activeRepositoryForLayout === repositoryId) {
    return;
  }
  activeRepositoryForLayout = repositoryId;
  expandedCommits.clear();
  commitDetails.clear();
  const stored = repositoryId === undefined
    ? undefined
    : persistedState.layouts[repositoryId];
  activeLayout = normalizeLayoutState(
    stored ?? defaultLayoutState,
    window.innerHeight - 8,
  );
  activeDensity = repositoryId === undefined
    ? 'standard'
    : (persistedState.densities[repositoryId] ?? 'standard');
  applyLayout();
}

function updateSync(model: RepositoryViewModel): void {
  switch (model.sync.kind) {
    case 'detached':
      setText(controls.syncSummary, '游离 HEAD');
      break;
    case 'no-upstream':
      setText(controls.syncSummary, '未设置上游');
      break;
    case 'ready':
      setText(
        controls.syncSummary,
        `${model.sync.upstream} · ↑${String(model.sync.ahead)} ↓${String(model.sync.behind)}`,
      );
      break;
  }
  const historyMessage = model.history.kind === 'loading'
    ? '正在读取提交历史…'
    : model.history.kind === 'failed'
      ? model.history.message
      : model.history.commits.length === 0
        ? '暂无提交记录'
        : '';
  setText(controls.historyStatus, historyMessage);
  controls.historyStatus.classList.toggle(
    'error-status',
    model.history.kind === 'failed',
  );
  renderHistory(
    controls.historyList,
    model.history.commits,
    expandedCommits,
    commitDetails,
    {
      toggleCommit: (hash, expanded) => {
        if (expanded) {
          expandedCommits.add(hash);
          if (!commitDetails.has(hash)
            && model.currentRepositoryId !== undefined) {
            writeRequestSequence += 1;
            post({
              type: 'loadCommitDetails',
              repositoryId: model.currentRepositoryId,
              version: model.version,
              hash,
              requestId: `details-${String(writeRequestSequence)}`,
            });
          }
        } else {
          expandedCommits.delete(hash);
        }
        render(model, false);
      },
      openCommitDiff: (hash, path) => {
        if (model.currentRepositoryId === undefined) {
          return;
        }
        writeRequestSequence += 1;
        post({
          type: 'openCommitDiff',
          repositoryId: model.currentRepositoryId,
          version: model.version,
          hash,
          path,
          requestId: `history-diff-${String(writeRequestSequence)}`,
        });
      },
    },
  );
}

function updateRepository(model: RepositoryViewModel): void {
  const select = controls.repositorySelect;
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
      option.selected = repository.id
        === (pendingRepositoryId ?? model.currentRepositoryId);
      option.title = repository.rootPath;
      setText(option, repository.label);
      options.append(option);
    }
  }
  select.replaceChildren(options);
  select.hidden = model.repositories.length < 2;

  const branch = model.detached
    ? '游离 HEAD'
    : (model.branch ?? '未识别分支');
  const upstream = model.upstream === undefined
    ? '未设置上游'
    : `上游 ${model.upstream}`;
  setText(
    controls.repositorySummary,
    model.currentRepositoryId === undefined
      ? '打开一个 Git 仓库后可选择并提交文件'
      : `${branch} · ${upstream}`,
  );
}

function render(
  model: RepositoryViewModel,
  acknowledgeHostState: boolean,
): void {
  if (acknowledgeHostState) {
    if (model.currentRepositoryId === pendingRepositoryId) {
      pendingRepositoryId = undefined;
      pendingRepositoryRequestId = undefined;
    }
  }
  currentModel = model;
  activateRepositoryLayout(model.currentRepositoryId);
  layout.setAttribute('aria-busy', model.operation.kind === 'running'
    ? 'true'
    : 'false');
  controls.loadingStatus.hidden = true;

  updateRepository(model);
  const selected = selectedSet(model);
  const sections = groupChanges(model.changes);
  const trackedSection = sections.find((section) => section.kind === 'tracked');
  const untrackedSection = sections.find((section) => section.kind === 'untracked');
  const conflictedSection = sections.find((section) => section.kind === 'conflicted');
  const tracked = trackedSection?.directories.flatMap((group) => group.files) ?? [];
  const untracked = untrackedSection?.directories.flatMap((group) => group.files) ?? [];
  const conflicted = conflictedSection?.directories.flatMap((group) => group.files) ?? [];
  const running = model.operation.kind === 'running';
  const noRepository = model.currentRepositoryId === undefined;
  const waitingForRepository = pendingRepositoryId !== undefined;
  const locallyBusy = pendingWriteRequestId !== undefined
    || waitingForRepository;
  const selectionDisabled = running || locallyBusy || noRepository;

  setText(
    controls.selectionSummary,
    `已选择 ${String(selected.size)} / ${String(model.changes.length)} 个文件`,
  );
  setText(controls.trackedCount, String(tracked.length));
  setText(controls.untrackedCount, String(untracked.length));
  setText(controls.conflictedCount, String(conflicted.length));
  controls.conflictedSection.hidden = conflicted.length === 0;
  renderDirectoryGroups(
    controls.trackedGroup,
    trackedSection?.directories ?? [],
    model.currentRepositoryId,
    selected,
    selectionDisabled,
  );
  renderDirectoryGroups(
    controls.untrackedGroup,
    untrackedSection?.directories ?? [],
    model.currentRepositoryId,
    selected,
    selectionDisabled,
  );
  renderDirectoryGroups(
    controls.conflictedGroup,
    conflictedSection?.directories ?? [],
    model.currentRepositoryId,
    selected,
    true,
  );
  updateGroupToggle(
    controls.trackedToggle,
    tracked,
    selected,
    selectionDisabled,
  );
  updateGroupToggle(
    controls.untrackedToggle,
    untracked,
    selected,
    selectionDisabled,
  );

  if (
    pendingCommitMessage === undefined
    || pendingCommitMessage === model.commitMessage
  ) {
    controls.commitMessage.value = model.commitMessage;
    pendingCommitMessage = undefined;
  }

  const hasConflict = model.changes.some((change) => change.conflicted);
  const selectedUntracked = untracked.filter((change) => selected.has(
    change.id,
  ));
  const canWrite = model.trusted
    && !noRepository
    && !running
    && !locallyBusy
    && !hasConflict;
  const canCommit = canWrite
    && selected.size > 0
    && controls.commitMessage.value.trim().length > 0;

  controls.repositorySelect.disabled = running
    || locallyBusy
    || model.repositories.length < 2;
  controls.refreshButton.disabled = running || locallyBusy;
  controls.editRemoteButton.disabled = !canWrite;
  controls.trashButton.disabled = !canWrite || selectedUntracked.length === 0;
  controls.commitMessage.disabled = !canWrite;
  controls.commitButton.disabled = !canCommit;
  controls.commitPushButton.disabled = !canCommit || model.detached;
  controls.aiGenerateButton.disabled = model.ai.kind === 'generating'
    ? false
    : !canWrite || selected.size === 0;
  controls.aiDensityButton.disabled = !canWrite || selected.size === 0;
  controls.pullButton.disabled = !canWrite || model.sync.kind !== 'ready';
  controls.pushAllButton.disabled = !canWrite
    || model.sync.kind === 'detached'
    || (model.sync.kind === 'ready' && model.sync.ahead === 0);
  controls.fetchHistoryButton.disabled = !canWrite;
  controls.refreshHistoryButton.disabled = running || noRepository;
  setText(
    controls.aiGenerateButton,
    model.ai.kind === 'generating'
      ? '取消 AI 生成'
      : `AI 生成 · ${densityLabel(activeDensity)}`,
  );
  updateSync(model);

  const feedback = operationFeedback(model.operation);
  setText(
    controls.operationStatus,
    feedback.message.length === 0 && pendingWriteRequestId !== undefined
      ? '正在处理请求…'
      : feedback.message,
  );
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
  if (currentModel !== undefined) {
    callback(currentModel);
  }
}

function cancelCommitMessageTimer(): void {
  if (commitMessageTimer !== undefined) {
    window.clearTimeout(commitMessageTimer);
    commitMessageTimer = undefined;
  }
}

function beginWrite(
  model: RepositoryViewModel,
): {
  readonly repositoryId: string;
  readonly version: number;
  readonly requestId: string;
} | undefined {
  if (
    pendingWriteRequestId !== undefined
    || pendingRepositoryId !== undefined
    || model.operation.kind === 'running'
    || model.currentRepositoryId === undefined
  ) {
    return undefined;
  }
  writeRequestSequence += 1;
  const request = beginScopedRequest({
    repositoryId: model.currentRepositoryId,
    version: model.version,
    sequence: writeRequestSequence,
    mode: 'write',
  });
  pendingWriteRequestId = request.pendingRequestId;
  render(model, false);
  return request.scope;
}

function beginHostPrompt(
  model: RepositoryViewModel,
): {
  readonly repositoryId: string;
  readonly version: number;
  readonly requestId: string;
} | undefined {
  if (
    pendingWriteRequestId !== undefined
    || pendingRepositoryId !== undefined
    || model.operation.kind === 'running'
    || model.currentRepositoryId === undefined
  ) {
    return undefined;
  }
  writeRequestSequence += 1;
  return beginScopedRequest({
    repositoryId: model.currentRepositoryId,
    version: model.version,
    sequence: writeRequestSequence,
    mode: 'host-prompt',
  }).scope;
}

controls.repositorySelect.addEventListener('change', () => {
  if (controls.repositorySelect.value.length > 0) {
    pendingRepositoryId = controls.repositorySelect.value;
    writeRequestSequence += 1;
    pendingRepositoryRequestId = `switch-${String(writeRequestSequence)}`;
    cancelCommitMessageTimer();
    if (currentModel !== undefined) {
      render(currentModel, false);
    }
    post({
      type: 'selectRepository',
      repositoryId: controls.repositorySelect.value,
      requestId: pendingRepositoryRequestId,
    });
  }
});
controls.refreshButton.addEventListener('click', () => {
  post({ type: 'refresh' });
});
controls.refreshHistoryButton.addEventListener('click', () => {
  withModel((model) => {
    if (model.currentRepositoryId === undefined) {
      return;
    }
    writeRequestSequence += 1;
    post({
      type: 'refreshHistory',
      repositoryId: model.currentRepositoryId,
      version: model.version,
      requestId: `history-${String(writeRequestSequence)}`,
    });
  });
});
controls.fetchHistoryButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginWrite(model);
    if (scope !== undefined) {
      post({ type: 'fetchHistory', ...scope });
    }
  });
});
controls.pullButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginWrite(model);
    if (scope !== undefined) {
      post({ type: 'pull', ...scope });
    }
  });
});
controls.pushAllButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginWrite(model);
    if (scope !== undefined) {
      post({ type: 'pushAll', ...scope });
    }
  });
});
controls.editRemoteButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginHostPrompt(model);
    if (scope !== undefined) {
      post({ type: 'editRemoteUrl', ...scope });
    }
  });
});
controls.trackedToggle.addEventListener('change', () => {
  withModel((model) => {
    if (model.currentRepositoryId !== undefined) {
      post({
        type: 'setGroup',
        repositoryId: model.currentRepositoryId,
        group: 'tracked',
        selected: controls.trackedToggle.checked,
      });
    }
  });
});
controls.untrackedToggle.addEventListener('change', () => {
  withModel((model) => {
    if (model.currentRepositoryId !== undefined) {
      post({
        type: 'setGroup',
        repositoryId: model.currentRepositoryId,
        group: 'untracked',
        selected: controls.untrackedToggle.checked,
      });
    }
  });
});
controls.trashButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginWrite(model);
    if (scope === undefined) {
      return;
    }
    const selected = selectedSet(model);
    const fileIds = model.changes
      .filter((change) => change.untracked && selected.has(change.id))
      .map((change) => change.id);
    if (fileIds.length > 0) {
      post({ type: 'trash', ...scope, fileIds });
    } else {
      pendingWriteRequestId = undefined;
      render(model, false);
    }
  });
});
controls.commitMessage.addEventListener('input', () => {
  pendingCommitMessage = controls.commitMessage.value;
  cancelCommitMessageTimer();
  if (currentModel !== undefined) {
    render(currentModel, false);
  }
  const repositoryId = currentModel?.currentRepositoryId;
  if (repositoryId === undefined) {
    return;
  }
  commitMessageTimer = window.setTimeout(() => {
    commitMessageTimer = undefined;
    post({
      type: 'setCommitMessage',
      repositoryId,
      message: controls.commitMessage.value,
    });
  }, 150);
});
controls.commitButton.addEventListener('click', () => {
  withModel((model) => {
    const message = controls.commitMessage.value;
    if (message.trim().length === 0) {
      return;
    }
    const scope = beginWrite(model);
    if (scope === undefined) {
      return;
    }
    cancelCommitMessageTimer();
    pendingCommitMessage = message;
    post({ type: 'commit', ...scope, message });
  });
});
controls.commitPushButton.addEventListener('click', () => {
  withModel((model) => {
    const message = controls.commitMessage.value;
    if (message.trim().length === 0) {
      return;
    }
    const scope = beginWrite(model);
    if (scope === undefined) {
      return;
    }
    cancelCommitMessageTimer();
    pendingCommitMessage = message;
    post({ type: 'commitAndPush', ...scope, message });
  });
});
controls.retryPushButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginWrite(model);
    if (scope !== undefined) {
      post({ type: 'retryPush', ...scope });
    }
  });
});

for (const density of ['compact', 'standard', 'detailed'] as const) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.dataset.density = density;
  setText(button, densityLabel(density));
  button.addEventListener('click', () => {
    activeDensity = density;
    controls.aiDensityMenu.hidden = true;
    if (activeRepositoryForLayout !== undefined) {
      persistedState = {
        ...persistedState,
        densities: {
          ...persistedState.densities,
          [activeRepositoryForLayout]: density,
        },
      };
      saveClientState();
    }
    if (currentModel !== undefined) {
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
    if (model.currentRepositoryId === undefined) {
      return;
    }
    if (model.ai.kind === 'generating') {
      post({
        type: 'cancelCommitMessageGeneration',
        repositoryId: model.currentRepositoryId,
        requestId: pendingWriteRequestId ?? 'ai-current',
      });
      return;
    }
    const scope = beginWrite(model);
    if (scope !== undefined) {
      post({
        type: 'generateCommitMessage',
        ...scope,
        selectedIds: model.selectedIds,
        density: activeDensity,
      });
    }
  });
});

function installCollapse(button: HTMLButtonElement, pane: PaneName): void {
  button.addEventListener('click', () => {
    activeLayout = togglePane(activeLayout, pane);
    applyLayout();
    if (activeRepositoryForLayout !== undefined) {
      persistLayout(activeRepositoryForLayout);
    }
  });
}

installCollapse(controls.collapseCommitButton, 'commit');
installCollapse(controls.collapseChangesButton, 'changes');
installCollapse(controls.collapseHistoryButton, 'history');

function installResizer(elementValue: HTMLElement, handle: ResizeHandle): void {
  let lastY: number | undefined;
  elementValue.addEventListener('pointerdown', (event) => {
    lastY = event.clientY;
    elementValue.setPointerCapture(event.pointerId);
    elementValue.classList.add('dragging');
  });
  elementValue.addEventListener('pointermove', (event) => {
    if (lastY === undefined) {
      return;
    }
    const delta = event.clientY - lastY;
    lastY = event.clientY;
    activeLayout = resizeLayout(
      activeLayout,
      handle,
      delta,
      window.innerHeight - 8,
    );
    applyLayout();
  });
  const finish = (): void => {
    if (lastY === undefined) {
      return;
    }
    lastY = undefined;
    elementValue.classList.remove('dragging');
    if (activeRepositoryForLayout !== undefined) {
      persistLayout(activeRepositoryForLayout);
    }
  };
  elementValue.addEventListener('pointerup', finish);
  elementValue.addEventListener('pointercancel', finish);
  elementValue.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    activeLayout = resizeLayout(
      activeLayout,
      handle,
      event.key === 'ArrowUp' ? -8 : 8,
      window.innerHeight - 8,
    );
    applyLayout();
    if (activeRepositoryForLayout !== undefined) {
      persistLayout(activeRepositoryForLayout);
    }
  });
  elementValue.addEventListener('dblclick', () => {
    activeLayout = resetLayout(activeLayout, window.innerHeight - 8);
    applyLayout();
    if (activeRepositoryForLayout !== undefined) {
      persistLayout(activeRepositoryForLayout);
    }
  });
}

installResizer(controls.commitChangesResizer, 'commit-changes');
installResizer(controls.changesHistoryResizer, 'changes-history');
window.addEventListener('resize', () => {
  activeLayout = normalizeLayoutState(activeLayout, window.innerHeight - 8);
  applyLayout();
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (
    typeof message === 'object'
    && message !== null
    && 'type' in message
    && message.type === 'commitDetails'
  ) {
    const detailsMessage = message as CommitDetailsMessage;
    if (currentModel?.currentRepositoryId === detailsMessage.repositoryId
      && currentModel.version === detailsMessage.version) {
      commitDetails.set(
        detailsMessage.details.hash,
        detailsMessage.details.files,
      );
      render(currentModel, false);
    }
    return;
  }
  if (
    typeof message === 'object'
    && message !== null
    && 'type' in message
    && message.type === 'state'
    && 'model' in message
    && typeof message.model === 'object'
    && message.model !== null
  ) {
    const stateMessage = message as StateMessage;
    if (
      stateMessage.acknowledgedRequestId !== undefined
      && stateMessage.acknowledgedRequestId === pendingWriteRequestId
    ) {
      pendingWriteRequestId = undefined;
    }
    if (
      stateMessage.acknowledgedRequestId !== undefined
      && stateMessage.acknowledgedRequestId === pendingRepositoryRequestId
      && stateMessage.model.currentRepositoryId !== pendingRepositoryId
    ) {
      pendingRepositoryId = undefined;
      pendingRepositoryRequestId = undefined;
    }
    render(stateMessage.model, true);
  }
});

post({ type: 'ready' });
