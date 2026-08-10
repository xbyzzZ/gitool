export type CommitRefKind = 'head' | 'local' | 'remote';

export interface CommitRef {
  readonly name: string;
  readonly kind: CommitRefKind;
}

export interface CommitSummary {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly authoredAt: string;
  readonly subject: string;
  readonly refs: readonly CommitRef[];
}

export interface CommitGraphNode extends CommitSummary {
  readonly lane: number;
  readonly color: number;
  readonly laneCount: number;
  readonly hasIncoming: boolean;
  readonly parentLanes: readonly number[];
  readonly parentEdges: readonly CommitGraphEdge[];
  readonly passingEdges: readonly CommitGraphEdge[];
}

export interface CommitGraphEdge {
  readonly fromLane: number;
  readonly toLane: number;
  readonly color: number;
}

export interface CommitFile {
  readonly status: string;
  readonly path: string;
  readonly originalPath?: string;
}

export interface CommitDetails {
  readonly hash: string;
  readonly parentHash?: string;
  readonly files: readonly CommitFile[];
}

export interface HistoryView {
  readonly head?: string;
  readonly upstream?: string;
  readonly commits: readonly CommitGraphNode[];
}

export interface AheadBehindCount {
  readonly ahead: number;
  readonly behind: number;
}

export type AheadBehind =
  | ({ readonly kind: 'ready'; readonly upstream: string } & AheadBehindCount)
  | { readonly kind: 'no-upstream' };
