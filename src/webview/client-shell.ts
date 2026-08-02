type ElementTag = 'button' | 'div' | 'input' | 'p' | 'section' | 'select'
  | 'span' | 'textarea';

const controlTags: Readonly<Record<string, ElementTag>> = {
  'repository-select': 'select',
  'repository-summary': 'p',
  'edit-remote-button': 'button',
  'selection-summary': 'span',
  'refresh-button': 'button',
  'tracked-group-toggle': 'input',
  'tracked-count': 'span',
  'tracked-group': 'div',
  'untracked-group-toggle': 'input',
  'untracked-count': 'span',
  'untracked-group': 'div',
  'conflicted-section': 'section',
  'conflicted-count': 'span',
  'conflicted-group': 'div',
  'trash-button': 'button',
  'loading-status': 'p',
  'operation-status': 'p',
  'error-status': 'p',
  'retry-push-button': 'button',
  'commit-message': 'textarea',
  'commit-button': 'button',
  'commit-push-button': 'button',
  'ai-generate-button': 'button',
  'ai-density-button': 'button',
  'ai-density-menu': 'div',
  'pull-button': 'button',
  'push-all-button': 'button',
  'fetch-history-button': 'button',
  'refresh-history-button': 'button',
  'sync-summary': 'span',
  'history-status': 'div',
  'history-list': 'div',
  'collapse-commit-button': 'button',
  'collapse-changes-button': 'button',
  'collapse-history-button': 'button',
  'commit-changes-resizer': 'div',
  'changes-history-resizer': 'div',
};

function ensureControl(container: HTMLElement, id: string, tag: ElementTag): void {
  if (document.getElementById(id) !== null) {
    return;
  }
  const element = document.createElement(tag);
  element.id = id;
  element.hidden = true;
  if (element instanceof HTMLInputElement) {
    element.type = 'checkbox';
  }
  container.append(element);
}

function ensurePane(
  container: HTMLElement,
  selector: string,
  className: string,
): void {
  if (document.querySelector(selector) !== null) {
    return;
  }
  const pane = document.createElement('section');
  pane.className = className;
  pane.hidden = true;
  container.append(pane);
}

export function installCompatibilityControls(): void {
  const container = document.createElement('div');
  container.className = 'compatibility-controls';
  container.hidden = true;
  for (const [id, tag] of Object.entries(controlTags)) {
    ensureControl(container, id, tag);
  }
  ensurePane(container, '.commit-panel', 'commit-panel');
  ensurePane(container, '.changes-panel', 'changes-panel');
  ensurePane(container, '.history-panel', 'history-panel');
  document.body.append(container);
}
