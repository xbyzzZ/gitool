import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TrashService,
  type TrashConfirmationRequest,
} from '../../src/services/trash-service.js';

describe('TrashService', () => {
  it('只把仓库内的具体文件移入废纸篓', async () => {
    const deleted: {
      readonly path: string;
      readonly recursive: boolean;
      readonly useTrash: boolean;
    }[] = [];
    const confirmations: TrashConfirmationRequest[] = [];
    const repositoryRoot = resolve('workspace', 'repo');
    const relativePath = join('tmp', 'a.txt');
    const service = new TrashService({
      confirm: (request) => {
        confirmations.push(request);
        return Promise.resolve(true);
      },
      delete: (uri, options) => {
        deleted.push({
          path: uri.fsPath,
          recursive: options.recursive,
          useTrash: options.useTrash,
        });
        return Promise.resolve();
      },
    });

    const result = await service.moveToTrash(repositoryRoot, [relativePath]);

    expect(result).toEqual({
      kind: 'completed',
      succeeded: [relativePath],
      failed: [],
    });
    expect(confirmations).toEqual([{
      paths: [relativePath],
      message: `确认将以下文件移入废纸篓？\n${relativePath}`,
      confirmLabel: '移入废纸篓',
      cancelLabel: '取消',
    }]);
    expect(deleted).toEqual([{
      path: join(repositoryRoot, relativePath),
      recursive: false,
      useTrash: true,
    }]);
  });

  it('在确认和删除前拒绝仓库外路径', async () => {
    let confirmed = false;
    const service = new TrashService({
      confirm: () => {
        confirmed = true;
        return Promise.resolve(true);
      },
      delete: () => Promise.reject(new Error('路径校验必须在删除调用前完成')),
    });

    await expect(service.moveToTrash(join('workspace', 'repo'), [
      join('..', 'outside.txt'),
    ])).rejects.toThrow('目标不在当前仓库内');

    expect(confirmed).toBe(false);
  });

  it('用户取消时不删除任何文件', async () => {
    let deleted = false;
    const service = new TrashService({
      confirm: () => Promise.resolve(false),
      delete: () => {
        deleted = true;
        return Promise.resolve();
      },
    });

    await expect(service.moveToTrash(join('workspace', 'repo'), [
      join('tmp', 'a.txt'),
    ])).resolves.toEqual({
      kind: 'cancelled',
      succeeded: [],
      failed: [],
    });
    expect(deleted).toBe(false);
  });

  it('单个文件删除失败时继续处理其余文件并逐项返回错误', async () => {
    const relativePaths = [join('tmp', 'a.txt'), join('tmp', 'b.txt')];
    const service = new TrashService({
      confirm: () => Promise.resolve(true),
      delete: (uri) => {
        if (uri.fsPath.endsWith(join('tmp', 'a.txt'))) {
          return Promise.reject(new Error('文件被占用'));
        }
        return Promise.resolve();
      },
    });

    await expect(service.moveToTrash(join('workspace', 'repo'), relativePaths))
      .resolves.toEqual({
        kind: 'completed',
        succeeded: [join('tmp', 'b.txt')],
        failed: [{ path: join('tmp', 'a.txt'), message: '文件被占用' }],
      });
  });
});
