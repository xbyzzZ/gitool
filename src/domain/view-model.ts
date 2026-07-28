import type { FileChange } from './change-model.js';

export type OperationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly action: 'commit' | 'push' | 'trash' | 'remote' }
  | { readonly kind: 'commit-succeeded'; readonly commitHash: string }
  | { readonly kind: 'push-failed'; readonly commitHash: string; readonly message: string }
  | { readonly kind: 'failed'; readonly action: string; readonly message: string };

export interface RepositoryOption {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
}

export interface RepositoryViewModel {
  readonly version: number;
  readonly trusted: boolean;
  readonly currentRepositoryId?: string;
  readonly repositories: readonly RepositoryOption[];
  readonly branch?: string;
  readonly upstream?: string;
  readonly detached: boolean;
  readonly changes: readonly FileChange[];
  readonly selectedIds: readonly string[];
  readonly commitMessage: string;
  readonly operation: OperationState;
}
