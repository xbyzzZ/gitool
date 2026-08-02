import * as vscode from 'vscode';
import {
  directoryPath,
  groupChanges,
  type ChangeSectionKind,
} from '../domain/change-groups.js';
import type { FileChange } from '../domain/change-model.js';
import type { RepositoryService } from '../services/repository-service.js';

export interface ChangeSectionNode {
  readonly kind: 'section';
  readonly repositoryId: string;
  readonly section: ChangeSectionKind;
}

export interface ChangeDirectoryNode {
  readonly kind: 'directory';
  readonly repositoryId: string;
  readonly section: ChangeSectionKind;
  readonly path: string;
}

export interface ChangeFileNode {
  readonly kind: 'file';
  readonly repositoryId: string;
  readonly change: FileChange;
}

export type ChangeTreeNode =
  | ChangeSectionNode
  | ChangeDirectoryNode
  | ChangeFileNode;

export interface ChangeTreeProviderOptions {
  readonly service: RepositoryService;
}

export interface CreateChangeTreeViewOptions extends ChangeTreeProviderOptions {
  readonly viewId?: string;
}

const sectionLabels: Readonly<Record<ChangeSectionKind, string>> = {
  tracked: '已跟踪变更',
  untracked: '未跟踪文件',
  conflicted: '冲突文件',
};

const changeLabels: Readonly<Record<FileChange['kind'], string>> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  'type-changed': 'T',
  conflicted: '!',
  untracked: '?',
};

function fileName(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? path : path.slice(separator + 1);
}

function statusLabel(change: FileChange): string {
  return changeLabels[change.kind];
}

export class ChangeTreeProvider
  implements vscode.TreeDataProvider<ChangeTreeNode>, vscode.Disposable {
  private readonly nodes = new WeakSet<ChangeTreeNode>();
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    ChangeTreeNode | undefined
  >();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly onDidChangeSubscription: vscode.Disposable;

  constructor(private readonly options: ChangeTreeProviderOptions) {
    this.onDidChangeSubscription = options.service.onDidChange(() => {
      this.onDidChangeTreeDataEmitter.fire(undefined);
    });
  }

  getTreeItem(node: ChangeTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'section':
        return this.sectionItem(node);
      case 'directory':
        return this.directoryItem(node);
      case 'file':
        return this.fileItem(node);
    }
  }

  getChildren(node?: ChangeTreeNode): ChangeTreeNode[] {
    const model = this.options.service.getViewModel();
    const repositoryId = model.currentRepositoryId;
    if (repositoryId === undefined) {
      return [];
    }
    const sections = groupChanges(model.changes);

    if (node === undefined) {
      return sections.map((section) => this.createNode({
        kind: 'section',
        repositoryId,
        section: section.kind,
      }));
    }

    if (node.kind === 'section') {
      const section = sections.find((item) => item.kind === node.section);
      return section?.directories.map((directory) => this.createNode({
        kind: 'directory',
        repositoryId,
        section: node.section,
        path: directory.path,
      })) ?? [];
    }

    if (node.kind === 'directory') {
      const section = sections.find((item) => item.kind === node.section);
      const directory = section?.directories.find((item) => item.path === node.path);
      return directory?.files.map((change) => this.createNode({
        kind: 'file',
        repositoryId,
        change,
      })) ?? [];
    }

    return [];
  }

  isCurrentNode(node: ChangeTreeNode, repositoryId: string): boolean {
    return this.nodes.has(node) && node.repositoryId === repositoryId;
  }

  dispose(): void {
    this.onDidChangeSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private sectionItem(node: ChangeSectionNode): vscode.TreeItem {
    const section = groupChanges(this.options.service.getViewModel().changes)
      .find((item) => item.kind === node.section);
    const item = new vscode.TreeItem(
      sectionLabels[node.section],
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.description = section === undefined ? '0' : String(section.fileCount);
    if (node.section !== 'conflicted') {
      item.checkboxState = this.isSectionSelected(node.section)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    }
    return item;
  }

  private directoryItem(node: ChangeDirectoryNode): vscode.TreeItem {
    return new vscode.TreeItem(
      node.path,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
  }

  private fileItem(node: ChangeFileNode): vscode.TreeItem {
    const repository = this.options.service.getRepository(node.repositoryId);
    const item = new vscode.TreeItem(
      fileName(node.change.path),
      vscode.TreeItemCollapsibleState.None,
    );
    if (repository !== undefined) {
      item.resourceUri = vscode.Uri.joinPath(
        repository.rootUri,
        node.change.path,
      );
    }
    item.iconPath = vscode.ThemeIcon.File;
    item.description = `${directoryPath(node.change.path)} · ${statusLabel(node.change)}`;
    if (!node.change.conflicted) {
      item.checkboxState = this.options.service.getViewModel().selectedIds
        .includes(node.change.id)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    }
    item.contextValue = node.change.untracked
      ? 'gitool.untrackedFile'
      : node.change.conflicted
        ? 'gitool.conflictedFile'
        : 'gitool.changedFile';
    item.command = {
      command: 'gitool.openChange',
      title: '打开变更',
      arguments: [node],
    };
    return item;
  }

  private isSectionSelected(section: 'tracked' | 'untracked'): boolean {
    const model = this.options.service.getViewModel();
    return groupChanges(model.changes)
      .find((item) => item.kind === section)?.directories
      .flatMap((directory) => directory.files)
      .every((change) => model.selectedIds.includes(change.id)) ?? false;
  }

  private createNode<T extends ChangeTreeNode>(node: T): T {
    this.nodes.add(node);
    return node;
  }
}

export function createChangeTreeView(
  options: CreateChangeTreeViewOptions,
): vscode.TreeView<ChangeTreeNode> {
  const provider = new ChangeTreeProvider(options);
  const treeView = vscode.window.createTreeView(
    options.viewId ?? 'gitool.changesView',
    {
      treeDataProvider: provider,
      manageCheckboxStateManually: true,
    },
  );
  const checkboxes = bindCheckboxes(treeView, provider, options.service);
  const disposeTreeView = treeView.dispose.bind(treeView);
  treeView.dispose = (): void => {
    checkboxes.dispose();
    provider.dispose();
    disposeTreeView();
  };
  return treeView;
}

function bindCheckboxes(
  treeView: vscode.TreeView<ChangeTreeNode>,
  provider: ChangeTreeProvider,
  service: RepositoryService,
): vscode.Disposable {
  return treeView.onDidChangeCheckboxState(({ items }) => {
    const currentRepositoryId = service.getViewModel().currentRepositoryId;
    if (currentRepositoryId === undefined) {
      return;
    }
    for (const [node, checkboxState] of items) {
      if (!provider.isCurrentNode(node, currentRepositoryId)) {
        continue;
      }
      const selected = checkboxState === vscode.TreeItemCheckboxState.Checked;
      if (node.kind === 'file' && !node.change.conflicted) {
        service.setFileSelected(node.change.id, selected);
      }
      if (node.kind === 'section' && node.section !== 'conflicted') {
        service.setGroup(node.section, selected);
      }
    }
  });
}
