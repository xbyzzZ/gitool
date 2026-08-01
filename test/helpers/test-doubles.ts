import type * as vscode from 'vscode';
import type {
  BuiltinChange,
  BuiltinRemote,
  BuiltinRepository,
} from '../../src/git/builtin-git-api.js';

export interface FakePushCall {
  readonly remoteName: string | undefined;
  readonly branchName: string | undefined;
  readonly setUpstream: boolean | undefined;
}

export interface FakeSetBranchUpstreamCall {
  readonly branchName: string;
  readonly upstream: string;
}

export interface FakePullCall {
  readonly kind: 'pull';
}

export interface FakeBuiltinRepositoryOptions {
  readonly head?: {
    readonly name?: string;
    readonly upstream?: { readonly remote: string; readonly name: string };
  };
  readonly remotes: readonly BuiltinRemote[];
}

const noChanges: readonly BuiltinChange[] = [];
const noOpEvent: vscode.Event<void> = () => ({
  dispose(): void {
    return undefined;
  },
});

export class FakeBuiltinRepository implements BuiltinRepository {
  readonly pushCalls: FakePushCall[] = [];
  readonly setBranchUpstreamCalls: FakeSetBranchUpstreamCall[] = [];
  readonly fetchCalls: number[] = [];
  readonly pullCalls: FakePullCall[] = [];

  readonly rootUri = {} as vscode.Uri;

  readonly state: BuiltinRepository['state'];

  constructor(options: FakeBuiltinRepositoryOptions) {
    this.state = {
      ...(options.head === undefined ? {} : { HEAD: options.head }),
      remotes: options.remotes,
      indexChanges: noChanges,
      workingTreeChanges: noChanges,
      untrackedChanges: noChanges,
      mergeChanges: noChanges,
      onDidChange: noOpEvent,
    };
  }

  status(): Promise<void> {
    return Promise.resolve();
  }

  fetch(): Promise<void> {
    this.fetchCalls.push(this.fetchCalls.length + 1);
    return Promise.resolve();
  }

  pull(): Promise<void> {
    this.pullCalls.push({ kind: 'pull' });
    return Promise.resolve();
  }

  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
  ): Promise<void> {
    this.pushCalls.push({ remoteName, branchName, setUpstream });
    return Promise.resolve();
  }

  setBranchUpstream(branchName: string, upstream: string): Promise<void> {
    this.setBranchUpstreamCalls.push({ branchName, upstream });
    return Promise.resolve();
  }
}
