import * as vscode from 'vscode';
import { directoryPath } from '../domain/change-groups.js';
import type { CommitFile, CommitGraphNode } from '../domain/history-model.js';
import type { RepositoryService } from '../services/repository-service.js';

export interface HistoryCommitNode {
  readonly kind: 'commit';
  readonly repositoryId: string;
  readonly version: number;
  readonly commit: CommitGraphNode;
}

export interface HistoryFileNode {
  readonly kind: 'file';
  readonly repositoryId: string;
  readonly version: number;
  readonly hash: string;
  readonly file: CommitFile;
}

export type HistoryTreeNode = HistoryCommitNode | HistoryFileNode;

export interface HistoryTreeProviderOptions {
  readonly service: RepositoryService;
}

function relativeTime(authoredAt: string, now = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - Date.parse(authoredAt));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${String(minutes)} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${String(days)} 天前`;
  }
  return new Date(authoredAt).toLocaleDateString('zh-CN');
}

function refsLabel(commit: CommitGraphNode): string {
  return commit.refs.map((ref) => ref.kind === 'head'
    ? `HEAD ${ref.name}`
    : ref.name).join(' · ');
}

function fileName(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? path : path.slice(separator + 1);
}

export class HistoryTreeProvider
  implements vscode.TreeDataProvider<HistoryTreeNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    HistoryTreeNode | undefined
  >();
  private readonly detailsCache = new Map<string, Promise<readonly CommitFile[]>>();
  private cacheScope: { readonly repositoryId: string; readonly version: number }
    | undefined;

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly onDidChangeSubscription: vscode.Disposable;

  constructor(private readonly options: HistoryTreeProviderOptions) {
    this.onDidChangeSubscription = options.service.onDidChange(() => {
      this.ensureCacheScope();
      this.onDidChangeTreeDataEmitter.fire(undefined);
    });
  }

  getTreeItem(node: HistoryTreeNode): vscode.TreeItem {
    if (node.kind === 'file') {
      return this.fileItem(node);
    }
    const item = new vscode.TreeItem(
      node.commit.subject,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    const refs = refsLabel(node.commit);
    item.description = [
      node.commit.author,
      relativeTime(node.commit.authoredAt),
      node.commit.shortHash,
      ...(refs.length === 0 ? [] : [refs]),
    ].join(' · ');
    item.tooltip = `${node.commit.subject}\n${node.commit.author} · ${node.commit.authoredAt} · ${node.commit.hash}`;
    item.iconPath = new vscode.ThemeIcon('git-commit');
    return item;
  }

  getDescription(): string {
    const sync = this.options.service.getViewModel().sync;
    return sync.kind === 'ready'
      ? `${sync.upstream} · ↑${String(sync.ahead)} ↓${String(sync.behind)}`
      : sync.kind === 'detached' ? '游离 HEAD' : '未设置上游';
  }

  getChildren(): HistoryTreeNode[];
  getChildren(node: HistoryTreeNode): Promise<HistoryTreeNode[]>;
  getChildren(
    node?: HistoryTreeNode,
  ): HistoryTreeNode[] | Promise<HistoryTreeNode[]> {
    const scope = this.ensureCacheScope();
    if (scope === undefined) {
      return [];
    }
    if (node === undefined) {
      return this.options.service.getViewModel().history.commits.map((commit) => ({
        kind: 'commit',
        repositoryId: scope.repositoryId,
        version: scope.version,
        commit,
      }));
    }
    if (node.kind === 'file'
      || node.repositoryId !== scope.repositoryId
      || node.version !== scope.version) {
      return [];
    }
    return this.loadFiles(node).then((files) => files.map((file) => ({
      kind: 'file',
      repositoryId: node.repositoryId,
      version: node.version,
      hash: node.commit.hash,
      file,
    })));
  }

  dispose(): void {
    this.onDidChangeSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private ensureCacheScope(): {
    readonly repositoryId: string;
    readonly version: number;
  } | undefined {
    const model = this.options.service.getViewModel();
    if (model.currentRepositoryId === undefined) {
      this.detailsCache.clear();
      this.cacheScope = undefined;
      return undefined;
    }
    const scope = {
      repositoryId: model.currentRepositoryId,
      version: model.version,
    };
    if (this.cacheScope?.repositoryId !== scope.repositoryId
      || this.cacheScope.version !== scope.version) {
      this.detailsCache.clear();
    }
    this.cacheScope = scope;
    return scope;
  }

  private loadFiles(node: HistoryCommitNode): Promise<readonly CommitFile[]> {
    const key = `${node.repositoryId}:${String(node.version)}:${node.commit.hash}`;
    const cached = this.detailsCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const loading = this.options.service.loadCommitDetails({
      repositoryId: node.repositoryId,
      version: node.version,
      hash: node.commit.hash,
    }).then((details) => details.files);
    this.detailsCache.set(key, loading);
    return loading.catch((error: unknown) => {
      if (this.detailsCache.get(key) === loading) {
        this.detailsCache.delete(key);
      }
      throw error;
    });
  }

  private fileItem(node: HistoryFileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      fileName(node.file.path),
      vscode.TreeItemCollapsibleState.None,
    );
    const repository = this.options.service.getRepository(node.repositoryId);
    if (repository !== undefined) {
      item.resourceUri = vscode.Uri.joinPath(repository.rootUri, node.file.path);
    }
    item.iconPath = vscode.ThemeIcon.File;
    item.description = `${directoryPath(node.file.path)} · ${node.file.status}`;
    item.command = {
      command: 'gitool.openHistoryDiff',
      title: '打开提交差异',
      arguments: [node],
    };
    return item;
  }
}
