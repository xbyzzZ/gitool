import { describe, expect, it } from 'vitest';
import { beginScopedRequest } from '../../src/webview/request-state.js';

describe('Webview 请求状态', () => {
  it('打开宿主远程设置窗口时不进入阻塞写状态', () => {
    expect(beginScopedRequest({
      repositoryId: '/workspace/repo',
      version: 7,
      sequence: 3,
      mode: 'host-prompt',
    })).toEqual({
      scope: {
        repositoryId: '/workspace/repo',
        version: 7,
        requestId: 'prompt-3',
      },
    });
  });

  it('实际写操作仍进入阻塞状态', () => {
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
