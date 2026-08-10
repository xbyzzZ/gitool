import type { BuiltinRepository } from '../git/builtin-git-api.js';
import type { AheadBehind } from '../domain/history-model.js';
import type { GitRunner } from '../git/git-runner.js';
import { parseAheadBehind } from './ahead-behind.js';
import type { PushResult } from './push-service.js';

export interface PushAllRequest {
  readonly localBranch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly selectedRemote?: string;
}

function currentBranch(repository: BuiltinRepository): string {
  const branch = repository.state.HEAD?.name;
  if (branch === undefined || branch.length === 0) {
    throw new Error('当前处于游离 HEAD，不能执行远程同步');
  }
  return branch;
}

export class SyncService {
  constructor(private readonly git?: GitRunner) {}

  async aheadBehind(repositoryRoot: string): Promise<AheadBehind> {
    if (this.git === undefined) {
      throw new Error('Git 命令服务尚未配置');
    }
    const upstreamResult = await this.git.run(repositoryRoot, [
      'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}',
    ], { allowFailure: true });
    if (upstreamResult.exitCode !== 0) {
      return { kind: 'no-upstream' };
    }
    const upstream = upstreamResult.stdout.trim();
    if (upstream.length === 0) {
      throw new Error('Git 上游名称为空');
    }
    const countResult = await this.git.runForMachineParsing(repositoryRoot, [
      'rev-list', '--left-right', '--count', 'HEAD...@{upstream}',
    ]);
    return {
      kind: 'ready',
      upstream,
      ...parseAheadBehind(countResult.rawStdout),
    };
  }

  async fetch(repository: BuiltinRepository): Promise<void> {
    await repository.fetch();
  }

  async pull(repository: BuiltinRepository): Promise<void> {
    currentBranch(repository);
    if (repository.state.HEAD?.upstream === undefined) {
      throw new Error('当前分支未设置上游，不能从远程拉取');
    }
    await repository.pull();
  }

  async pushAll(
    repository: BuiltinRepository,
    request: PushAllRequest,
  ): Promise<PushResult> {
    const branch = currentBranch(repository);
    if (request.localBranch !== branch) {
      throw new Error('请求分支与当前分支不一致');
    }
    if (!Number.isSafeInteger(request.ahead) || request.ahead < 0
      || !Number.isSafeInteger(request.behind) || request.behind < 0) {
      throw new RangeError('领先落后计数无效');
    }
    if (request.ahead === 0) {
      throw new Error('没有待推送的本地提交');
    }
    if (request.behind > 0) {
      throw new Error('当前分支落后于上游，请先拉取并解决分歧');
    }

    const upstream = repository.state.HEAD?.upstream;
    if (upstream !== undefined) {
      await repository.push(upstream.remote, upstream.name, false);
      return {
        kind: 'pushed',
        remote: upstream.remote,
        branch: upstream.name,
      };
    }

    if (request.selectedRemote === undefined) {
      return {
        kind: 'needs-remote',
        remotes: repository.state.remotes.map((remote) => remote.name),
      };
    }
    if (!repository.state.remotes.some(
      (remote) => remote.name === request.selectedRemote,
    )) {
      throw new Error(`远程 ${request.selectedRemote} 不存在`);
    }
    await repository.push(request.selectedRemote, branch, true);
    return {
      kind: 'pushed',
      remote: request.selectedRemote,
      branch,
    };
  }
}
