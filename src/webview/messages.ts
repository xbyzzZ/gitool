export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | { readonly type: 'selectRepository'; readonly repositoryId: string }
  | {
    readonly type: 'toggleFile';
    readonly fileId: string;
    readonly selected: boolean;
  }
  | {
    readonly type: 'setGroup';
    readonly group: 'tracked' | 'untracked';
    readonly selected: boolean;
  }
  | { readonly type: 'setCommitMessage'; readonly message: string }
  | { readonly type: 'openDiff'; readonly fileId: string }
  | { readonly type: 'commit'; readonly version: number }
  | { readonly type: 'commitAndPush'; readonly version: number }
  | {
    readonly type: 'selectPushRemote';
    readonly version: number;
    readonly remote: string;
  }
  | { readonly type: 'retryPush'; readonly version: number }
  | {
    readonly type: 'trash';
    readonly version: number;
    readonly fileIds: readonly string[];
  }
  | { readonly type: 'editRemoteUrl'; readonly version: number };

type MessageRecord = Record<string, unknown>;

export class WebviewMessageError extends Error {
  override readonly name = 'WebviewMessageError';
}

function isRecord(input: unknown): input is MessageRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  input: MessageRecord,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string')
  ) {
    return false;
  }
  const expected = new Set(expectedKeys);
  return keys.every((key) => typeof key === 'string' && expected.has(key));
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === 'number'
    && Number.isSafeInteger(input)
    && input >= 0;
}

function invalid(field: string): never {
  throw new WebviewMessageError(`Webview 消息字段无效：${field}`);
}

function requireExactKeys(
  input: MessageRecord,
  keys: readonly string[],
): void {
  if (!hasExactKeys(input, keys)) {
    invalid('字段集合');
  }
}

function parseVersionMessage(
  input: MessageRecord,
  type: 'commit' | 'commitAndPush' | 'retryPush' | 'editRemoteUrl',
): WebviewMessage {
  requireExactKeys(input, ['type', 'version']);
  if (!isNonNegativeInteger(input.version)) {
    invalid('version');
  }
  return { type, version: input.version };
}

export function parseWebviewMessage(input: unknown): WebviewMessage {
  if (!isRecord(input)) {
    invalid('消息对象');
  }
  if (!isNonEmptyString(input.type)) {
    invalid('type');
  }

  switch (input.type) {
    case 'ready':
    case 'refresh':
      requireExactKeys(input, ['type']);
      return { type: input.type };
    case 'selectRepository':
      requireExactKeys(input, ['type', 'repositoryId']);
      if (!isNonEmptyString(input.repositoryId)) {
        invalid('repositoryId');
      }
      return {
        type: input.type,
        repositoryId: input.repositoryId,
      };
    case 'toggleFile':
      requireExactKeys(input, ['type', 'fileId', 'selected']);
      if (!isNonEmptyString(input.fileId)) {
        invalid('fileId');
      }
      if (typeof input.selected !== 'boolean') {
        invalid('selected');
      }
      return {
        type: input.type,
        fileId: input.fileId,
        selected: input.selected,
      };
    case 'setGroup':
      requireExactKeys(input, ['type', 'group', 'selected']);
      if (input.group !== 'tracked' && input.group !== 'untracked') {
        invalid('group');
      }
      if (typeof input.selected !== 'boolean') {
        invalid('selected');
      }
      return {
        type: input.type,
        group: input.group,
        selected: input.selected,
      };
    case 'setCommitMessage':
      requireExactKeys(input, ['type', 'message']);
      if (typeof input.message !== 'string') {
        invalid('message');
      }
      return {
        type: input.type,
        message: input.message,
      };
    case 'openDiff':
      requireExactKeys(input, ['type', 'fileId']);
      if (!isNonEmptyString(input.fileId)) {
        invalid('fileId');
      }
      return {
        type: input.type,
        fileId: input.fileId,
      };
    case 'commit':
    case 'commitAndPush':
    case 'retryPush':
    case 'editRemoteUrl':
      return parseVersionMessage(input, input.type);
    case 'selectPushRemote':
      requireExactKeys(input, ['type', 'version', 'remote']);
      if (!isNonNegativeInteger(input.version)) {
        invalid('version');
      }
      if (!isNonEmptyString(input.remote)) {
        invalid('remote');
      }
      return {
        type: input.type,
        version: input.version,
        remote: input.remote,
      };
    case 'trash':
      requireExactKeys(input, ['type', 'version', 'fileIds']);
      if (!isNonNegativeInteger(input.version)) {
        invalid('version');
      }
      if (
        !Array.isArray(input.fileIds)
        || input.fileIds.length === 0
        || !input.fileIds.every(isNonEmptyString)
      ) {
        invalid('fileIds');
      }
      return {
        type: input.type,
        version: input.version,
        fileIds: [...input.fileIds],
      };
    default:
      invalid('type');
  }
}
