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
  { type: 'commit', version: 0, repositoryId: '/other' },
  { type: 'trash', version: 0, fileIds: ['a.ts'], recursive: true },
  JSON.parse('{"type":"ready","__proto__":{"polluted":true}}') as unknown,
  Object.assign(Object.create({ polluted: true }) as object, { type: 'ready' }),
];

describe('parseWebviewMessage', () => {
  it.each([
    [{ type: 'ready' }, { type: 'ready' }],
    [{ type: 'refresh' }, { type: 'refresh' }],
    [
      { type: 'selectRepository', repositoryId: '/repo/a' },
      { type: 'selectRepository', repositoryId: '/repo/a' },
    ],
    [
      { type: 'toggleFile', fileId: 'a.ts', selected: true },
      { type: 'toggleFile', fileId: 'a.ts', selected: true },
    ],
    [
      { type: 'setGroup', group: 'tracked', selected: false },
      { type: 'setGroup', group: 'tracked', selected: false },
    ],
    [
      { type: 'setCommitMessage', message: '' },
      { type: 'setCommitMessage', message: '' },
    ],
    [
      { type: 'openDiff', fileId: 'a.ts' },
      { type: 'openDiff', fileId: 'a.ts' },
    ],
    [{ type: 'commit', version: 0 }, { type: 'commit', version: 0 }],
    [
      { type: 'commitAndPush', version: 1 },
      { type: 'commitAndPush', version: 1 },
    ],
    [
      { type: 'selectPushRemote', version: 2, remote: 'origin' },
      { type: 'selectPushRemote', version: 2, remote: 'origin' },
    ],
    [
      { type: 'retryPush', version: 3 },
      { type: 'retryPush', version: 3 },
    ],
    [
      { type: 'trash', version: 4, fileIds: ['a.ts', 'b.ts'] },
      { type: 'trash', version: 4, fileIds: ['a.ts', 'b.ts'] },
    ],
    [
      { type: 'editRemoteUrl', version: 5 },
      { type: 'editRemoteUrl', version: 5 },
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
    { type: 'selectRepository', repositoryId: '' },
    { type: 'selectRepository', repositoryId: '   ' },
    { type: 'toggleFile', fileId: '', selected: true },
    { type: 'toggleFile', fileId: 'a.ts', selected: 1 },
    { type: 'setGroup', group: 'ignored', selected: true },
    { type: 'setGroup', group: 'tracked', selected: 'true' },
    { type: 'setCommitMessage', message: 7 },
    { type: 'openDiff', fileId: '' },
    { type: 'commit', version: -1 },
    { type: 'commit', version: 1.5 },
    { type: 'commit', version: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'commitAndPush', version: Number.POSITIVE_INFINITY },
    { type: 'selectPushRemote', version: 0, remote: '' },
    { type: 'retryPush', version: '0' },
    { type: 'trash', version: 0, fileIds: [] },
    { type: 'trash', version: 0, fileIds: [''] },
    { type: 'trash', version: 0, fileIds: 'a.ts' },
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
        version: 0,
        payload: secret,
      });
      expect.fail('带额外字段的消息应被拒绝');
    } catch (error) {
      expect(error).toBeInstanceOf(WebviewMessageError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
