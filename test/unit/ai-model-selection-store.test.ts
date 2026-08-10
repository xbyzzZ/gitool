import { describe, expect, it, vi } from 'vitest';
import {
  AiModelSelectionStore,
  type AiModelSelection,
  type AiModelSelectionPersistence,
} from '../../src/services/ai-model-selection-store.js';

function createPersistence(initial?: unknown) {
  let value = initial;
  const update = vi.fn((_key: string, next: unknown) => {
    value = next;
    return Promise.resolve();
  });
  const persistence: AiModelSelectionPersistence = {
    get(): unknown {
      return value;
    },
    update,
  };
  return {
    persistence,
    value: () => value,
  };
}

describe('AI 模型选择状态', () => {
  it('按仓库独立保存并恢复显式选择', async () => {
    const created = createPersistence();
    const store = new AiModelSelectionStore(created.persistence);
    const first: AiModelSelection = { id: 'model-1', name: '模型一' };
    const second: AiModelSelection = { id: 'model-2', name: '模型二' };

    await store.set('/repo/a', first);
    await store.set('/repo/b', second);

    expect(store.get('/repo/a')).toEqual(first);
    expect(store.get('/repo/b')).toEqual(second);
  });

  it('选择自动模式时只删除当前仓库的显式选择', async () => {
    const created = createPersistence({
      '/repo/a': { id: 'model-1', name: '模型一' },
      '/repo/b': { id: 'model-2', name: '模型二' },
    });
    const store = new AiModelSelectionStore(created.persistence);

    await store.set('/repo/a', undefined);

    expect(store.get('/repo/a')).toBeUndefined();
    expect(store.get('/repo/b')).toEqual({ id: 'model-2', name: '模型二' });
  });

  it('忽略损坏或不完整的持久化值', () => {
    const created = createPersistence({
      '/repo/a': { id: '', name: '无效' },
      '/repo/b': { id: 'model-2' },
      '/repo/c': { id: 'model-3', name: '模型三' },
    });
    const store = new AiModelSelectionStore(created.persistence);

    expect(store.get('/repo/a')).toBeUndefined();
    expect(store.get('/repo/b')).toBeUndefined();
    expect(store.get('/repo/c')).toEqual({ id: 'model-3', name: '模型三' });
  });
});
