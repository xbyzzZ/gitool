import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryDirectoryPaths {
  readonly userDataDirectory: string;
  readonly extensionsDirectory: string;
  readonly fixtureRoot: string;
}

export interface TemporaryDirectories extends TemporaryDirectoryPaths {
  dispose(): Promise<void>;
}

export interface TemporaryDirectoryDependencies {
  readonly create: (prefix: string) => Promise<string>;
  readonly remove: (path: string) => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly temporaryRoot: string;
}

const defaultDependencies: TemporaryDirectoryDependencies = {
  create: mkdtemp,
  remove: async (path) => {
    await rm(path, { force: true, recursive: true });
  },
  platform: process.platform,
  temporaryRoot: tmpdir(),
};

async function removeDirectories(
  paths: readonly string[],
  remove: TemporaryDirectoryDependencies['remove'],
): Promise<Error[]> {
  const errors: Error[] = [];
  for (const path of [...paths].reverse()) {
    try {
      await remove(path);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return errors;
}

export async function createTemporaryDirectories(
  dependencies: TemporaryDirectoryDependencies = defaultDependencies,
): Promise<TemporaryDirectories> {
  const created: string[] = [];
  const names = dependencies.platform === 'darwin'
    ? ['gt-u-', 'gt-e-', 'gt-a-']
    : ['gitool-user-', 'gitool-ext-', 'gitool-acceptance-'];
  try {
    for (const name of names) {
      created.push(await dependencies.create(
        join(dependencies.temporaryRoot, name),
      ));
    }
  } catch (error) {
    const cleanupErrors = await removeDirectories(
      created,
      dependencies.remove,
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [
          error instanceof Error ? error : new Error(String(error)),
          ...cleanupErrors,
        ],
        '测试临时目录创建失败，且已创建目录清理失败',
      );
    }
    throw error;
  }
  const userDataDirectory = created[0];
  const extensionsDirectory = created[1];
  const fixtureRoot = created[2];
  if (
    userDataDirectory === undefined
    || extensionsDirectory === undefined
    || fixtureRoot === undefined
  ) {
    throw new Error('测试临时目录创建结果不完整');
  }
  let disposed = false;
  return {
    userDataDirectory,
    extensionsDirectory,
    fixtureRoot,
    async dispose(): Promise<void> {
      if (disposed) {
        return;
      }
      disposed = true;
      const errors = await removeDirectories(created, dependencies.remove);
      if (errors.length > 0) {
        throw new AggregateError(errors, '测试临时目录清理失败');
      }
    },
  };
}
