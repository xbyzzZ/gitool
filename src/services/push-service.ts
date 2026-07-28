import type { BuiltinRepository } from '../git/builtin-git-api.js';

export interface PushRequest {
  readonly selectedRemote?: string;
  readonly localBranch: string;
}

export type PushResult =
  | { readonly kind: 'pushed'; readonly remote: string; readonly branch: string }
  | { readonly kind: 'needs-remote'; readonly remotes: readonly string[] };

export class PushService {
  async push(
    repository: BuiltinRepository,
    request: PushRequest,
  ): Promise<PushResult> {
    const head = repository.state.HEAD;
    if (head?.name === undefined || head.name.length === 0) {
      throw new Error('当前处于游离 HEAD，不能推送');
    }

    if (head.upstream !== undefined) {
      await repository.push(
        head.upstream.remote,
        head.upstream.name,
        false,
      );
      return {
        kind: 'pushed',
        remote: head.upstream.remote,
        branch: head.upstream.name,
      };
    }

    if (request.selectedRemote === undefined) {
      return {
        kind: 'needs-remote',
        remotes: repository.state.remotes.map((remote) => remote.name),
      };
    }

    await repository.push(request.selectedRemote, request.localBranch, true);
    return {
      kind: 'pushed',
      remote: request.selectedRemote,
      branch: request.localBranch,
    };
  }
}
