export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'selectRepository'; readonly repositoryId: string; readonly requestId: string }
  | { readonly type: 'setCommitMessage'; readonly repositoryId: string; readonly message: string }
  | { readonly type: 'commit'; readonly repositoryId: string; readonly version: number; readonly message: string; readonly requestId: string }
  | { readonly type: 'commitAndPush'; readonly repositoryId: string; readonly version: number; readonly message: string; readonly requestId: string }
  | { readonly type: 'selectPushRemote'; readonly repositoryId: string; readonly version: number; readonly remote: string; readonly requestId: string }
  | { readonly type: 'retryPush'; readonly repositoryId: string; readonly version: number; readonly requestId: string }
  | { readonly type: 'generateCommitMessage'; readonly repositoryId: string; readonly version: number; readonly selectedIds: readonly string[]; readonly density: 'compact' | 'standard' | 'detailed'; readonly requestId: string }
  | { readonly type: 'cancelCommitMessageGeneration'; readonly repositoryId: string; readonly requestId: string };

type MessageRecord = Record<string, unknown>;

export class WebviewMessageError extends Error {
  override readonly name = 'WebviewMessageError';
}

function invalid(field: string): never {
  throw new WebviewMessageError(`Webview 消息字段无效：${field}`);
}

function isRecord(input: unknown): input is MessageRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(input: MessageRecord, keys: readonly string[]): void {
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string')
    || !actual.every((key) => typeof key === 'string' && keys.includes(key))) {
    invalid('字段集合');
  }
}

function requireNonEmptyString(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    invalid(field);
  }
  return input;
}

function requireVersion(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    invalid('version');
  }
  return input;
}

function parseScope(input: MessageRecord): { readonly repositoryId: string; readonly version: number; readonly requestId: string } {
  return {
    repositoryId: requireNonEmptyString(input.repositoryId, 'repositoryId'),
    version: requireVersion(input.version),
    requestId: requireNonEmptyString(input.requestId, 'requestId'),
  };
}

export function parseWebviewMessage(input: unknown): WebviewMessage {
  if (!isRecord(input)) {
    invalid('消息对象');
  }
  const type = requireNonEmptyString(input.type, 'type');
  switch (type) {
    case 'ready':
      requireExactKeys(input, ['type']);
      return { type };
    case 'selectRepository':
      requireExactKeys(input, ['type', 'repositoryId', 'requestId']);
      return { type, repositoryId: requireNonEmptyString(input.repositoryId, 'repositoryId'), requestId: requireNonEmptyString(input.requestId, 'requestId') };
    case 'setCommitMessage':
      requireExactKeys(input, ['type', 'repositoryId', 'message']);
      if (typeof input.message !== 'string') {
        invalid('message');
      }
      return { type, repositoryId: requireNonEmptyString(input.repositoryId, 'repositoryId'), message: input.message };
    case 'commit':
    case 'commitAndPush': {
      requireExactKeys(input, ['type', 'repositoryId', 'version', 'message', 'requestId']);
      if (typeof input.message !== 'string') {
        invalid('message');
      }
      return { type, ...parseScope(input), message: input.message };
    }
    case 'selectPushRemote': {
      requireExactKeys(input, ['type', 'repositoryId', 'version', 'remote', 'requestId']);
      return { type, ...parseScope(input), remote: requireNonEmptyString(input.remote, 'remote') };
    }
    case 'retryPush':
      requireExactKeys(input, ['type', 'repositoryId', 'version', 'requestId']);
      return { type, ...parseScope(input) };
    case 'generateCommitMessage': {
      requireExactKeys(input, ['type', 'repositoryId', 'version', 'selectedIds', 'density', 'requestId']);
      if (!Array.isArray(input.selectedIds) || input.selectedIds.length === 0
        || !input.selectedIds.every((item) => typeof item === 'string' && item.trim().length > 0)) {
        invalid('selectedIds');
      }
      if (input.density !== 'compact' && input.density !== 'standard' && input.density !== 'detailed') {
        invalid('density');
      }
      return {
        type,
        ...parseScope(input),
        selectedIds: input.selectedIds.map(
          (item) => requireNonEmptyString(item, 'selectedIds'),
        ),
        density: input.density,
      };
    }
    case 'cancelCommitMessageGeneration':
      requireExactKeys(input, ['type', 'repositoryId', 'requestId']);
      return { type, repositoryId: requireNonEmptyString(input.repositoryId, 'repositoryId'), requestId: requireNonEmptyString(input.requestId, 'requestId') };
    default:
      invalid('type');
  }
}
