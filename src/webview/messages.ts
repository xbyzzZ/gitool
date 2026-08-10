export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | {
    readonly type: 'selectRepository';
    readonly repositoryId: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'toggleFile';
    readonly repositoryId: string;
    readonly fileId: string;
    readonly selected: boolean;
  }
  | {
    readonly type: 'setGroup';
    readonly repositoryId: string;
    readonly group: 'tracked' | 'untracked';
    readonly selected: boolean;
  }
  | {
    readonly type: 'setCommitMessage';
    readonly repositoryId: string;
    readonly message: string;
  }
  | {
    readonly type: 'openDiff';
    readonly repositoryId: string;
    readonly fileId: string;
  }
  | {
    readonly type: 'commit';
    readonly repositoryId: string;
    readonly version: number;
    readonly message: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'commitAndPush';
    readonly repositoryId: string;
    readonly version: number;
    readonly message: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'selectPushRemote';
    readonly repositoryId: string;
    readonly version: number;
    readonly remote: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'retryPush';
    readonly repositoryId: string;
    readonly version: number;
    readonly requestId: string;
  }
  | {
    readonly type: 'trash';
    readonly repositoryId: string;
    readonly version: number;
    readonly fileIds: readonly string[];
    readonly requestId: string;
  }
  | {
    readonly type: 'editRemoteUrl';
    readonly repositoryId: string;
    readonly version: number;
    readonly requestId: string;
  }
  | {
    readonly type: 'refreshHistory' | 'fetchHistory' | 'pull' | 'pushAll';
    readonly repositoryId: string;
    readonly version: number;
    readonly requestId: string;
  }
  | {
    readonly type: 'loadCommitDetails';
    readonly repositoryId: string;
    readonly version: number;
    readonly hash: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'openCommitDiff';
    readonly repositoryId: string;
    readonly version: number;
    readonly hash: string;
    readonly path: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'selectAiModel';
    readonly repositoryId: string;
    readonly requestId: string;
  }
  | {
    readonly type: 'generateCommitMessage';
    readonly repositoryId: string;
    readonly version: number;
    readonly selectedIds: readonly string[];
    readonly density: 'compact' | 'standard' | 'detailed';
    readonly requestId: string;
  }
  | {
    readonly type: 'cancelCommitMessageGeneration';
    readonly repositoryId: string;
    readonly requestId: string;
  };

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

function requireRepositoryId(input: MessageRecord): string {
  if (!isNonEmptyString(input.repositoryId)) {
    invalid('repositoryId');
  }
  return input.repositoryId;
}

function parseVersionMessage(
  input: MessageRecord,
  type: 'retryPush' | 'editRemoteUrl' | 'refreshHistory'
    | 'fetchHistory' | 'pull' | 'pushAll',
): WebviewMessage {
  requireExactKeys(input, [
    'type',
    'repositoryId',
    'version',
    'requestId',
  ]);
  const repositoryId = requireRepositoryId(input);
  if (!isNonNegativeInteger(input.version)) {
    invalid('version');
  }
  if (!isNonEmptyString(input.requestId)) {
    invalid('requestId');
  }
  return {
    type,
    repositoryId,
    version: input.version,
    requestId: input.requestId,
  };
}

function requireVersion(input: MessageRecord): number {
  if (!isNonNegativeInteger(input.version)) {
    invalid('version');
  }
  return input.version;
}

function requireRequestId(input: MessageRecord): string {
  if (!isNonEmptyString(input.requestId)) {
    invalid('requestId');
  }
  return input.requestId;
}

function requireCommitHash(input: MessageRecord): string {
  if (typeof input.hash !== 'string' || !/^[0-9a-f]{40}$/u.test(input.hash)) {
    invalid('hash');
  }
  return input.hash;
}

function parseCommitMessage(
  input: MessageRecord,
  type: 'commit' | 'commitAndPush',
): WebviewMessage {
  requireExactKeys(input, [
    'type',
    'repositoryId',
    'version',
    'message',
    'requestId',
  ]);
  const repositoryId = requireRepositoryId(input);
  if (!isNonNegativeInteger(input.version)) {
    invalid('version');
  }
  if (typeof input.message !== 'string') {
    invalid('message');
  }
  if (!isNonEmptyString(input.requestId)) {
    invalid('requestId');
  }
  return {
    type,
    repositoryId,
    version: input.version,
    message: input.message,
    requestId: input.requestId,
  };
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
      requireExactKeys(input, ['type', 'repositoryId', 'requestId']);
      if (!isNonEmptyString(input.repositoryId)) {
        invalid('repositoryId');
      }
      if (!isNonEmptyString(input.requestId)) {
        invalid('requestId');
      }
      return {
        type: input.type,
        repositoryId: input.repositoryId,
        requestId: input.requestId,
      };
    case 'toggleFile':
      requireExactKeys(input, [
        'type',
        'repositoryId',
        'fileId',
        'selected',
      ]);
      {
        const repositoryId = requireRepositoryId(input);
      if (!isNonEmptyString(input.fileId)) {
        invalid('fileId');
      }
      if (typeof input.selected !== 'boolean') {
        invalid('selected');
      }
      return {
        type: input.type,
        repositoryId,
        fileId: input.fileId,
        selected: input.selected,
      };
      }
    case 'setGroup':
      requireExactKeys(input, [
        'type',
        'repositoryId',
        'group',
        'selected',
      ]);
      {
        const repositoryId = requireRepositoryId(input);
      if (input.group !== 'tracked' && input.group !== 'untracked') {
        invalid('group');
      }
      if (typeof input.selected !== 'boolean') {
        invalid('selected');
      }
      return {
        type: input.type,
        repositoryId,
        group: input.group,
        selected: input.selected,
      };
      }
    case 'setCommitMessage':
      requireExactKeys(input, ['type', 'repositoryId', 'message']);
      {
        const repositoryId = requireRepositoryId(input);
      if (typeof input.message !== 'string') {
        invalid('message');
      }
      return {
        type: input.type,
        repositoryId,
        message: input.message,
      };
      }
    case 'openDiff':
      requireExactKeys(input, ['type', 'repositoryId', 'fileId']);
      {
        const repositoryId = requireRepositoryId(input);
        if (!isNonEmptyString(input.fileId)) {
          invalid('fileId');
        }
        return {
          type: input.type,
          repositoryId,
          fileId: input.fileId,
        };
      }
    case 'selectAiModel':
      requireExactKeys(input, ['type', 'repositoryId', 'requestId']);
      return {
        type: input.type,
        repositoryId: requireRepositoryId(input),
        requestId: requireRequestId(input),
      };
    case 'commit':
    case 'commitAndPush':
      return parseCommitMessage(input, input.type);
    case 'retryPush':
    case 'editRemoteUrl':
    case 'refreshHistory':
    case 'fetchHistory':
    case 'pull':
    case 'pushAll':
      return parseVersionMessage(input, input.type);
    case 'loadCommitDetails':
      requireExactKeys(input, [
        'type', 'repositoryId', 'version', 'hash', 'requestId',
      ]);
      return {
        type: input.type,
        repositoryId: requireRepositoryId(input),
        version: requireVersion(input),
        hash: requireCommitHash(input),
        requestId: requireRequestId(input),
      };
    case 'openCommitDiff':
      requireExactKeys(input, [
        'type', 'repositoryId', 'version', 'hash', 'path', 'requestId',
      ]);
      if (!isNonEmptyString(input.path)) {
        invalid('path');
      }
      return {
        type: input.type,
        repositoryId: requireRepositoryId(input),
        version: requireVersion(input),
        hash: requireCommitHash(input),
        path: input.path,
        requestId: requireRequestId(input),
      };
    case 'generateCommitMessage':
      requireExactKeys(input, [
        'type',
        'repositoryId',
        'version',
        'selectedIds',
        'density',
        'requestId',
      ]);
      if (!Array.isArray(input.selectedIds)
        || input.selectedIds.length === 0
        || !input.selectedIds.every(isNonEmptyString)) {
        invalid('selectedIds');
      }
      if (input.density !== 'compact'
        && input.density !== 'standard'
        && input.density !== 'detailed') {
        invalid('density');
      }
      return {
        type: input.type,
        repositoryId: requireRepositoryId(input),
        version: requireVersion(input),
        selectedIds: [...input.selectedIds],
        density: input.density,
        requestId: requireRequestId(input),
      };
    case 'cancelCommitMessageGeneration':
      requireExactKeys(input, ['type', 'repositoryId', 'requestId']);
      return {
        type: input.type,
        repositoryId: requireRepositoryId(input),
        requestId: requireRequestId(input),
      };
    case 'selectPushRemote':
      requireExactKeys(input, [
        'type',
        'repositoryId',
        'version',
        'remote',
        'requestId',
      ]);
      {
        const repositoryId = requireRepositoryId(input);
      if (!isNonNegativeInteger(input.version)) {
        invalid('version');
      }
      if (!isNonEmptyString(input.remote)) {
        invalid('remote');
      }
      if (!isNonEmptyString(input.requestId)) {
        invalid('requestId');
      }
      return {
        type: input.type,
        repositoryId,
        version: input.version,
        remote: input.remote,
        requestId: input.requestId,
      };
      }
    case 'trash':
      requireExactKeys(input, [
        'type',
        'repositoryId',
        'version',
        'fileIds',
        'requestId',
      ]);
      {
        const repositoryId = requireRepositoryId(input);
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
      if (!isNonEmptyString(input.requestId)) {
        invalid('requestId');
      }
      return {
        type: input.type,
        repositoryId,
        version: input.version,
        fileIds: [...input.fileIds],
        requestId: input.requestId,
      };
      }
    default:
      invalid('type');
  }
}
