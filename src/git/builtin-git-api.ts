import type * as vscode from 'vscode';

export interface BuiltinChange {
  readonly uri: vscode.Uri;
  readonly originalUri?: vscode.Uri;
  readonly status: number;
}

export interface BuiltinRemote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface BuiltinHead {
  readonly name?: string;
  readonly upstream?: { readonly remote: string; readonly name: string };
}

export interface BuiltinRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: BuiltinHead;
    readonly remotes: readonly BuiltinRemote[];
    readonly indexChanges: readonly BuiltinChange[];
    readonly workingTreeChanges: readonly BuiltinChange[];
    readonly untrackedChanges: readonly BuiltinChange[];
    readonly mergeChanges: readonly BuiltinChange[];
    readonly onDidChange: vscode.Event<void>;
  };
  status(): Promise<void>;
  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
  ): Promise<void>;
  setBranchUpstream(branchName: string, upstream: string): Promise<void>;
}

export interface BuiltinGitApi {
  readonly git: { readonly path: string };
  readonly repositories: readonly BuiltinRepository[];
  readonly onDidOpenRepository: vscode.Event<BuiltinRepository>;
  readonly onDidCloseRepository: vscode.Event<BuiltinRepository>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
