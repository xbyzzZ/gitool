import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface TrashUri {
  readonly fsPath: string;
}

export interface TrashDeleteOptions {
  readonly recursive: false;
  readonly useTrash: true;
}

export interface TrashConfirmationRequest {
  readonly paths: readonly string[];
  readonly message: string;
  readonly confirmLabel: '移入废纸篓';
  readonly cancelLabel: '取消';
}

export interface TrashServiceDependencies {
  readonly confirm: (request: TrashConfirmationRequest) => Promise<boolean>;
  readonly delete: (uri: TrashUri, options: TrashDeleteOptions) => Promise<void>;
}

export interface TrashFailure {
  readonly path: string;
  readonly message: string;
}

export interface TrashCompletedResult {
  readonly kind: 'completed';
  readonly succeeded: readonly string[];
  readonly failed: readonly TrashFailure[];
}

export interface TrashCancelledResult {
  readonly kind: 'cancelled';
  readonly succeeded: readonly [];
  readonly failed: readonly [];
}

export type TrashResult = TrashCompletedResult | TrashCancelledResult;

interface ResolvedTrashPath {
  readonly requestedPath: string;
  readonly absolutePath: string;
}

function isOutsideRepository(repositoryRoot: string, targetPath: string): boolean {
  const pathFromRepository = relative(repositoryRoot, targetPath);
  return pathFromRepository.length === 0
    || pathFromRepository === '..'
    || pathFromRepository.startsWith(`..${sep}`)
    || isAbsolute(pathFromRepository);
}

function resolveTrashPath(
  repositoryRoot: string,
  requestedPath: string,
): ResolvedTrashPath {
  if (
    requestedPath.length === 0
    || requestedPath.includes('\u0000')
    || isAbsolute(requestedPath)
  ) {
    throw new RangeError('目标不在当前仓库内');
  }

  const absolutePath = resolve(repositoryRoot, requestedPath);
  if (isOutsideRepository(repositoryRoot, absolutePath)) {
    throw new RangeError('目标不在当前仓库内');
  }

  return { requestedPath, absolutePath };
}

function confirmationFor(paths: readonly string[]): TrashConfirmationRequest {
  return {
    paths,
    message: `确认将以下文件移入废纸篓？\n${paths.join('\n')}`,
    confirmLabel: '移入废纸篓',
    cancelLabel: '取消',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TrashService {
  constructor(private readonly dependencies: TrashServiceDependencies) {}

  async moveToTrash(
    repositoryRoot: string,
    relativePaths: readonly string[],
  ): Promise<TrashResult> {
    if (relativePaths.length === 0) {
      throw new RangeError('至少选择一个文件');
    }

    const absoluteRepositoryRoot = resolve(repositoryRoot);
    const paths = relativePaths.map((path) => resolveTrashPath(
      absoluteRepositoryRoot,
      path,
    ));
    if (!await this.dependencies.confirm(confirmationFor(relativePaths))) {
      return { kind: 'cancelled', succeeded: [], failed: [] };
    }

    const succeeded: string[] = [];
    const failed: TrashFailure[] = [];
    for (const path of paths) {
      try {
        await this.dependencies.delete(
          { fsPath: path.absolutePath },
          { recursive: false, useTrash: true },
        );
        succeeded.push(path.requestedPath);
      } catch (error) {
        failed.push({
          path: path.requestedPath,
          message: errorMessage(error),
        });
      }
    }
    return { kind: 'completed', succeeded, failed };
  }
}
