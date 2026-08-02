import * as vscode from 'vscode';
import type {
  CommitDetails,
  CommitGraphNode,
} from '../domain/history-model.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { BuiltinRepository } from '../git/builtin-git-api.js';
import type { LoadCommitDetailsRequest } from '../services/repository-service.js';

export interface HistoryTreeService {
  readonly onDidChange: vscode.Event<void>;
  getViewModel(): RepositoryViewModel;
  getRepository(id: string): BuiltinRepository | undefined;
  loadCommitDetails(request: LoadCommitDetailsRequest): Promise<CommitDetails>;
  reportFailure(action: string, message: string): boolean;
}

export interface HistoryCommitNode {
  readonly kind: 'commit';
  readonly repositoryId: string;
  readonly version: number;
  readonly commit: CommitGraphNode;
}

export type HistoryTreeNode = HistoryCommitNode;

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

function refLabel(ref: CommitGraphNode['refs'][number]): string {
  return ref.kind === 'head' ? `HEAD ${ref.name}` : ref.name;
}

function commitIcon(commit: CommitGraphNode): vscode.ThemeIcon {
  if (commit.refs.some((ref) => ref.kind === 'head')) {
    return new vscode.ThemeIcon(
      'target',
      new vscode.ThemeColor('charts.blue'),
    );
  }
  if (commit.refs.some((ref) => ref.kind === 'local')) {
    return new vscode.ThemeIcon(
      'git-branch',
      new vscode.ThemeColor('charts.green'),
    );
  }
  if (commit.refs.some((ref) => ref.kind === 'remote')) {
    return new vscode.ThemeIcon(
      'cloud',
      new vscode.ThemeColor('charts.yellow'),
    );
  }
  return new vscode.ThemeIcon(
    'git-commit',
    new vscode.ThemeColor('descriptionForeground'),
  );
}

export class HistoryTreeProvider
implements vscode.TreeDataProvider<HistoryTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<
    HistoryTreeNode | undefined
  >();
  private readonly serviceListener: vscode.Disposable;
  private tree: vscode.TreeView<HistoryTreeNode> | undefined;

  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly service: HistoryTreeService) {
    this.serviceListener = service.onDidChange(() => {
      this.updateMetadata();
      this.changed.fire(undefined);
    });
  }

  getChildren(node?: HistoryTreeNode): HistoryTreeNode[] {
    if (node !== undefined) {
      return [];
    }
    const model = this.service.getViewModel();
    const repositoryId = model.currentRepositoryId;
    if (repositoryId === undefined) {
      return [];
    }
    return model.history.commits.map((commit) => ({
      kind: 'commit',
      repositoryId,
      version: model.version,
      commit,
    }));
  }

  getTreeItem(node: HistoryTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.commit.subject,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    const refs = node.commit.refs.map(refLabel);
    item.description = [
      node.commit.author,
      relativeTime(node.commit.authoredAt),
      node.commit.shortHash,
      ...refs,
    ].join(' · ');
    item.tooltip = [
      node.commit.subject,
      `${node.commit.author} · ${node.commit.authoredAt}`,
      node.commit.hash,
      ...refs,
    ].join('\n');
    item.iconPath = commitIcon(node.commit);
    item.contextValue = 'gitool.historyCommit';
    return item;
  }

  bindView(tree: vscode.TreeView<HistoryTreeNode>): vscode.Disposable {
    this.tree = tree;
    this.updateMetadata();
    return {
      dispose: () => {
        if (this.tree === tree) {
          this.tree = undefined;
        }
      },
    };
  }

  dispose(): void {
    this.tree = undefined;
    this.serviceListener.dispose();
    this.changed.dispose();
  }

  private updateMetadata(): void {
    const tree = this.tree;
    if (tree === undefined) {
      return;
    }
    const model = this.service.getViewModel();
    tree.description = this.syncDescription(model);
    tree.message = this.historyMessage(model);
  }

  private syncDescription(model: RepositoryViewModel): string {
    switch (model.sync.kind) {
      case 'detached':
        return '游离 HEAD';
      case 'no-upstream':
        return '未设置上游';
      case 'ready':
        return `${model.sync.upstream} · ↑${String(model.sync.ahead)} ↓${String(model.sync.behind)}`;
    }
  }

  private historyMessage(model: RepositoryViewModel): string {
    switch (model.history.kind) {
      case 'loading':
        return '正在读取提交历史…';
      case 'failed':
        return model.history.message;
      case 'idle':
      case 'ready':
        return model.history.commits.length === 0 ? '暂无提交记录' : '';
    }
  }
}
