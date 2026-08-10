import { basename, dirname } from 'node:path/posix';
import * as vscode from 'vscode';
import type { CommitDetails } from '../domain/history-model.js';
import type { RepositoryViewModel } from '../domain/view-model.js';
import type { BuiltinRepository } from '../git/builtin-git-api.js';
import type { HistoryFileNode } from './history-tree-provider.js';

export interface HistoryFilesTreeService {
  readonly onDidChange: vscode.Event<void>;
  getViewModel(): Pick<RepositoryViewModel, 'currentRepositoryId' | 'version'>;
  getRepository(id: string): BuiltinRepository | undefined;
}

export class HistoryFilesTreeProvider
implements vscode.TreeDataProvider<HistoryFileNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<HistoryFileNode | undefined>();
  private readonly serviceListener: vscode.Disposable;
  private selection: {
    readonly repositoryId: string;
    readonly version: number;
    readonly details: CommitDetails;
  } | undefined;
  private tree: vscode.TreeView<HistoryFileNode> | undefined;

  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly service: HistoryFilesTreeService) {
    this.serviceListener = service.onDidChange(() => {
      if (this.selection !== undefined && !this.selectionMatchesCurrentScope()) {
        this.selection = undefined;
        this.updateMetadata();
        this.changed.fire(undefined);
      }
    });
  }

  selectCommit(repositoryId: string, version: number, details: CommitDetails): void {
    const model = this.service.getViewModel();
    if (model.currentRepositoryId !== repositoryId || model.version !== version) {
      throw new Error('仓库状态已变化，请刷新后重试');
    }
    this.selection = { repositoryId, version, details };
    this.updateMetadata();
    this.changed.fire(undefined);
  }

  clear(): void {
    this.selection = undefined;
    this.updateMetadata();
    this.changed.fire(undefined);
  }

  getChildren(): HistoryFileNode[] {
    const selection = this.selection;
    if (selection === undefined || !this.selectionMatchesCurrentScope()) {
      return [];
    }
    return selection.details.files.map((file) => ({
      kind: 'file',
      repositoryId: selection.repositoryId,
      version: selection.version,
      hash: selection.details.hash,
      ...(selection.details.parentHash === undefined
        ? {}
        : { parentHash: selection.details.parentHash }),
      file,
    }));
  }

  getTreeItem(node: HistoryFileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      basename(node.file.path),
      vscode.TreeItemCollapsibleState.None,
    );
    const directory = dirname(node.file.path);
    item.description = [
      ...(directory === '.' ? [] : [directory]),
      node.file.status,
    ].join(' · ');
    item.tooltip = node.file.originalPath === undefined
      ? node.file.path
      : `${node.file.originalPath} → ${node.file.path}`;
    const repository = this.service.getRepository(node.repositoryId);
    if (repository !== undefined) {
      item.resourceUri = vscode.Uri.joinPath(repository.rootUri, node.file.path);
      item.iconPath = vscode.ThemeIcon.File;
    }
    item.contextValue = 'gitool.historyFile';
    item.command = {
      command: 'gitool.openHistoryChange',
      title: '打开历史文件改动',
      arguments: [node],
    };
    return item;
  }

  bindView(tree: vscode.TreeView<HistoryFileNode>): vscode.Disposable {
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
    this.selection = undefined;
    this.serviceListener.dispose();
    this.changed.dispose();
  }

  private selectionMatchesCurrentScope(): boolean {
    const model = this.service.getViewModel();
    const selection = this.selection;
    return selection !== undefined
      && selection.repositoryId === model.currentRepositoryId
      && selection.version === model.version;
  }

  private updateMetadata(): void {
    if (this.tree === undefined) {
      return;
    }
    this.tree.description = this.selection?.details.hash.slice(0, 7) ?? '';
    this.tree.message = this.selection === undefined
      ? '选择一条提交查看文件'
      : this.selection.details.files.length === 0 ? '该提交没有文件改动' : '';
  }
}
