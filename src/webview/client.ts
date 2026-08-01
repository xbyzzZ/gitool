import type { FileChange } from '../domain/change-model.js';
import type {
  OperationState,
  RepositoryViewModel,
} from '../domain/view-model.js';
import type { WebviewMessage } from './messages.js';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

interface StateMessage {
  readonly type: 'state';
  readonly model: RepositoryViewModel;
  readonly acknowledgedRequestId?: string;
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
  trashButton: element('trash-button') as HTMLButtonElement,
  loadingStatus: element('loading-status') as HTMLParagraphElement,
  operationStatus: element('operation-status') as HTMLParagraphElement,
  errorStatus: element('error-status') as HTMLParagraphElement,
  retryPushButton: element('retry-push-button') as HTMLButtonElement,
  commitMessage: element('commit-message') as HTMLTextAreaElement,
  commitButton: element('commit-button') as HTMLButtonElement,
  commitPushButton: element('commit-push-button') as HTMLButtonElement,
};

let currentModel: RepositoryViewModel | undefined;
let commitMessageTimer: number | undefined;
let pendingCommitMessage: string | undefined;
let pendingWriteRequestId: string | undefined;
let pendingRepositoryId: string | undefined;
let pendingRepositoryRequestId: string | undefined;
let writeRequestSequence = 0;

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

  const path = document.createElement('button');
  path.className = 'file-path';
  path.type = 'button';
  path.title = change.originalPath === undefined
    ? change.path
    : `${change.originalPath} → ${change.path}`;
  path.setAttribute('aria-label', `打开 ${path.title} 的变更`);
  setText(path, path.title);
  path.addEventListener('click', () => {
    post({ type: 'openDiff', repositoryId, fileId: change.id });
  });

  const layer = document.createElement('span');
  layer.className = 'layer-badge';
  setText(layer, layerLabel(change));

  row.append(checkbox, status, path, layer);
  return row;
}

function replaceChildren(
  container: HTMLElement,
  changes: readonly FileChange[],
  repositoryId: string | undefined,
  selected: ReadonlySet<string>,
  selectionDisabled: boolean,
): void {
  const fragment = document.createDocumentFragment();
  if (repositoryId === undefined) {
    container.replaceChildren(fragment);
    return;
  }
  for (const change of changes) {
    fragment.append(renderFile(
      change,
      repositoryId,
      selected.has(change.id),
      selectionDisabled,
    ));
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
  layout.setAttribute('aria-busy', model.operation.kind === 'running'
    ? 'true'
    : 'false');
  controls.loadingStatus.hidden = true;

  updateRepository(model);
  const selected = selectedSet(model);
  const tracked = model.changes.filter((change) => !change.untracked);
  const untracked = model.changes.filter((change) => change.untracked);
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
  replaceChildren(
    controls.trackedGroup,
    tracked,
    model.currentRepositoryId,
    selected,
    selectionDisabled,
  );
  replaceChildren(
    controls.untrackedGroup,
    untracked,
    model.currentRepositoryId,
    selected,
    selectionDisabled,
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
  pendingWriteRequestId = `write-${String(writeRequestSequence)}`;
  render(model, false);
  return {
    repositoryId: model.currentRepositoryId,
    version: model.version,
    requestId: pendingWriteRequestId,
  };
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
controls.editRemoteButton.addEventListener('click', () => {
  withModel((model) => {
    const scope = beginWrite(model);
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

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
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
