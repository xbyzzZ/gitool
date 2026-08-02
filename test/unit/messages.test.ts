import { describe, expect, it } from 'vitest';
import { parseWebviewMessage, WebviewMessageError } from '../../src/webview/messages.js';

describe('parseWebviewMessage', () => {
  it.each([
    [{ type: 'ready' }],
    [{ type: 'selectRepository', repositoryId: '/repo/a', requestId: 'r-1' }],
    [{ type: 'setCommitMessage', repositoryId: '/repo/a', message: '提交' }],
    [{ type: 'commit', repositoryId: '/repo/a', version: 0, message: '提交', requestId: 'r-1' }],
    [{ type: 'commitAndPush', repositoryId: '/repo/a', version: 0, message: '提交', requestId: 'r-1' }],
    [{ type: 'selectPushRemote', repositoryId: '/repo/a', version: 0, remote: 'origin', requestId: 'r-1' }],
    [{ type: 'retryPush', repositoryId: '/repo/a', version: 0, requestId: 'r-1' }],
    [{ type: 'generateCommitMessage', repositoryId: '/repo/a', version: 0, selectedIds: ['a.ts'], density: 'standard', requestId: 'r-1' }],
    [{ type: 'cancelCommitMessageGeneration', repositoryId: '/repo/a', requestId: 'r-1' }],
  ])('接受保留的提交 Webview 消息 %#', (input) => {
    expect(parseWebviewMessage(input)).toEqual(input);
  });

  it.each([
    { type: 'refresh' },
    { type: 'toggleFile', repositoryId: '/repo/a', fileId: 'a.ts', selected: true },
    { type: 'setGroup', repositoryId: '/repo/a', group: 'tracked', selected: true },
    { type: 'openDiff', repositoryId: '/repo/a', fileId: 'a.ts' },
    { type: 'trash', repositoryId: '/repo/a', version: 0, fileIds: ['a.ts'], requestId: 'r-1' },
    { type: 'editRemoteUrl', repositoryId: '/repo/a', version: 0, requestId: 'r-1' },
    { type: 'refreshHistory', repositoryId: '/repo/a', version: 0, requestId: 'r-1' },
    { type: 'fetchHistory', repositoryId: '/repo/a', version: 0, requestId: 'r-1' },
    { type: 'pull', repositoryId: '/repo/a', version: 0, requestId: 'r-1' },
    { type: 'pushAll', repositoryId: '/repo/a', version: 0, requestId: 'r-1' },
    { type: 'loadCommitDetails', repositoryId: '/repo/a', version: 0, hash: 'a'.repeat(40), requestId: 'r-1' },
    { type: 'openCommitDiff', repositoryId: '/repo/a', version: 0, hash: 'a'.repeat(40), path: 'a.ts', requestId: 'r-1' },
  ])('拒绝已迁移到原生 View 的消息 %#', (input) => {
    expect(() => parseWebviewMessage(input)).toThrow(WebviewMessageError);
  });

  it('拒绝携带额外字段的提交消息', () => {
    expect(() => parseWebviewMessage({
      type: 'commit', repositoryId: '/repo/a', version: 0, message: '提交',
      requestId: 'r-1', extra: true,
    })).toThrow(WebviewMessageError);
  });
});
