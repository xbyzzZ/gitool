import { describe, expect, it } from 'vitest';
import {
  parseWebviewMessage,
  WebviewMessageError,
} from '../../src/webview/messages.js';

const messagesWithExtraFields: readonly unknown[] = [
  { type: 'ready', extra: true },
  { type: 'refresh', constructor: '恶意值' },
  {
    type: 'toggleFile',
    fileId: 'a.ts',
    selected: true,
    command: '执行任意命令',
  },
  {
    type: 'commit',
    repositoryId: '/repo/a',
    version: 0,
    message: '提交',
    requestId: 'request-1',
    extra: true,
  },
  {
    type: 'selectAiModel',
    repositoryId: '/repo/a',
    requestId: 'request-model',
    modelId: '伪造模型',
  },
  { type: 'trash', version: 0, fileIds: ['a.ts'], recursive: true },
  JSON.parse('{"type":"ready","__proto__":{"polluted":true}}') as unknown,
  Object.assign(Object.create({ polluted: true }) as object, { type: 'ready' }),
];

describe('parseWebviewMessage', () => {
  it.each([
    [{ type: 'ready' }, { type: 'ready' }],
    [{ type: 'refresh' }, { type: 'refresh' }],
    [
      {
        type: 'selectRepository',
        repositoryId: '/repo/a',
        requestId: 'request-1',
      },
      {
        type: 'selectRepository',
        repositoryId: '/repo/a',
        requestId: 'request-1',
      },
    ],
    [
      {
        type: 'toggleFile',
        repositoryId: '/repo/a',
        fileId: 'a.ts',
        selected: true,
      },
      {
        type: 'toggleFile',
        repositoryId: '/repo/a',
        fileId: 'a.ts',
        selected: true,
      },
    ],
    [
      {
        type: 'setGroup',
        repositoryId: '/repo/a',
        group: 'tracked',
        selected: false,
      },
      {
        type: 'setGroup',
        repositoryId: '/repo/a',
        group: 'tracked',
        selected: false,
      },
    ],
    [
      {
        type: 'setCommitMessage',
        repositoryId: '/repo/a',
        message: '',
      },
      {
        type: 'setCommitMessage',
        repositoryId: '/repo/a',
        message: '',
      },
    ],
    [
      {
        type: 'openDiff',
        repositoryId: '/repo/a',
        fileId: 'a.ts',
      },
      {
        type: 'openDiff',
        repositoryId: '/repo/a',
        fileId: 'a.ts',
      },
    ],
    [
      {
        type: 'commit',
        repositoryId: '/repo/a',
        version: 0,
        message: '最终文案',
        requestId: 'request-1',
      },
      {
        type: 'commit',
        repositoryId: '/repo/a',
        version: 0,
        message: '最终文案',
        requestId: 'request-1',
      },
    ],
    [
      {
        type: 'commitAndPush',
        repositoryId: '/repo/a',
        version: 1,
        message: '最终文案',
        requestId: 'request-1',
      },
      {
        type: 'commitAndPush',
        repositoryId: '/repo/a',
        version: 1,
        message: '最终文案',
        requestId: 'request-1',
      },
    ],
    [
      {
        type: 'selectPushRemote',
        repositoryId: '/repo/a',
        version: 2,
        remote: 'origin',
        requestId: 'request-1',
      },
      {
        type: 'selectPushRemote',
        repositoryId: '/repo/a',
        version: 2,
        remote: 'origin',
        requestId: 'request-1',
      },
    ],
    [
      {
        type: 'retryPush',
        repositoryId: '/repo/a',
        version: 3,
        requestId: 'request-1',
      },
      {
        type: 'retryPush',
        repositoryId: '/repo/a',
        version: 3,
        requestId: 'request-1',
      },
    ],
    [
      {
        type: 'trash',
        repositoryId: '/repo/a',
        version: 4,
        fileIds: ['a.ts', 'b.ts'],
        requestId: 'request-1',
      },
      {
        type: 'trash',
        repositoryId: '/repo/a',
        version: 4,
        fileIds: ['a.ts', 'b.ts'],
        requestId: 'request-1',
      },
    ],
    [
      {
        type: 'editRemoteUrl',
        repositoryId: '/repo/a',
        version: 5,
        requestId: 'request-1',
      },
      {
        type: 'editRemoteUrl',
        repositoryId: '/repo/a',
        version: 5,
        requestId: 'request-1',
      },
    ],
    ...(['refreshHistory', 'fetchHistory', 'pull', 'pushAll'] as const).map(
      (type): [unknown, unknown] => [{
        type,
        repositoryId: '/repo/a',
        version: 6,
        requestId: 'request-2',
      }, {
        type,
        repositoryId: '/repo/a',
        version: 6,
        requestId: 'request-2',
      }],
    ),
    [
      {
        type: 'loadCommitDetails',
        repositoryId: '/repo/a',
        version: 7,
        hash: 'a'.repeat(40),
        requestId: 'request-3',
      },
      {
        type: 'loadCommitDetails',
        repositoryId: '/repo/a',
        version: 7,
        hash: 'a'.repeat(40),
        requestId: 'request-3',
      },
    ],
    [
      {
        type: 'selectHistoryCommit',
        repositoryId: '/repo/a',
        version: 7,
        hash: 'd'.repeat(40),
        requestId: 'request-select-history',
      },
      {
        type: 'selectHistoryCommit',
        repositoryId: '/repo/a',
        version: 7,
        hash: 'd'.repeat(40),
        requestId: 'request-select-history',
      },
    ],
    [
      {
        type: 'loadCommitDetails',
        repositoryId: '/repo/sha256',
        version: 7,
        hash: 'c'.repeat(64),
        requestId: 'request-sha256',
      },
      {
        type: 'loadCommitDetails',
        repositoryId: '/repo/sha256',
        version: 7,
        hash: 'c'.repeat(64),
        requestId: 'request-sha256',
      },
    ],
    [
      {
        type: 'openCommitDiff',
        repositoryId: '/repo/a',
        version: 8,
        hash: 'b'.repeat(40),
        path: 'src/client.ts',
        requestId: 'request-4',
      },
      {
        type: 'openCommitDiff',
        repositoryId: '/repo/a',
        version: 8,
        hash: 'b'.repeat(40),
        path: 'src/client.ts',
        requestId: 'request-4',
      },
    ],
    [
      {
        type: 'selectAiModel',
        repositoryId: '/repo/a',
        requestId: 'request-model',
      },
      {
        type: 'selectAiModel',
        repositoryId: '/repo/a',
        requestId: 'request-model',
      },
    ],
    [
      {
        type: 'selectCommitMessageDensity',
        repositoryId: '/repo/a',
        currentDensity: 'standard',
        requestId: 'request-density',
      },
      {
        type: 'selectCommitMessageDensity',
        repositoryId: '/repo/a',
        currentDensity: 'standard',
        requestId: 'request-density',
      },
    ],
    [
      {
        type: 'generateCommitMessage',
        repositoryId: '/repo/a',
        version: 9,
        selectedIds: ['a.ts'],
        density: 'standard',
        requestId: 'request-5',
      },
      {
        type: 'generateCommitMessage',
        repositoryId: '/repo/a',
        version: 9,
        selectedIds: ['a.ts'],
        density: 'standard',
        requestId: 'request-5',
      },
    ],
    [
      {
        type: 'cancelCommitMessageGeneration',
        repositoryId: '/repo/a',
        requestId: 'request-5',
      },
      {
        type: 'cancelCommitMessageGeneration',
        repositoryId: '/repo/a',
        requestId: 'request-5',
      },
    ],
  ])('接受协议内消息 %#', (input, expected) => {
    expect(parseWebviewMessage(input)).toEqual(expected);
  });

  it.each([
    null,
    undefined,
    'ready',
    [],
    {},
    { type: 'unknown' },
    {
      type: 'commit',
      version: 0,
      message: '缺少仓库身份',
      requestId: 'request-1',
    },
    {
      type: 'trash',
      version: 0,
      fileIds: ['a.ts'],
      requestId: 'request-1',
    },
    { type: 'selectRepository', repositoryId: '', requestId: 'request-1' },
    { type: 'selectRepository', repositoryId: '   ', requestId: 'request-1' },
    {
      type: 'toggleFile',
      repositoryId: '/repo/a',
      fileId: '',
      selected: true,
    },
    {
      type: 'toggleFile',
      repositoryId: '',
      fileId: 'a.ts',
      selected: true,
    },
    {
      type: 'setGroup',
      repositoryId: '/repo/a',
      group: 'ignored',
      selected: true,
    },
    { type: 'setCommitMessage', repositoryId: '/repo/a', message: 7 },
    { type: 'openDiff', repositoryId: '/repo/a', fileId: '' },
    {
      type: 'commit',
      repositoryId: '/repo/a',
      version: -1,
      message: '提交',
      requestId: 'request-1',
    },
    {
      type: 'commit',
      repositoryId: '/repo/a',
      version: 0,
      message: 7,
      requestId: 'request-1',
    },
    {
      type: 'commit',
      repositoryId: '/repo/a',
      version: 0,
      message: '提交',
      requestId: '',
    },
    {
      type: 'commitAndPush',
      repositoryId: '/repo/a',
      version: Number.POSITIVE_INFINITY,
      message: '提交',
      requestId: 'request-1',
    },
    {
      type: 'selectPushRemote',
      repositoryId: '/repo/a',
      version: 0,
      remote: '',
      requestId: 'request-1',
    },
    {
      type: 'retryPush',
      repositoryId: '/repo/a',
      version: '0',
      requestId: 'request-1',
    },
    {
      type: 'trash',
      repositoryId: '/repo/a',
      version: 0,
      fileIds: [],
      requestId: 'request-1',
    },
    {
      type: 'trash',
      repositoryId: '/repo/a',
      version: 0,
      fileIds: [''],
      requestId: 'request-1',
    },
    {
      type: 'refreshHistory',
      repositoryId: '/repo/a',
      version: -1,
      requestId: 'request-1',
    },
    {
      type: 'loadCommitDetails',
      repositoryId: '/repo/a',
      version: 0,
      hash: 'abc123',
      requestId: 'request-1',
    },
    {
      type: 'loadCommitDetails',
      repositoryId: '/repo/a',
      version: 0,
      hash: 'a'.repeat(41),
      requestId: 'request-1',
    },
    {
      type: 'openCommitDiff',
      repositoryId: '/repo/a',
      version: 0,
      hash: 'a'.repeat(40),
      path: '',
      requestId: 'request-1',
    },
    {
      type: 'generateCommitMessage',
      repositoryId: '/repo/a',
      version: 0,
      selectedIds: ['a.ts'],
      density: 'verbose',
      requestId: 'request-1',
    },
    {
      type: 'selectCommitMessageDensity',
      repositoryId: '/repo/a',
      currentDensity: 'verbose',
      requestId: 'request-density',
    },
    {
      type: 'generateCommitMessage',
      repositoryId: '/repo/a',
      version: 0,
      selectedIds: [],
      density: 'compact',
      requestId: 'request-1',
    },
  ])('拒绝非法消息 %#', (input) => {
    expect(() => parseWebviewMessage(input)).toThrow(WebviewMessageError);
  });

  it.each(messagesWithExtraFields)('拒绝带额外字段的消息 %#', (input) => {
    expect(() => parseWebviewMessage(input)).toThrow(WebviewMessageError);
  });

  it('错误消息不回显完整恶意输入', () => {
    const secret = 'token-不可回显-123456';

    try {
      parseWebviewMessage({
        type: 'commit',
        repositoryId: '/repo/a',
        version: 0,
        message: '提交',
        requestId: 'request-1',
        payload: secret,
      });
      expect.fail('带额外字段的消息应被拒绝');
    } catch (error) {
      expect(error).toBeInstanceOf(WebviewMessageError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
