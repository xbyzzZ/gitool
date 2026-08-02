import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryViewModel } from '../../src/domain/view-model.js';

type Listener = (event: Event) => void;

class FakeElement {
  value = '';
  hidden = false;
  disabled = false;
  textContent: string | null = '';
  type = '';
  selected = false;
  title = '';
  private readonly listeners = new Map<string, Listener>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.(new Event(type));
  }

  append(...children: unknown[]): void { void children; }
  replaceChildren(...children: unknown[]): void { void children; }
  setAttribute(name: string, value: string): void { void name; void value; }
}

function model(
  repositoryId: string,
  commitMessage: string,
): RepositoryViewModel {
  return {
    version: 0,
    trusted: true,
    currentRepositoryId: repositoryId,
    repositories: [
      { id: '/repo/a', label: '仓库 A', rootPath: '/repo/a' },
      { id: '/repo/b', label: '仓库 B', rootPath: '/repo/b' },
    ],
    branch: 'main',
    detached: false,
    changes: [],
    changeCount: 0,
    selectedIds: ['a.ts'],
    commitMessage,
    operation: { kind: 'idle' },
    sync: { kind: 'no-upstream' },
    history: { kind: 'idle', commits: [] },
    ai: { kind: 'idle' },
  };
}

interface ClientHarness {
  readonly controls: Readonly<Record<string, FakeElement>>;
  readonly posted: unknown[];
  readonly sendState: (
    viewModel: RepositoryViewModel,
    acknowledgedRequestId?: string,
  ) => void;
  readonly runTimers: () => void;
}

function control(harness: ClientHarness, id: string): FakeElement {
  const value = harness.controls[id];
  if (value === undefined) {
    throw new Error(`缺少测试控件：${id}`);
  }
  return value;
}

async function loadClient(): Promise<ClientHarness> {
  const controls = Object.fromEntries([
    'repository-select', 'repository-summary', 'loading-status',
    'operation-status', 'error-status', 'retry-push-button',
    'commit-message', 'commit-button', 'commit-push-button',
    'ai-generate-button', 'ai-density-button', 'ai-density-menu',
  ].map((id) => [id, new FakeElement()])) as Record<string, FakeElement>;
  const layout = new FakeElement();
  const posted: unknown[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let messageListener: ((event: MessageEvent<unknown>) => void) | undefined;

  vi.stubGlobal('document', {
    getElementById: (id: string) => controls[id] ?? null,
    querySelector: () => layout,
    createElement: () => new FakeElement(),
    createDocumentFragment: () => new FakeElement(),
  });
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void) => {
      const timer = nextTimer;
      nextTimer += 1;
      timers.set(timer, callback);
      return timer;
    },
    clearTimeout: (timer: number) => timers.delete(timer),
    addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
      if (type === 'message') messageListener = listener;
    },
  });
  vi.stubGlobal('acquireVsCodeApi', () => ({
    postMessage: (message: unknown) => posted.push(message),
    getState: () => undefined,
    setState: vi.fn(),
  }));
  await import('../../src/webview/client.js');
  posted.length = 0;

  return {
    controls,
    posted,
    sendState: (viewModel, acknowledgedRequestId) => {
      messageListener?.({
        data: {
          type: 'state',
          model: viewModel,
          ...(acknowledgedRequestId === undefined ? {} : { acknowledgedRequestId }),
        },
      } as MessageEvent<unknown>);
    },
    runTimers: () => {
      for (const callback of [...timers.values()]) callback();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('提交信息 Webview 客户端草稿', () => {
  it('切换仓库时不把仓库 A 的待发送草稿显示在仓库 B', async () => {
    const harness = await loadClient();
    harness.sendState(model('/repo/a', 'A 的服务端文案'));
    control(harness, 'commit-message').value = 'A 的草稿';
    control(harness, 'commit-message').dispatch('input');
    control(harness, 'repository-select').value = '/repo/b';
    control(harness, 'repository-select').dispatch('change');
    harness.sendState(model('/repo/b', 'B 的服务端文案'), 'switch-1');

    expect(control(harness, 'commit-message').value).toBe('B 的服务端文案');
    expect(harness.posted).toContainEqual({
      type: 'setCommitMessage', repositoryId: '/repo/a', message: 'A 的草稿',
    });
  });

  it('外部切换仓库后会清理旧仓库的防抖生命周期', async () => {
    const harness = await loadClient();
    harness.sendState(model('/repo/a', 'A 的服务端文案'));
    control(harness, 'commit-message').value = 'A 的草稿';
    control(harness, 'commit-message').dispatch('input');
    harness.sendState(model('/repo/b', 'B 的服务端文案'));
    harness.runTimers();

    expect(control(harness, 'commit-message').value).toBe('B 的服务端文案');
    expect(harness.posted).not.toContainEqual({
      type: 'setCommitMessage', repositoryId: '/repo/a', message: 'A 的草稿',
    });
  });

  it('外部切仓不会让仓库 A 的待确认写请求阻塞仓库 B', async () => {
    const harness = await loadClient();
    harness.sendState(model('/repo/a', 'A 的服务端文案'));
    control(harness, 'commit-message').value = 'A 的最终文案';
    control(harness, 'commit-message').dispatch('input');
    control(harness, 'commit-button').dispatch('click');
    harness.sendState(model('/repo/b', 'B 的服务端文案'), 'write-1');

    expect(control(harness, 'commit-message').value).toBe('B 的服务端文案');
    expect(control(harness, 'commit-message').disabled).toBe(false);
  });

  it('AI 开始后不会让旧防抖草稿覆盖 AI 结果', async () => {
    const harness = await loadClient();
    harness.sendState(model('/repo/a', '初始文案'));
    control(harness, 'commit-message').value = '待发送草稿';
    control(harness, 'commit-message').dispatch('input');
    control(harness, 'ai-generate-button').dispatch('click');
    harness.sendState(model('/repo/a', 'AI 生成结果'), 'write-1');
    harness.runTimers();

    expect(control(harness, 'commit-message').value).toBe('AI 生成结果');
    expect(harness.posted.filter((message) => JSON.stringify(message) === JSON.stringify({
      type: 'setCommitMessage',
      repositoryId: '/repo/a',
      message: '待发送草稿',
    }))).toHaveLength(1);
  });
});
