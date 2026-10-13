import { describe, expect, it } from 'vitest';
import { beginScopedRequest } from '../../src/webview/request-state.js';

describe('Webview 请求状态', () => {
  it('实际写操作进入阻塞状态', () => {
    expect(beginScopedRequest({
      repositoryId: '/workspace/repo',
      version: 7,
      sequence: 4,
      mode: 'write',
    })).toEqual({
      scope: {
        repositoryId: '/workspace/repo',
        version: 7,
        requestId: 'write-4',
      },
      pendingRequestId: 'write-4',
      pendingPresentation: 'global-status',
    });
  });

  it('AI 生成请求只在生成按钮内显示加载状态', () => {
    expect(beginScopedRequest({
      repositoryId: '/workspace/repo',
      version: 7,
      sequence: 5,
      mode: 'ai',
    })).toEqual({
      scope: {
        repositoryId: '/workspace/repo',
        version: 7,
        requestId: 'ai-5',
      },
      pendingRequestId: 'ai-5',
      pendingPresentation: 'ai-button',
    });
  });
});
