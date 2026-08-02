import type { FileChange } from './change-model.js';
import type { CommitGraphNode } from './history-model.js';
import type { CommitMessageDensity } from '../services/commit-message-ai-service.js';

export type SyncState =
  | { readonly kind: 'detached' }
  | { readonly kind: 'no-upstream' }
  | {
      readonly kind: 'ready';
      readonly upstream: string;
      readonly ahead: number;
      readonly behind: number;
    };

export type HistoryState =
  | { readonly kind: 'idle'; readonly commits: readonly CommitGraphNode[] }
  | { readonly kind: 'loading'; readonly commits: readonly CommitGraphNode[] }
  | { readonly kind: 'ready'; readonly commits: readonly CommitGraphNode[] }
  | {
      readonly kind: 'failed';
      readonly commits: readonly CommitGraphNode[];
      readonly message: string;
    };

export type AiState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'generating'; readonly density: CommitMessageDensity }
  | { readonly kind: 'failed'; readonly message: string };

export type OperationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly action: 'commit' | 'push' | 'trash' | 'remote' | 'fetch' | 'pull' }
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
  readonly hasRemote: boolean;
  readonly hasHeadCommit: boolean;
  readonly changes: readonly FileChange[];
  readonly changeCount: number;
  readonly selectedIds: readonly string[];
  readonly commitMessage: string;
  readonly operation: OperationState;
  readonly sync: SyncState;
  readonly history: HistoryState;
  readonly ai: AiState;
}
