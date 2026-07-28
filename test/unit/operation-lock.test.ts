import { describe, expect, it } from 'vitest';
import { RepositoryOperationLock } from '../../src/services/operation-lock.js';

describe('RepositoryOperationLock', () => {
  it('同一仓库有写操作时拒绝第二个写操作', async () => {
    const lock = new RepositoryOperationLock();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = lock.runExclusive('repo-a', () => pending);

    await expect(lock.runExclusive('repo-a', () => Promise.resolve(undefined)))
      .rejects.toThrow('仓库正在执行写操作');

    release();
    await first;
  });

  it('不同仓库可以并行执行', async () => {
    const lock = new RepositoryOperationLock();
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted = false;

    const first = lock.runExclusive('repo-a', () => firstPending);
    const second = lock.runExclusive('repo-b', () => {
      secondStarted = true;
      return Promise.resolve('b');
    });

    await expect(second).resolves.toBe('b');
    expect(secondStarted).toBe(true);

    releaseFirst();
    await first;
  });

  it('写操作结束后允许同一仓库开始下一次操作', async () => {
    const lock = new RepositoryOperationLock();

    await expect(lock.runExclusive('repo-a', () => Promise.resolve('first')))
      .resolves.toBe('first');
    await expect(lock.runExclusive('repo-a', () => Promise.resolve('second')))
      .resolves.toBe('second');
  });

  it('写操作抛错后释放同一仓库的锁', async () => {
    const lock = new RepositoryOperationLock();

    await expect(lock.runExclusive(
      'repo-a',
      () => {
        throw new Error('写操作失败');
      },
    )).rejects.toThrow('写操作失败');

    await expect(lock.runExclusive('repo-a', () => Promise.resolve('recovered')))
      .resolves.toBe('recovered');
  });
});
