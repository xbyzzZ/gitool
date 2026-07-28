import { describe, expect, it, vi } from 'vitest';
import {
  createTemporaryDirectories,
  type TemporaryDirectoryDependencies,
} from '../vscode/temporary-directories.js';

function dependencies(
  overrides: Partial<TemporaryDirectoryDependencies> = {},
): TemporaryDirectoryDependencies {
  return {
    create: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    platform: 'linux',
    temporaryRoot: '/system/tmp',
    ...overrides,
  };
}

describe('VS Code 测试临时目录', () => {
  it('后续目录创建失败时清理此前已创建的目录', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce('/system/tmp/gitool-user-created')
      .mockRejectedValueOnce(new Error('扩展目录创建失败'));
    const remove = vi.fn().mockResolvedValue(undefined);

    await expect(createTemporaryDirectories(dependencies({
      create,
      remove,
    }))).rejects.toThrow('扩展目录创建失败');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(
      '/system/tmp/gitool-user-created',
    );
  });

  it('macOS 使用系统临时目录下的短前缀', async () => {
    const prefixes: string[] = [];
    const create = vi.fn((prefix: string) => {
      prefixes.push(prefix);
      return Promise.resolve(`${prefix}created`);
    });
    const directories = await createTemporaryDirectories(dependencies({
      create,
      platform: 'darwin',
      temporaryRoot: '/var/folders/example/T',
    }));

    expect(prefixes).toEqual([
      '/var/folders/example/T/gt-u-',
      '/var/folders/example/T/gt-e-',
      '/var/folders/example/T/gt-a-',
    ]);
    await directories.dispose();
  });

  it('其他平台使用系统临时目录和可读前缀', async () => {
    const prefixes: string[] = [];
    const create = vi.fn((prefix: string) => {
      prefixes.push(prefix);
      return Promise.resolve(`${prefix}created`);
    });
    const directories = await createTemporaryDirectories(dependencies({
      create,
      platform: 'linux',
      temporaryRoot: '/system/tmp',
    }));

    expect(prefixes).toEqual([
      '/system/tmp/gitool-user-',
      '/system/tmp/gitool-ext-',
      '/system/tmp/gitool-acceptance-',
    ]);
    await directories.dispose();
  });

  it('清理单个目录失败时仍继续清理其他目录', async () => {
    const create = vi.fn(
      (prefix: string) => Promise.resolve(`${prefix}created`),
    );
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error('验收目录清理失败'))
      .mockResolvedValue(undefined);
    const directories = await createTemporaryDirectories(dependencies({
      create,
      remove,
    }));

    await expect(directories.dispose()).rejects.toThrow(
      '测试临时目录清理失败',
    );
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
