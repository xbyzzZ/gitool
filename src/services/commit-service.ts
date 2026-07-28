import { isAbsolute, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { FileChange } from '../domain/change-model.js';
import { GitRunner, redactSensitiveText } from '../git/git-runner.js';

export interface CommitRequest {
  readonly repositoryRoot: string;
  readonly message: string;
  readonly expectedVersion: number;
  readonly verifyVersion: (expectedVersion: number) => Promise<boolean>;
  readonly files: readonly FileChange[];
}

export interface CommitResult {
  readonly commitHash: string;
  readonly committedPaths: readonly string[];
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function normalizePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort(comparePaths);
}

function validateCommitPath(path: string): void {
  if (path.length === 0 || path.includes('\u0000') || isAbsolute(path)) {
    throw new RangeError(`非法 Git 路径：${JSON.stringify(path)}`);
  }
}

function parseCommittedPaths(output: string): string[] {
  const fields = output.split('\u0000');
  if (fields.at(-1) === '') {
    fields.pop();
  }

  const paths: string[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    if (status === undefined || !/^[A-Z][0-9]*$/u.test(status)) {
      throw new Error(`无法解析 Git 提交状态：${JSON.stringify(status)}`);
    }
    index += 1;

    const pathCount = status.startsWith('R') || status.startsWith('C') ? 2 : 1;
    for (let offset = 0; offset < pathCount; offset += 1) {
      const path = fields[index];
      if (path === undefined) {
        throw new Error(`Git 提交状态缺少路径：${status}`);
      }
      paths.push(path);
      index += 1;
    }
  }
  return normalizePaths(paths);
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((path, index) => path === right[index]);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function throwCollectedErrors(
  mainError: unknown,
  indexCleanupError: unknown,
  temporaryCleanupError: unknown,
): never {
  const phaseErrors = [
    { phase: '提交阶段', error: mainError },
    { phase: '索引恢复阶段', error: indexCleanupError },
    { phase: '临时目录清理阶段', error: temporaryCleanupError },
  ]
    .filter((item) => item.error !== undefined)
    .map((item) => ({ phase: item.phase, error: asError(item.error) }));

  if (phaseErrors.length === 1 && phaseErrors[0] !== undefined) {
    throw phaseErrors[0].error;
  }
  const details = phaseErrors
    .map((item) => `${item.phase}：${item.error.message}`)
    .join('\n');
  throw new AggregateError(
    phaseErrors.map((item) => item.error),
    `Git 提交事务失败，且清理阶段同时发生错误：\n${details}`,
  );
}

export class CommitService {
  constructor(private readonly git: GitRunner) {}

  async commit(request: CommitRequest): Promise<CommitResult> {
    if (request.message.trim().length === 0) {
      throw new RangeError('提交消息不能为空');
    }
    if (request.files.length === 0) {
      throw new RangeError('至少选择一个待提交文件');
    }
    if (request.files.some((file) => file.conflicted)) {
      throw new Error('存在冲突文件，不能提交');
    }
    if (!await request.verifyVersion(request.expectedVersion)) {
      throw new Error('Git 状态已变化，请刷新后重新选择文件');
    }

    const commitPaths = normalizePaths(
      request.files.flatMap((file) => file.commitPaths),
    );
    if (commitPaths.length === 0) {
      throw new RangeError('待提交路径不能为空');
    }
    commitPaths.forEach(validateCommitPath);

    const untrackedPaths = normalizePaths(
      request.files
        .filter((file) => file.untracked)
        .flatMap((file) => file.commitPaths),
    );
    let temporaryDirectory: string | undefined;
    let commitCommandSucceeded = false;
    let result: CommitResult | undefined;
    let mainError: unknown;
    let indexCleanupError: unknown;
    let temporaryCleanupError: unknown;

    try {
      if (untrackedPaths.length > 0) {
        await this.git.run(request.repositoryRoot, [
          '--literal-pathspecs',
          'add',
          '--intent-to-add',
          '--',
          ...untrackedPaths,
        ]);
      }

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'gitool-commit-'));
      const messageFile = join(temporaryDirectory, 'message.txt');
      await writeFile(messageFile, request.message, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await this.git.run(request.repositoryRoot, [
        '--literal-pathspecs',
        'commit',
        '--only',
        '--file',
        messageFile,
        '--',
        ...commitPaths,
      ]);
      commitCommandSucceeded = true;

      const hashResult = await this.git.runForMachineParsing(
        request.repositoryRoot,
        ['rev-parse', 'HEAD'],
      );
      const commitHash = hashResult.rawStdout.trim();
      if (commitHash.length === 0) {
        throw new Error('Git 未返回提交哈希');
      }

      const treeResult = await this.git.runForMachineParsing(
        request.repositoryRoot,
        [
          'diff-tree',
          '--root',
          '--no-commit-id',
          '--name-status',
          '-r',
          '-z',
          'HEAD',
        ],
      );
      const actualPaths = parseCommittedPaths(treeResult.rawStdout);
      if (!pathsEqual(actualPaths, commitPaths)) {
        const expectedDiagnostic =
          redactSensitiveText(JSON.stringify(commitPaths));
        const actualDiagnostic =
          redactSensitiveText(JSON.stringify(actualPaths));
        throw new Error(
          `提交路径核对失败：预期 ${expectedDiagnostic}，`
          + `实际 ${actualDiagnostic}`,
        );
      }
      result = {
        commitHash,
        committedPaths: commitPaths,
      };
    } catch (error) {
      mainError = error;
      if (!commitCommandSucceeded && untrackedPaths.length > 0) {
        try {
          await this.git.run(request.repositoryRoot, [
            '--literal-pathspecs',
            'rm',
            '--cached',
            '--quiet',
            '--ignore-unmatch',
            '--',
            ...untrackedPaths,
          ]);
        } catch (cleanupError) {
          indexCleanupError = cleanupError;
        }
      }
    } finally {
      if (temporaryDirectory !== undefined) {
        try {
          await rm(temporaryDirectory, { recursive: true, force: true });
        } catch (cleanupError) {
          temporaryCleanupError = cleanupError;
        }
      }
    }

    if (
      mainError !== undefined
      || indexCleanupError !== undefined
      || temporaryCleanupError !== undefined
    ) {
      throwCollectedErrors(mainError, indexCleanupError, temporaryCleanupError);
    }
    if (result === undefined) {
      throw new Error('Git 提交事务未产生结果');
    }
    return result;
  }
}
